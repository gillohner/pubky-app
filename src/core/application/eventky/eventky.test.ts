import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventkyService } from '@/services/eventky/eventky';
import {
  occurrencePageFixture,
  projectedOccurrenceFixture,
  projectionPostUri,
} from '@/test/fixtures/eventkyProjection';
import { EventkyApplication } from './eventky';

vi.mock('@/services/eventky/eventky', () => ({ EventkyService: { fetchOccurrences: vi.fn() } }));
const fetchPage = vi.mocked(EventkyService.fetchOccurrences);
const query = {
  from: '2026-10-01T00:00:00Z',
  to: '2026-11-01T00:00:00Z',
  timezone: 'UTC',
  calendars: [projectionPostUri],
};
beforeEach(() => vi.clearAllMocks());

describe('EventkyApplication', () => {
  it('follows opaque cursors with exact filters, deduplicates occurrences and keeps incomplete coverage', async () => {
    const first = occurrencePageFixture();
    first.next_cursor = 'opaque+cursor';
    first.coverage.complete = false;
    first.coverage.reasons = ['pending changes'];
    const second = occurrencePageFixture([
      projectedOccurrenceFixture,
      { ...projectedOccurrenceFixture, occurrence_key: 'second' },
    ]);
    fetchPage.mockResolvedValueOnce({ ok: true, value: first }).mockResolvedValueOnce({ ok: true, value: second });
    const abort = new AbortController();
    const result = await EventkyApplication.fetchOccurrences(query, abort.signal);
    expect(fetchPage).toHaveBeenNthCalledWith(2, { ...query, limit: 100, cursor: 'opaque+cursor' }, abort.signal);
    expect(result).toMatchObject({
      ok: true,
      value: {
        items: [projectedOccurrenceFixture, expect.objectContaining({ occurrence_key: 'second' })],
        coverage: { complete: false, reasons: ['pending changes'] },
      },
    });
  });

  it('rejects a cross-page revision change rather than mixing snapshots', async () => {
    fetchPage.mockResolvedValueOnce({ ok: true, value: { ...occurrencePageFixture(), next_cursor: 'next' } });
    fetchPage.mockResolvedValueOnce({ ok: true, value: { ...occurrencePageFixture(), projection_revision: 5 } });
    expect(await EventkyApplication.fetchOccurrences(query)).toMatchObject({ ok: false, code: 'STALE_CURSOR' });
  });

  it('does not report complete results if a later page fails', async () => {
    fetchPage.mockResolvedValueOnce({ ok: true, value: { ...occurrencePageFixture(), next_cursor: 'next' } });
    fetchPage.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE', message: 'offline' });
    expect(await EventkyApplication.fetchOccurrences(query)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
      message: 'offline',
    });
  });

  it('bounds runaway pagination and marks the returned subset incomplete', async () => {
    fetchPage.mockResolvedValue({ ok: true, value: { ...occurrencePageFixture(), next_cursor: 'looping-cursor' } });
    const result = await EventkyApplication.fetchOccurrences(query);
    expect(fetchPage).toHaveBeenCalledTimes(10);
    expect(result).toMatchObject({ ok: true, value: { coverage: { complete: false } } });
  });
});
