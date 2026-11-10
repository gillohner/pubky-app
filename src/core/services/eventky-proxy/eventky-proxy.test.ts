import { describe, expect, it, vi } from 'vitest';
import { EventkyProxyService } from './eventky-proxy';

const { fetchMock, factory } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  factory: vi.fn((code, message, details) => Object.assign(new Error(message), { code, ...details })),
}));
vi.mock('@/libs/env/env', () => ({ Env: { EVENTKY_PROJECTION_URL: 'http://projection.internal:8091/' } }));
vi.mock('@/libs/error/error.http', () => ({ safeFetch: fetchMock }));
vi.mock('@/libs/error/error.factories', () => ({ Err: { server: factory } }));
vi.mock('@/libs/error/error.utils', () => ({ toAppError: (error: unknown) => error }));

const headers = { 'Content-Type': 'application/json; charset=utf-8' };
const success = {
  ok: true,
  value: {
    items: [],
    next_cursor: null,
    projection_revision: 7,
    coverage: {
      complete: true,
      reasons: [],
      scope: 'configured-nexus',
      last_reconciled_at: null,
      source_checkpoint: 'revision-7',
      pending_changes: 0,
    },
  },
};

describe('calendar JSON transport boundary', () => {
  it('uses one configured origin without browser credentials and validates the result', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(success), { headers }));
    expect(await EventkyProxyService.occurrences('timezone=UTC')).toEqual(success);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://projection.internal:8091/v1/occurrences?timezone=UTC',
      expect.objectContaining({
        credentials: 'omit',
        headers: { Accept: 'application/json' },
        redirect: 'error',
        cache: 'no-store',
      }),
      expect.anything(),
      'eventkyProxy',
    );
  });

  it.each([
    [400, 'INVALID_QUERY'],
    [409, 'STALE_CURSOR'],
    [503, 'UNAVAILABLE'],
  ])('retains expected protocol failure %i', async (status, code) => {
    const failure = { ok: false, code, message: 'Unavailable' };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(failure), { status: Number(status), headers }));
    expect(await EventkyProxyService.occurrences('')).toEqual(failure);
  });

  it('rejects a success-shaped body on an upstream error and non-JSON responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(success), { status: 502, headers }));
    await expect(EventkyProxyService.occurrences('')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      context: { httpStatus: 502 },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(success), { headers: { 'Content-Type': 'text/html' } }),
    );
    await expect(EventkyProxyService.occurrences('')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects invalid UTF-8 and oversized streamed content before parsing', async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([0xff]), { headers }));
    await expect(EventkyProxyService.status()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
      },
      cancel,
    });
    fetchMock.mockResolvedValueOnce(new Response(stream, { headers }));
    await expect(EventkyProxyService.status()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects malformed or missing result bodies', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { headers }));
    await expect(EventkyProxyService.status()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    fetchMock.mockResolvedValueOnce(new Response(null, { headers }));
    await expect(EventkyProxyService.status()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
