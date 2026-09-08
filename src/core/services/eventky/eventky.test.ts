import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  occurrencePageFixture,
  projectedOccurrenceFixture,
  projectionPostUri,
} from '@/test/fixtures/eventkyProjection';
import { EventkyService } from './eventky';

const query = { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z', timezone: 'Europe/Zurich' };
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('EventkyService', () => {
  it('preserves exact query filters, repeated calendars, cancellation false and abort signals', async () => {
    const page = occurrencePageFixture();
    fetchMock.mockResolvedValue(Response.json({ ok: true, value: page }));
    const abort = new AbortController();
    const result = await EventkyService.fetchOccurrences(
      {
        ...query,
        calendars: [projectionPostUri, projectionPostUri.replace(/1$/, '2')],
        author: 'y'.repeat(52),
        include_cancelled: false,
        limit: 100,
        cursor: 'a+b&c',
      },
      abort.signal,
    );
    expect(result).toEqual({ ok: true, value: page });
    const [url, options] = fetchMock.mock.calls[0];
    const params = new URL(String(url), 'https://example.test').searchParams;
    expect(params.getAll('calendar')).toEqual([projectionPostUri, projectionPostUri.replace(/1$/, '2')]);
    expect(params.get('cursor')).toBe('a+b&c');
    expect(params.get('include_cancelled')).toBe('false');
    expect(params.get('timezone')).toBe('Europe/Zurich');
    expect(options).toMatchObject({ signal: abort.signal, cache: 'no-store' });
  });

  it.each(['INVALID_QUERY', 'STALE_CURSOR', 'NOT_READY', 'UNAVAILABLE'] as const)(
    'preserves recoverable %s responses on unsuccessful HTTP requests',
    async (code) => {
      const failure = { ok: false, code, message: 'Safe server message' };
      fetchMock.mockResolvedValue(Response.json(failure, { status: 400 }));
      expect(await EventkyService.fetchOccurrences(query)).toEqual(failure);
    },
  );

  it('rejects mismatched identities rather than hydrating the wrong post', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        ok: true,
        value: occurrencePageFixture([{ ...projectedOccurrenceFixture, post_id: 'different:post' }]),
      }),
    );
    expect(await EventkyService.fetchOccurrences(query)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  });

  it('does not trust a success envelope from an unsuccessful HTTP response', async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true, value: occurrencePageFixture() }, { status: 503 }));
    expect(await EventkyService.fetchOccurrences(query)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  });

  it('contains network failure, unreadable JSON and malformed success payloads', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    fetchMock.mockResolvedValueOnce(new Response('<html>gateway error</html>', { status: 502 }));
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true, value: { items: [] } }));
    for (let index = 0; index < 3; index++)
      expect(await EventkyService.fetchOccurrences(query)).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
        message: 'Calendar results are unavailable.',
      });
  });
});
