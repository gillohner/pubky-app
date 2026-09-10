// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CALENDAR_FIXTURE,
  EVENT_FIXTURE,
  FIXTURE_CALENDAR_URI,
  FIXTURE_CONTRIBUTOR,
  FIXTURE_EVENT_URI,
} from '@eventky/fixtures';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CalendarProjector } from './projector';
import { ProjectionStore } from './store';
import { ProjectionSync } from './sync';
import type { SourceAdapter, SourcePost } from './types';

const calendar: SourcePost = { uri: FIXTURE_CALENDAR_URI, kind: 'calendar', content: JSON.stringify(CALENDAR_FIXTURE) };
const event: SourcePost = { uri: FIXTURE_EVENT_URI, kind: 'event', content: JSON.stringify(EVENT_FIXTURE) };
const range = {
  from: '2026-10-01T00:00:00Z',
  to: '2026-11-15T00:00:00Z',
  timezone: 'Europe/Zurich',
  calendars: [FIXTURE_CALENDAR_URI],
};
const stores: ProjectionStore[] = [];
function setup(sources: SourcePost[] = [calendar, event]) {
  const store = new ProjectionStore(':memory:', 'test-nexus', 'explicit-fixtures');
  stores.push(store);
  store.beginInventory();
  store.stageInventory(sources);
  store.finishInventory('epoch:1');
  store.setReady(true);
  return { store, projector: new CalendarProjector(store) };
}
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('calendar projection integrity', () => {
  it('expands an old series in event-time order with its stable native post identity', () => {
    const { projector } = setup();
    const result = projector.query(range);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.coverage.complete).toBe(true);
    expect(result.value.items).toHaveLength(6);
    expect(result.value.items[0].post_id).toBe(`${FIXTURE_CONTRIBUTOR}:0034A0X7NJ52B`);
    expect(new Date(result.value.items[0].start_epoch_ms).toISOString()).toBe('2026-10-01T16:00:00.000Z');
    expect(new Date(result.value.items[4].start_epoch_ms).toISOString()).toBe('2026-10-29T17:00:00.000Z');
    expect(result.value.items.every((item) => !('content' in item) && !('summary' in item))).toBe(true);
  });

  it('enforces membership from the actual author and recalculates after contributor revocation', () => {
    const { projector, store } = setup();
    store.applyHydration({
      status: 'present',
      post: { ...calendar, content: JSON.stringify({ ...CALENDAR_FIXTURE, contributors: [] }) },
    });
    const result = projector.query(range);
    expect(result.ok && result.value.items).toEqual([]);
    const independent = projector.query({ ...range, calendars: [] });
    expect(independent.ok && independent.value.items.length).toBe(6);
  });

  it('honors owner exclusion without deleting the event post', () => {
    const { projector, store } = setup();
    store.applyHydration({
      status: 'present',
      post: { ...calendar, content: JSON.stringify({ ...CALENDAR_FIXTURE, excluded_event_uris: [FIXTURE_EVENT_URI] }) },
    });
    const result = projector.query(range);
    expect(result.ok && result.value.items).toEqual([]);
    expect(store.getSource(FIXTURE_EVENT_URI)).not.toBeNull();
  });

  it('binds pagination to query and source revision and rejects tampered cursors', () => {
    const { projector, store } = setup();
    const first = projector.query({ ...range, limit: 2 });
    if (!first.ok || !first.value.next_cursor) throw new Error('Missing first page');
    const next = projector.query({ ...range, limit: 2, cursor: first.value.next_cursor });
    expect(next.ok && next.value.items[0].start.value).toBe('2026-10-15T18:00:00');
    expect(projector.query({ ...range, timezone: 'UTC', limit: 2, cursor: first.value.next_cursor })).toMatchObject({
      ok: false,
      code: 'STALE_CURSOR',
    });
    expect(projector.query({ ...range, limit: 2, cursor: `${first.value.next_cursor}x` })).toMatchObject({
      ok: false,
      code: 'STALE_CURSOR',
    });
    store.applyHydration({ status: 'deleted', uri: FIXTURE_EVENT_URI });
    expect(projector.query({ ...range, limit: 2, cursor: first.value.next_cursor })).toMatchObject({
      ok: false,
      code: 'STALE_CURSOR',
    });
  });

  it('does not remove prior records when an inventory scan fails partway through', async () => {
    const { store, projector } = setup();
    const adapter: SourceAdapter = {
      backendId: 'test-nexus',
      inventory: vi
        .fn()
        .mockResolvedValueOnce({ posts: [calendar], next_cursor: 'page2', checkpoint: 'epoch:2' })
        .mockRejectedValueOnce(new Error('offline')),
      changes: vi.fn(),
      hydrate: vi.fn(),
    };
    await expect(new ProjectionSync(store, adapter).reconcile()).rejects.toThrow('offline');
    expect(store.getSource(FIXTURE_EVENT_URI)).not.toBeNull();
    expect(projector.status().coverage.complete).toBe(false);
  });

  it('rejects changing snapshot watermarks instead of silently claiming complete enumeration', async () => {
    const { store } = setup();
    const adapter: SourceAdapter = {
      backendId: 'test-nexus',
      inventory: vi
        .fn()
        .mockResolvedValueOnce({ posts: [], next_cursor: 'page2', checkpoint: 'epoch:2' })
        .mockResolvedValueOnce({ posts: [], next_cursor: null, checkpoint: 'epoch:3' }),
      changes: vi.fn(),
      hydrate: vi.fn(),
    };
    await expect(new ProjectionSync(store, adapter).reconcile()).rejects.toThrow('snapshot changed');
    expect(store.getSource(FIXTURE_EVENT_URI)).not.toBeNull();
  });

  it('hydrates the current source for a delayed deletion invalidation after recreation', async () => {
    const { store, projector } = setup();
    const adapter: SourceAdapter = {
      backendId: 'test-nexus',
      inventory: vi.fn(),
      changes: vi.fn().mockResolvedValue({ checkpoint: 'epoch:2', changes: [{ uri: event.uri }], caught_up: true }),
      hydrate: vi.fn().mockResolvedValue({ status: 'present', post: event }),
    };
    await new ProjectionSync(store, adapter).tick();
    expect(projector.query(range)).toMatchObject({ ok: true, value: { coverage: { complete: true } } });
    expect(store.pendingCount()).toBe(0);
    expect(store.getSource(event.uri)).not.toBeNull();
  });

  it('retains unresolved jobs and makes an unavailable record explicit instead of deleting it', async () => {
    const { store, projector } = setup();
    const adapter: SourceAdapter = {
      backendId: 'test-nexus',
      inventory: vi.fn(),
      changes: vi.fn().mockResolvedValue({ checkpoint: 'epoch:2', changes: [{ uri: event.uri }], caught_up: true }),
      hydrate: vi.fn().mockRejectedValue(new Error('503')),
    };
    await new ProjectionSync(store, adapter).tick();
    expect(store.pendingCount()).toBe(1);
    expect(store.getSource(event.uri)?.state).toBe('unavailable');
    expect(projector.status().coverage.reasons).toContain('source-records-unavailable');
    expect(projector.status().coverage.complete).toBe(false);
  });

  it('does not duplicate source revisions on replay and removes posts that changed to another kind', () => {
    const { store, projector } = setup();
    const revision = store.metadata().revision;
    store.applyHydration({ status: 'present', post: event });
    expect(store.metadata().revision).toBe(revision);
    store.applyHydration({ status: 'present', post: { ...event, kind: 'short', content: 'Changed format' } });
    expect(projector.query(range)).toMatchObject({ ok: true, value: { items: [] } });
  });

  it('reports invalid records and work limits as incomplete rather than an authoritative empty schedule', () => {
    const { projector } = setup([calendar, { ...event, content: '{}' }]);
    const result = projector.query(range);
    expect(result).toMatchObject({
      ok: true,
      value: { coverage: { complete: false, reasons: ['unsupported-or-invalid-records'] } },
    });
  });

  it('survives restart with queued invalidations and a stable cursor key', () => {
    const directory = mkdtempSync(join(tmpdir(), 'eventky-store-test-'));
    const path = join(directory, 'projection.sqlite');
    try {
      const first = new ProjectionStore(path, 'test-nexus');
      first.enqueue([event.uri], 'epoch:5', false);
      const key = first.cursorKey();
      first.close();
      const reopened = new ProjectionStore(path, 'test-nexus');
      expect(reopened.metadata().checkpoint).toBe('epoch:5');
      expect(reopened.dueJobs()).toEqual([event.uri]);
      expect(reopened.cursorKey()).toBe(key);
      reopened.close();
      expect(() => new ProjectionStore(path, 'other-nexus')).toThrow('different Nexus');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
