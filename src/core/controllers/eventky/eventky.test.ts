import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  occurrencePageFixture,
  projectedOccurrenceFixture,
  projectionPostUri,
} from '@/test/fixtures/eventkyProjection';
import { EventkyController } from './eventky';

afterEach(() => vi.unstubAllGlobals());
describe('calendar query public boundary', () => {
  it('returns one validated revision through controller, application and HTTP service with exact filters', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValueOnce(
      Response.json({ ok: true, value: { ...occurrencePageFixture(), next_cursor: 'next-page' } }),
    );
    fetchMock.mockResolvedValueOnce(
      Response.json({
        ok: true,
        value: occurrencePageFixture([{ ...projectedOccurrenceFixture, occurrence_key: 'another-date' }]),
      }),
    );
    const result = await EventkyController.fetchOccurrences({
      from: '2026-10-01T00:00:00Z',
      to: '2026-11-01T00:00:00Z',
      timezone: 'Europe/Zurich',
      calendars: [projectionPostUri],
      include_cancelled: false,
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        projection_revision: 4,
        coverage: { complete: true },
        items: [
          expect.objectContaining({ occurrence_key: projectedOccurrenceFixture.occurrence_key }),
          expect.objectContaining({ occurrence_key: 'another-date' }),
        ],
      },
    });
    const next = new URL(String(fetchMock.mock.calls[1][0]), 'https://example.test');
    expect(next.searchParams.get('cursor')).toBe('next-page');
    expect(next.searchParams.getAll('calendar')).toEqual([projectionPostUri]);
    expect(next.searchParams.get('include_cancelled')).toBe('false');
  });
});
