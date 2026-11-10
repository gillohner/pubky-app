// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { CALENDAR_FIXTURE, EVENT_FIXTURE, FIXTURE_CALENDAR_URI, FIXTURE_EVENT_URI } from '@eventky/fixtures';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createProjectionServer } from './http';
import { CalendarProjector } from './projector';
import { ProjectionStore } from './store';
import type { SourcePost } from './types';
import type { ProjectionWork } from './work.types';
import { buildTestWorkers, fetchLoopback } from './worker-fixtures';
import { ProjectionWorkers } from './workers';

const calendar: SourcePost = { uri: FIXTURE_CALENDAR_URI, kind: 'calendar', content: JSON.stringify(CALENDAR_FIXTURE) };
const event: SourcePost = { uri: FIXTURE_EVENT_URI, kind: 'event', content: JSON.stringify(EVENT_FIXTURE) };
const query: ProjectionWork = {
  operation: 'query',
  query: {
    from: '2026-10-01T00:00:00Z',
    to: '2026-11-10T00:00:00Z',
    timezone: 'Europe/Zurich',
    calendars: [calendar.uri],
    limit: 2,
  },
};
let built: ReturnType<typeof buildTestWorkers>;
let hung: string;
let delayed: string;
let memory: string;
const stores: ProjectionStore[] = [];
const pools: ProjectionWorkers[] = [];

beforeAll(() => {
  built = buildTestWorkers();
  hung = built.fixture('hung', 'while(true){}');
  delayed = built.fixture(
    'delayed',
    `const {parentPort}=require('node:worker_threads');setTimeout(()=>{parentPort.postMessage({ok:true,value:{operation:'subscription',result:{status:304,headers:{},body:null}}});parentPort.close();},100);`,
  );
  memory = built.fixture(
    'memory',
    'const arrays=[];for(;;)arrays.push(Array.from({length:100000},()=>Math.random()));',
  );
});
afterAll(() => built.close());
afterEach(async () => {
  for (const pool of pools.splice(0)) await pool.close();
  for (const store of stores.splice(0)) store.close();
  vi.restoreAllMocks();
});
function setup(posts = [calendar, event]) {
  const store = new ProjectionStore(':memory:', 'test-nexus', 'explicit-fixtures');
  stores.push(store);
  store.beginInventory();
  store.stageInventory(posts);
  store.finishInventory('epoch:1');
  store.setReady(true);
  return { store, projector: new CalendarProjector(store) };
}
function pool(projector: CalendarProjector, options: Partial<ConstructorParameters<typeof ProjectionWorkers>[1]> = {}) {
  const value = new ProjectionWorkers(projector, { workerPath: built.workerPath, ...options });
  pools.push(value);
  return value;
}
const subscription: ProjectionWork = { operation: 'subscription', calendarUri: calendar.uri, request: {} };

describe('bounded calendar worker execution', () => {
  it('runs real recurrence jobs in separate workers with stable revision-bound pagination', async () => {
    const { projector } = setup();
    const workers = pool(projector);
    const first = await workers.execute(query);
    expect(first.ok).toBe(true);
    if (!first.ok || first.value.operation !== 'query' || !first.value.result.ok) return;
    expect(first.value.result.value.items).toHaveLength(2);
    const second = await workers.execute({
      operation: 'query',
      query: { ...query.query, cursor: first.value.result.value.next_cursor! },
    });
    expect(second.ok).toBe(true);
    if (second.ok && second.value.operation === 'query' && second.value.result.ok)
      expect(second.value.result.value.items[0].recurrence_id.value).toBe('2026-10-15T18:00:00');
    const feed = await workers.execute(subscription);
    expect(feed.ok && feed.value.operation === 'subscription' && feed.value.result.status).toBe(200);
  });

  it('terminates a hung worker and keeps health HTTP responsive while it runs', async () => {
    const { projector } = setup();
    const workers = pool(projector, { workerPath: hung, concurrency: 1, timeoutMs: 300 });
    const server = createProjectionServer(projector, workers);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') return;
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      const started = performance.now();
      const pending = fetchLoopback(`${origin}/v1/calendar.ics?${new URLSearchParams({ calendar: calendar.uri })}`);
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect((await fetchLoopback(`${origin}/healthz`)).status).toBe(200);
      const failure = await pending;
      expect(failure.status).toBe(503);
      expect(failure.headers.get('cache-control')).toBe('no-store');
      expect(performance.now() - started).toBeLessThan(2000);
      await workers.close();
      expect(workers.stats().active).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects queue overflow before taking more snapshots and expires queued jobs', async () => {
    const { projector } = setup();
    const snapshot = vi.spyOn(projector, 'snapshot');
    const workers = pool(projector, {
      workerPath: hung,
      concurrency: 1,
      maxQueued: 2,
      timeoutMs: 300,
      queueTimeoutMs: 50,
    });
    const first = workers.execute(query);
    const second = workers.execute(query);
    const third = workers.execute(query);
    expect(workers.stats()).toMatchObject({ active: 1, queued: 2 });
    expect(await workers.execute(query)).toEqual({ ok: false, reason: 'overloaded' });
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(await second).toEqual({ ok: false, reason: 'timeout' });
    expect(await third).toEqual({ ok: false, reason: 'timeout' });
    expect(await first).toEqual({ ok: false, reason: 'timeout' });
    expect(snapshot).toHaveBeenCalledTimes(1);
  });

  it('rejects a worker result and conditional304 if the source changed or invalidations queued', async () => {
    for (const mutation of ['delete', 'enqueue'] as const) {
      const { store, projector } = setup();
      const workers = pool(projector, { workerPath: delayed });
      const pending = workers.execute({ ...subscription, request: { ifNoneMatch: '"prior"' } });
      if (mutation === 'delete') store.applyHydration({ status: 'deleted', uri: event.uri });
      else store.enqueue([event.uri], 'epoch:2', true);
      expect(await pending).toEqual({ ok: false, reason: 'stale' });
    }
  });

  it('enforces worker heap limits without taking down the parent process', async () => {
    const { projector } = setup();
    const workers = pool(projector, { workerPath: memory, heapMb: 16, timeoutMs: 2000 });
    expect(await workers.execute(query)).toEqual({ ok: false, reason: 'unavailable' });
    expect(projector.status().coverage.complete).toBe(true);
    expect((await pool(projector).execute(query)).ok).toBe(true);
  });

  it('bounds source count and bytes before allSources materializes content', async () => {
    const posts = Array.from({ length: 129 }, (_, index) => ({
      ...event,
      uri: `${event.uri.slice(0, -13)}${String(index).padStart(13, '0')}`,
      content: JSON.stringify({ ...EVENT_FIXTURE, uid: `series-${index}`, description: 'x'.repeat(65536) }),
    }));
    const { store, projector } = setup();
    for (const post of posts) store.applyHydration({ status: 'present', post });
    const read = vi.spyOn(store, 'allSources');
    expect(await pool(projector).execute(query)).toEqual({ ok: false, reason: 'unavailable' });
    expect(read).not.toHaveBeenCalled();
    expect(projector.query(query.query)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    const many = Array.from({ length: 5001 }, (_, index) => ({
      ...event,
      uri: `${event.uri.slice(0, -13)}${String(index).padStart(13, '0')}`,
      content: '{}',
    }));
    const count = setup();
    for (const post of many) count.store.applyHydration({ status: 'present', post });
    const countRead = vi.spyOn(count.store, 'allSources');
    expect(await pool(count.projector).execute(query)).toEqual({ ok: false, reason: 'unavailable' });
    expect(countRead).not.toHaveBeenCalled();
    expect(count.store.feedSnapshot(100000, 1000000000).sources).toBeNull();
    expect(count.projector.status().coverage.reasons).toContain('source-count-limit');
  });

  it('fails closed under a real dense recurrence workload while the parent event loop advances', async () => {
    const posts = Array.from({ length: 500 }, (_, index) => ({
      ...event,
      uri: `${event.uri.slice(0, -13)}${String(index).padStart(13, '0')}`,
      content: JSON.stringify({
        ...EVENT_FIXTURE,
        uid: `dense-${index}`,
        rrule: 'FREQ=DAILY;COUNT=93',
        overrides: [],
        rdate: [],
        exdate: [],
      }),
    }));
    const { projector } = setup([calendar, ...posts]);
    let ticks = 0;
    const pulse = setInterval(() => {
      ticks++;
    }, 20);
    try {
      const result = await pool(projector).execute({
        operation: 'query',
        query: { ...query.query, to: '2027-01-01T00:00:00Z' },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(['timeout', 'unavailable']).toContain(result.reason);
      expect(ticks).toBeGreaterThan(0);
    } finally {
      clearInterval(pulse);
    }
  });

  it('refuses work when parent V8 flags override the actual worker heap limit', () => {
    const { projector } = setup();
    const data = { snapshot: projector.snapshot(), work: query, heapMb: 16 };
    const source = `const {Worker}=require('node:worker_threads');const worker=new Worker(${JSON.stringify(built.workerPath)},{workerData:${JSON.stringify(data)},env:{},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:16,maxYoungGenerationSizeMb:16,stackSizeMb:4}});worker.once('message',value=>process.stdout.write(JSON.stringify(value)));`;
    const child = spawnSync(process.execPath, ['-e', source], {
      encoding: 'utf8',
      env: { NODE_ENV: 'test', NODE_OPTIONS: '--max-old-space-size=256' },
      timeout: 3000,
    });
    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('rejects oversized inventory staging before promotion and keeps previous sources unpublished', () => {
    const { store, projector } = setup();
    const previous = store.metadata().checkpoint;
    store.beginInventory();
    const posts = Array.from({ length: 129 }, (_, index) => ({
      ...event,
      uri: `${event.uri.slice(0, -13)}${String(index).padStart(13, '0')}`,
      content: JSON.stringify({ ...EVENT_FIXTURE, uid: `staged-${index}`, description: 'x'.repeat(65536) }),
    }));
    store.stageInventory(posts.slice(0, 100));
    expect(() => store.stageInventory(posts.slice(100))).toThrow('bounded source');
    expect(store.metadata().checkpoint).toBe(previous);
    expect(projector.status().coverage.complete).toBe(false);
    expect(projector.subscription(calendar.uri).status).toBe(503);
  });

  it('migrates legacy snapshots and budgets UTF-8 bodies using the covering index', () => {
    const path = built.fixture('legacy-budget', '');
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      INSERT INTO metadata VALUES ('schema_version','1');
      CREATE TABLE sources (uri TEXT PRIMARY KEY,kind TEXT NOT NULL,content TEXT NOT NULL,hash TEXT NOT NULL,state TEXT NOT NULL,updated_at TEXT NOT NULL);`);
    const content = JSON.stringify({ ...EVENT_FIXTURE, summary: 'Meeting 🌍' });
    legacy
      .prepare('INSERT INTO sources VALUES(?,?,?,?,?,?)')
      .run(event.uri, 'event', content, 'legacy-hash', 'valid', new Date().toISOString());
    legacy.close();
    const store = new ProjectionStore(path, 'test-nexus', 'explicit-fixtures');
    stores.push(store);
    const bytes = Buffer.byteLength(content);
    expect(store.sourceStats()).toMatchObject({ total: 1, bytes });
    expect(store.feedSnapshot(5000, bytes).sources).toHaveLength(1);
    expect(store.feedSnapshot(5000, bytes - 1).sources).toBeNull();
    store.applyHydration({ status: 'present', post: event });
    expect(store.sourceStats().bytes).toBe(Buffer.byteLength(event.content));
    store.applyHydration({ status: 'deleted', uri: event.uri });
    expect(store.sourceStats().bytes).toBe(0);
  });

  it('cancels active and queued requests without retaining their slots', async () => {
    const { projector } = setup();
    const workers = pool(projector, { workerPath: hung, concurrency: 1 });
    const running = new AbortController();
    const queued = new AbortController();
    const first = workers.execute(query, running.signal);
    const second = workers.execute(query, queued.signal);
    queued.abort();
    running.abort();
    expect(await second).toEqual({ ok: false, reason: 'cancelled' });
    expect(await first).toEqual({ ok: false, reason: 'cancelled' });
    await workers.close();
    expect(workers.stats()).toMatchObject({ active: 0, queued: 0, closed: true });
  });
});
