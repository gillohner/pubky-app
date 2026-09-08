import { createHash, webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventkySourceHash } from './sourceHash';

afterEach(() => vi.unstubAllGlobals());
describe('eventky source revision hashing', () => {
  it('matches the server digest for exact UTF-8 wire bytes, including the NUL separator', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const content = '{ "summary": "📅 Zürich" }';
    expect(await eventkySourceHash('event', content)).toBe(
      createHash('sha256').update(`event\0${content}`).digest('hex'),
    );
    expect(await eventkySourceHash('Event', content)).not.toBe(await eventkySourceHash('event', content));
    expect(await eventkySourceHash('event', content)).not.toBe(
      await eventkySourceHash('event', JSON.stringify(JSON.parse(content))),
    );
  });
});
