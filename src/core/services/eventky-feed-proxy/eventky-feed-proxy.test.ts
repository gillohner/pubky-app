import { FIXTURE_CALENDAR_URI } from '@eventky/fixtures';
import { CALENDAR_FEED_MAX_BYTES } from '@eventky-api/feed';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventkyFeedProxyService } from './eventky-feed-proxy';

const { fetchMock, factory } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  factory: vi.fn((code, message, details) => Object.assign(new Error(message), { code, ...details })),
}));
vi.mock('@/libs/env/env', () => ({ Env: { EVENTKY_PROJECTION_URL: 'http://projection.internal:8091' } }));
vi.mock('@/libs/error/error.http', () => ({ safeFetch: fetchMock }));
vi.mock('@/libs/error/error.factories', () => ({ Err: { server: factory } }));
vi.mock('@/libs/error/error.utils', () => ({ toAppError: (e: unknown) => e }));

const etag = `"${'a'.repeat(64)}"`;
const body = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
const headers = {
  'Content-Type': 'text/calendar; charset=utf-8',
  ETag: etag,
  'Last-Modified': 'Tue, 08 Sep 2026 12:00:00 GMT',
  'X-Eventky-Coverage': 'complete',
};
afterEach(() => {
  vi.clearAllMocks();
});

describe('calendar subscription transport boundary', () => {
  it('uses the configured fixed upstream and forwards only conditional headers', async () => {
    fetchMock.mockResolvedValue(
      new Response(body, {
        headers: { ...headers, 'Set-Cookie': 'upstream-secret=1', Location: 'https://example.org' },
      }),
    );
    const result = await EventkyFeedProxyService.read(FIXTURE_CALENDAR_URI, { ifNoneMatch: etag });
    expect(result.status).toBe(200);
    expect(result.body).toBe(body);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `http://projection.internal:8091/v1/calendar.ics?${new URLSearchParams({ calendar: FIXTURE_CALENDAR_URI })}`,
    );
    expect(init).toMatchObject({
      method: 'GET',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      headers: { Accept: 'text/calendar', 'If-None-Match': etag },
    });
    expect(result.headers).not.toHaveProperty('Set-Cookie');
    expect(result.headers).not.toHaveProperty('Location');
  });

  it('supports valid 304 and HEAD without reading an absent body', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304, headers }));
    expect(await EventkyFeedProxyService.read(FIXTURE_CALENDAR_URI, { ifNoneMatch: etag })).toMatchObject({
      status: 304,
      body: null,
    });
    fetchMock.mockResolvedValueOnce(new Response(null, { headers }));
    expect(await EventkyFeedProxyService.read(FIXTURE_CALENDAR_URI, { head: true })).toMatchObject({
      status: 200,
      body: null,
    });
    expect(fetchMock.mock.calls[1][1].method).toBe('HEAD');
  });

  it('maps expected upstream failures to static public text and strips arbitrary content', async () => {
    fetchMock.mockResolvedValue(new Response('private upstream diagnostics', { status: 503 }));
    const result = await EventkyFeedProxyService.read(FIXTURE_CALENDAR_URI, {});
    expect(result).toMatchObject({ status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } });
    expect(result.body).not.toContain('private');
  });

  it('retains unexpected response diagnostics internally and rejects malformed success bodies', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('bounded diagnostic body', { status: 502, statusText: 'Bad Gateway' }),
    );
    const failure = await EventkyFeedProxyService.read(FIXTURE_CALENDAR_URI, {}).catch((e) => e);
    expect(failure.context).toMatchObject({ httpStatus: 502, statusText: 'Bad Gateway' });
    expect(failure.responseBody).toBe('bounded diagnostic body');
    expect(JSON.stringify(failure)).not.toContain('bounded diagnostic body');
    fetchMock.mockResolvedValueOnce(new Response('BEGIN:VCALENDAR\r\n', { headers }));
    await expect(EventkyFeedProxyService.read(FIXTURE_CALENDAR_URI, {})).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    fetchMock.mockResolvedValueOnce(
      new Response(body, { headers: { ...headers, 'X-Eventky-Coverage': 'incomplete' } }),
    );
    await expect(EventkyFeedProxyService.read(FIXTURE_CALENDAR_URI, {})).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('enforces byte limits, UTF-8 validity and conditional-response preconditions', async () => {
    fetchMock.mockResolvedValueOnce(new Response('x'.repeat(CALENDAR_FEED_MAX_BYTES + 1), { headers }));
    await expect(EventkyFeedProxyService.read(FIXTURE_CALENDAR_URI, {})).rejects.toMatchObject({
      context: { bodyState: 'oversized' },
    });
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([0xff, 0xfe]), { headers }));
    await expect(EventkyFeedProxyService.read(FIXTURE_CALENDAR_URI, {})).rejects.toBeDefined();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304, headers }));
    await expect(EventkyFeedProxyService.read(FIXTURE_CALENDAR_URI, {})).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
