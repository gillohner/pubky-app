// @vitest-environment node
import { EVENT_FIXTURE, FIXTURE_EVENT_URI } from '@eventky/fixtures';
import { describe, expect, it, vi } from 'vitest';
import { NexusProjectionSource } from './nexus';
import { ProjectionStore } from './store';
import { ProjectionSync } from './sync';

const token = 'local-test-sync-token-at-least-32-bytes';
const source = { uri: FIXTURE_EVENT_URI, kind: 'event', content: JSON.stringify(EVENT_FIXTURE) };
const head = { epoch: 'epoch-a', revision: '9007199254740993', minimum_revision: '9007199254730993' };
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe('private Nexus projection adapter', () => {
  it('keeps decimal revisions exact and sends the token only to the fixed source origin', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reply(head))
      .mockResolvedValueOnce(
        reply({ ...head, items: [{ revision: head.revision, uri: source.uri, post: source }], next_cursor: null }),
      )
      .mockResolvedValueOnce(reply(head))
      .mockResolvedValueOnce(
        reply({ ...head, items: [], cursor: head.revision, through: head.revision, caught_up: true }),
      );
    const adapter = new NexusProjectionSource('https://nexus.example', token, request);
    const inventory = await adapter.inventory();
    const changes = await adapter.changes(inventory.checkpoint);
    expect(changes.caught_up).toBe(true);
    expect(inventory.posts).toEqual([source]);
    expect(String(request.mock.calls[1][0])).toContain(`since=${head.revision}`);
    for (const [url, init] of request.mock.calls) {
      expect(String(url).startsWith('https://nexus.example/v0/projection/posts/')).toBe(true);
      expect(init).toMatchObject({ redirect: 'error', headers: { Authorization: `Bearer ${token}` } });
    }
  });

  it('retries the throttled inventory request without repeatedly consuming the head allowance', async () => {
    const pause = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reply(head))
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '3' } }))
      .mockResolvedValueOnce(reply({ ...head, items: [], next_cursor: null }));
    const adapter = new NexusProjectionSource('https://nexus.example', token, request, pause);
    await expect(adapter.inventory()).resolves.toMatchObject({ posts: [], next_cursor: null });
    expect(pause).toHaveBeenCalledWith(3000);
    expect(String(request.mock.calls[0][0])).toContain('/head');
    expect(request.mock.calls[1][0]).toBe(request.mock.calls[2][0]);
  });

  it('bounds persistent rate limiting and backs off on malformed retry headers', async () => {
    const pause = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue();
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(null, { status: 429, headers: { 'Retry-After': 'invalid' } }));
    const adapter = new NexusProjectionSource('https://nexus.example', token, request, pause);
    await expect(adapter.inventory()).rejects.toThrow('bounded retries');
    expect(request).toHaveBeenCalledTimes(6);
    expect(pause.mock.calls.map(([delay]) => delay)).toEqual([1000, 2000, 4000, 8000, 16000]);
  });

  it('restarts inventory on an expired or restored source cursor', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reply(head))
      .mockResolvedValueOnce(reply({ ...head, items: [], next_cursor: null }))
      .mockResolvedValueOnce(reply({ ...head, epoch: 'restored' }));
    const adapter = new NexusProjectionSource('https://nexus.example', token, request);
    const inventory = await adapter.inventory();
    expect(await adapter.changes(inventory.checkpoint)).toMatchObject({ reset: true, caught_up: false, changes: [] });
  });

  it('treats HTTP 410 during replay as an explicit reset', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reply(head))
      .mockResolvedValueOnce(reply({ ...head, items: [], next_cursor: null }))
      .mockResolvedValueOnce(reply(head))
      .mockResolvedValueOnce(reply({}, 410));
    const adapter = new NexusProjectionSource('https://nexus.example', token, request);
    const inventory = await adapter.inventory();
    expect(await adapter.changes(inventory.checkpoint)).toMatchObject({ reset: true });
  });

  it('never substitutes Redis hydration for missing committed source payloads', async () => {
    const request = vi.fn<typeof fetch>();
    const adapter = new NexusProjectionSource('https://nexus.example', token, request);
    expect(await adapter.hydrate(source.uri)).toEqual({ status: 'unavailable', uri: source.uri });
    expect(request).not.toHaveBeenCalled();
  });

  it('replays changes over the entire staged inventory before promotion', async () => {
    const initialHead = { epoch: 'epoch-a', revision: '1', minimum_revision: '0' };
    const finalHead = { ...initialHead, revision: '3' };
    const replacement = { ...source, content: JSON.stringify({ ...EVENT_FIXTURE, summary: 'Changed during scan' }) };
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reply(initialHead))
      .mockResolvedValueOnce(
        reply({ ...initialHead, items: [{ revision: '1', uri: source.uri, post: source }], next_cursor: null }),
      )
      .mockResolvedValueOnce(reply(finalHead))
      .mockResolvedValueOnce(
        reply({
          ...finalHead,
          items: [
            { revision: '2', uri: source.uri, post: null },
            { revision: '3', uri: source.uri, post: replacement },
          ],
          cursor: '3',
          through: '3',
          caught_up: true,
        }),
      )
      .mockResolvedValueOnce(reply(finalHead));
    const adapter = new NexusProjectionSource('https://nexus.example', token, request);
    const store = new ProjectionStore(':memory:', adapter.backendId);
    try {
      await new ProjectionSync(store, adapter).reconcile();
      expect(JSON.parse(store.getSource(source.uri)!.content).summary).toBe('Changed during scan');
      expect(store.metadata().reconciled_at).not.toBeNull();
    } finally {
      store.close();
    }
  });

  it('preserves prior data if retention expires before replay promotion', async () => {
    const firstHead = { epoch: 'epoch-a', revision: '1', minimum_revision: '0' };
    const finalHead = { ...firstHead, revision: '3' };
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reply(firstHead))
      .mockResolvedValueOnce(reply({ ...firstHead, items: [], next_cursor: null }))
      .mockResolvedValueOnce(reply(finalHead))
      .mockResolvedValueOnce(reply({ ...finalHead, items: [], cursor: '3', through: '3', caught_up: true }))
      .mockResolvedValueOnce(reply({ ...finalHead, minimum_revision: '2' }));
    const adapter = new NexusProjectionSource('https://nexus.example', token, request);
    const store = new ProjectionStore(':memory:', adapter.backendId);
    try {
      store.applyHydration({ status: 'present', post: source });
      await expect(new ProjectionSync(store, adapter).reconcile()).rejects.toThrow('no longer retained');
      expect(store.getSource(source.uri)).not.toBeNull();
    } finally {
      store.close();
    }
  });
});
