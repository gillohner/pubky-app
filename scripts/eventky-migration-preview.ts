import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { z } from 'zod';
import { prepareLegacyMigration } from '../packages/eventky-contract/src/migration';

const schema = z.object({
  owner: z.string().regex(/^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/),
  now: z.iso.datetime(),
  uriMap: z.record(z.string(), z.string()),
  records: z.array(z.object({ uri: z.string(), data: z.unknown() })).max(500),
});

try {
  const path = process.argv[2];
  if (!path) throw new Error('Usage: eventky-migration-preview <input.json>');
  const maximum = 8 * 1024 * 1024;
  const descriptor = openSync(path, 'r');
  let input: Buffer;
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile()) throw new Error('Preview input must be a regular file.');
    if (info.size > maximum) throw new Error('Preview input exceeds 8 MiB.');
    const buffer = Buffer.alloc(maximum + 1);
    let size = 0;
    for (;;) {
      const count = readSync(descriptor, buffer, size, buffer.length - size, null);
      size += count;
      if (size > maximum) throw new Error('Preview input exceeds 8 MiB.');
      if (!count) break;
    }
    input = buffer.subarray(0, size);
  } finally {
    closeSync(descriptor);
  }
  const parsed = schema.safeParse(JSON.parse(input.toString('utf8')));
  if (!parsed.success) throw new Error('Input must contain owner, now, uriMap and at most 500 records.');
  const { records, ...options } = parsed.data;
  const report = prepareLegacyMigration(records, options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.errors.length || [...report.calendars, ...report.events].some((entry) => entry.errors.length))
    process.exitCode = 2;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Migration preview failed.'}\n`);
  process.exitCode = 1;
}
