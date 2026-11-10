import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { createProjectionServer } from './http';
import { NexusProjectionSource } from './nexus';
import { CalendarProjector } from './projector';
import { ProjectionStore } from './store';
import { ProjectionSync } from './sync';
import { hasWorkerHeapOverride, ProjectionWorkers } from './workers';

const config = z
  .object({
    EVENTKY_NEXUS_URL: z.url(),
    EVENTKY_NEXUS_SYNC_TOKEN: z.string().min(32),
    EVENTKY_DATABASE: z.string().min(1).default('./data/eventky.sqlite'),
    EVENTKY_BIND: z.string().default('127.0.0.1'),
    EVENTKY_PORT: z.coerce.number().int().min(1).max(65535).default(8091),
    EVENTKY_WORKERS: z.coerce.number().int().min(1).max(2).default(2),
    EVENTKY_POLL_MS: z.coerce.number().int().min(1000).max(30000).default(5000),
  })
  .safeParse(process.env);
if (!config.success)
  throw new Error(
    `Missing or invalid projection settings: ${config.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
  );
const settings = config.data;
if (hasWorkerHeapOverride())
  throw new Error(
    'Global V8 heap flags override worker limits. Remove heap flags from NODE_OPTIONS and Node arguments; use a container memory limit.',
  );
const source = new NexusProjectionSource(settings.EVENTKY_NEXUS_URL, settings.EVENTKY_NEXUS_SYNC_TOKEN);
mkdirSync(dirname(settings.EVENTKY_DATABASE), { recursive: true, mode: 0o700 });
const store = new ProjectionStore(settings.EVENTKY_DATABASE, source.backendId);
const sync = new ProjectionSync(store, source);
const projector = new CalendarProjector(store);
const workers = new ProjectionWorkers(projector, {
  workerPath: join(__dirname, 'worker.cjs'),
  concurrency: settings.EVENTKY_WORKERS,
});
const server = createProjectionServer(projector, workers);
let stopping = false;
let timer: ReturnType<typeof setTimeout> | undefined;
async function poll() {
  try {
    await sync.tick();
  } catch {
    console.warn('[eventky-projection] Source synchronization failed; serving explicit incomplete coverage.');
  } finally {
    if (!stopping)
      timer = setTimeout(() => {
        void poll();
      }, settings.EVENTKY_POLL_MS);
  }
}
server.listen(settings.EVENTKY_PORT, settings.EVENTKY_BIND, () => {
  void poll();
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.maxRequestsPerSocket = 100;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (timer) clearTimeout(timer);
  server.close();
  await workers.close();
  // In-flight synchronization owns the database until it finishes; process exit closes SQLite safely.
  server.closeIdleConnections();
  setTimeout(() => {
    store.close();
    process.exit(0);
  }, 16000).unref();
}
process.on('SIGTERM', () => {
  void stop();
});
process.on('SIGINT', () => {
  void stop();
});
