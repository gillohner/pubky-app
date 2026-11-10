import { getHeapStatistics } from 'node:v8';
import { parentPort, workerData } from 'node:worker_threads';
import { CalendarProjector } from './projector';
import { MAX_WORK_RESULT_BYTES, type ProjectionWorkOutput, type WorkerInput } from './work.types';

// Immutable structured-clone input only: no database, network, credentials, or global source registry.
const { snapshot, work, heapMb } = workerData as WorkerInput;
const cache = new Map<string, string>();
const projector = new CalendarProjector({
  metadata: () => snapshot.metadata,
  sourceStats: () => snapshot.stats,
  pendingCount: () => snapshot.pending,
  cursorKey: () => snapshot.cursorKey,
  feedSnapshot: () => snapshot,
  cacheGet: (key: string) => cache.get(key) ?? null,
  cachePut: (key: string, value: string) => {
    cache.clear();
    cache.set(key, value);
  },
});
try {
  // Check actual V8 limits as well: process flags can override the reported resourceLimits option.
  if (!Number.isFinite(heapMb) || getHeapStatistics().heap_size_limit > (heapMb + 32) * 1024 * 1024) {
    parentPort?.postMessage({ ok: false, reason: 'unavailable' });
  } else {
    const output: ProjectionWorkOutput =
      work.operation === 'query'
        ? { operation: 'query', result: projector.query(work.query) }
        : { operation: 'subscription', result: projector.subscription(work.calendarUri, work.request) };
    if (
      (output.operation === 'query' && output.result.ok && !output.result.value.coverage.complete) ||
      Buffer.byteLength(JSON.stringify({ ok: true, value: output })) > MAX_WORK_RESULT_BYTES
    )
      parentPort?.postMessage({ ok: false, reason: 'unavailable' });
    else parentPort?.postMessage({ ok: true, value: output });
  }
} catch {
  parentPort?.postMessage({ ok: false, reason: 'unavailable' });
} finally {
  parentPort?.close();
}
