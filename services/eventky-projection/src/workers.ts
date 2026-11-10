import { Worker } from 'node:worker_threads';
import type { CalendarProjector } from './projector';
import { MAX_WORK_RESULT_BYTES, type ProjectionSnapshot, type ProjectionWork, type WorkOutcome } from './work.types';

export type WorkerPoolOptions = {
  workerPath: string;
  concurrency?: number;
  maxQueued?: number;
  timeoutMs?: number;
  queueTimeoutMs?: number;
  heapMb?: number;
};
type Job = {
  work: ProjectionWork;
  signal?: AbortSignal;
  resolve: (value: WorkOutcome) => void;
  queuedAt?: number;
  queuedTimer?: ReturnType<typeof setTimeout>;
  abort: () => void;
  cancelActive?: () => void;
  settled: boolean;
};

function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(Math.trunc(value!), max)) : fallback;
}

/** Node applies process-wide heap flags before worker resource limits, including flags in NODE_OPTIONS. */
export function hasWorkerHeapOverride(
  nodeOptions = process.env.NODE_OPTIONS ?? '',
  execArgv = process.execArgv,
): boolean {
  return /--(?:max|initial)[-_](?:old[-_]space|semi[-_]space|heap)[-_]size/.test([nodeOptions, ...execArgv].join(' '));
}

/** A hard deadline covers worker startup, parsing, recurrence, serialization, and response cloning. */
export class ProjectionWorkers {
  private readonly concurrency: number;
  private readonly maxQueued: number;
  private readonly timeoutMs: number;
  private readonly queueTimeoutMs: number;
  private readonly heapMb: number;
  private readonly queue: Job[] = [];
  private readonly running = new Map<Job, Worker>();
  private closed = false;

  constructor(
    private readonly projector: CalendarProjector,
    private readonly options: WorkerPoolOptions,
  ) {
    this.concurrency = bounded(options.concurrency, 2, 1, 2);
    this.maxQueued = bounded(options.maxQueued, 8, 0, 8);
    this.timeoutMs = bounded(options.timeoutMs, 2000, 20, 2000);
    this.queueTimeoutMs = bounded(options.queueTimeoutMs, 1000, 20, 1000);
    this.heapMb = bounded(options.heapMb, 128, 16, 128);
  }

  stats() {
    return { active: this.running.size, queued: this.queue.length, closed: this.closed };
  }

  execute(work: ProjectionWork, signal?: AbortSignal): Promise<WorkOutcome> {
    if (this.closed || signal?.aborted) return Promise.resolve({ ok: false, reason: 'cancelled' });
    if (Buffer.byteLength(JSON.stringify(work)) > 16384) return Promise.resolve({ ok: false, reason: 'unavailable' });
    if (this.running.size >= this.concurrency && this.queue.length >= this.maxQueued)
      return Promise.resolve({ ok: false, reason: 'overloaded' });
    return new Promise((resolve) => {
      const job: Job = {
        work,
        signal,
        resolve,
        settled: false,
        abort: () => {
          if (job.cancelActive) job.cancelActive();
          else {
            this.removeQueued(job);
            this.settle(job, { ok: false, reason: 'cancelled' });
          }
        },
      };
      signal?.addEventListener('abort', job.abort, { once: true });
      if (this.running.size < this.concurrency) this.start(job);
      else {
        job.queuedAt = performance.now();
        this.queue.push(job);
        job.queuedTimer = setTimeout(() => {
          this.removeQueued(job);
          this.settle(job, { ok: false, reason: 'timeout' });
        }, this.queueTimeoutMs);
      }
    });
  }

  private removeQueued(job: Job) {
    const index = this.queue.indexOf(job);
    if (index >= 0) this.queue.splice(index, 1);
    if (job.queuedTimer) clearTimeout(job.queuedTimer);
  }
  private settle(job: Job, value: WorkOutcome) {
    if (job.settled) return;
    job.settled = true;
    if (job.queuedTimer) clearTimeout(job.queuedTimer);
    job.signal?.removeEventListener('abort', job.abort);
    job.resolve(value);
  }
  private drain() {
    while (!this.closed && this.running.size < this.concurrency && this.queue.length) {
      const next = this.queue.shift()!;
      if (!next.settled) {
        if (next.queuedTimer) clearTimeout(next.queuedTimer);
        this.start(next);
      }
    }
  }

  private start(job: Job) {
    const started = performance.now();
    if (job.queuedAt !== undefined && started - job.queuedAt >= this.queueTimeoutMs) {
      this.settle(job, { ok: false, reason: 'timeout' });
      return;
    }
    let snapshot: ProjectionSnapshot;
    try {
      snapshot = this.projector.snapshot();
    } catch {
      this.settle(job, { ok: false, reason: 'unavailable' });
      this.drain();
      return;
    }
    if (!snapshot.sources) {
      this.settle(job, { ok: false, reason: 'unavailable' });
      this.drain();
      return;
    }
    const stamp = { metadata: snapshot.metadata, pending: snapshot.pending };
    let worker: Worker;
    try {
      worker = new Worker(this.options.workerPath, {
        workerData: { snapshot, work: job.work, heapMb: this.heapMb },
        env: {},
        execArgv: [],
        stdout: true,
        stderr: true,
        resourceLimits: { maxOldGenerationSizeMb: this.heapMb, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      });
    } catch {
      this.settle(job, { ok: false, reason: 'unavailable' });
      this.drain();
      return;
    }
    this.running.set(job, worker);
    worker.stdout?.on('data', () => {});
    worker.stderr?.on('data', () => {});
    const finish = (outcome: WorkOutcome) => {
      if (job.settled) return;
      clearTimeout(timer);
      this.settle(job, outcome);
      // Keep the concurrency slot until exit, including timed-out workers being terminated.
      void worker.terminate().catch(() => {});
    };
    const timer = setTimeout(
      () => finish({ ok: false, reason: 'timeout' }),
      Math.max(0, this.timeoutMs - (performance.now() - started)),
    );
    job.cancelActive = () => finish({ ok: false, reason: 'cancelled' });
    worker.once('message', (outcome: WorkOutcome) => {
      if (job.settled) return;
      try {
        if (performance.now() - started > this.timeoutMs) {
          finish({ ok: false, reason: 'timeout' });
          return;
        }
        if (
          Buffer.byteLength(JSON.stringify(outcome)) > MAX_WORK_RESULT_BYTES ||
          typeof outcome?.ok !== 'boolean' ||
          (outcome.ok && outcome.value.operation !== job.work.operation)
        ) {
          finish({ ok: false, reason: 'unavailable' });
          return;
        }
        if (!this.projector.snapshotStillCurrent(stamp)) {
          finish({ ok: false, reason: 'stale' });
          return;
        }
        finish(outcome);
      } catch {
        finish({ ok: false, reason: 'unavailable' });
      }
    });
    worker.once('error', () => finish({ ok: false, reason: 'unavailable' }));
    worker.once('exit', () => {
      clearTimeout(timer);
      this.running.delete(job);
      if (!job.settled) this.settle(job, { ok: false, reason: 'unavailable' });
      this.drain();
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const job of this.queue.splice(0)) this.settle(job, { ok: false, reason: 'cancelled' });
    const active = [...this.running.entries()];
    for (const [job] of active) job.cancelActive?.();
    await Promise.all(active.map(([, worker]) => worker.terminate().catch(() => -1)));
  }
}
