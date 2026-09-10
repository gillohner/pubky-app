import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildSync } from 'esbuild';

/** Tests build the real production worker entry; no TypeScript loader runs in worker threads. */
export function buildTestWorkers() {
  const directory = mkdtempSync(join(tmpdir(), 'eventky-workers-'));
  const workerPath = join(directory, 'worker.cjs');
  buildSync({
    entryPoints: [resolve('services/eventky-projection/src/worker.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    outfile: workerPath,
    logLevel: 'silent',
  });
  const fixture = (name: string, source: string) => {
    const path = join(directory, `${name}.cjs`);
    writeFileSync(path, source);
    return path;
  };
  return { workerPath, fixture, close: () => rmSync(directory, { recursive: true, force: true }) };
}

/** Bypass the app unit project's browser fetch mock when testing the real loopback HTTP server. */
export function fetchLoopback(
  url: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const outgoing = request(url, { method: options.method ?? 'GET', headers: options.headers }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.once('error', reject);
      incoming.once('end', () => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers))
          if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        const status = incoming.statusCode ?? 500;
        resolve(
          new Response(options.method === 'HEAD' || status === 304 ? null : Buffer.concat(chunks), { status, headers }),
        );
      });
    });
    outgoing.once('error', reject);
    outgoing.end();
  });
}
