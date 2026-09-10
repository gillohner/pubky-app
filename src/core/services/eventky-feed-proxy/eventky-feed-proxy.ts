import { CALENDAR_FEED_MAX_BYTES, type CalendarFeedRequest, type CalendarFeedResponse } from '@eventky-api/feed';
import { Env } from '@/libs/env/env';
import { ServerErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { safeFetch } from '@/libs/error/error.http';
import { ErrorService } from '@/libs/error/error.types';
import { toAppError } from '@/libs/error/error.utils';

const operation = 'eventkySubscription';

async function bodyBytes(response: Response, limit: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) {
        const failure = Err.server(
          ServerErrorCode.INVALID_RESPONSE,
          'Calendar subscription response exceeds its limit.',
          {
            service: ErrorService.NextJsServer,
            operation,
            context: { httpStatus: response.status, bodyState: 'oversized' },
          },
        );
        try {
          await reader.cancel();
        } catch {
          /* Preserve the primary size failure. */
        }
        throw failure;
      }
      parts.push(next.value);
    }
    const output = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.byteLength;
    }
    return output;
  } catch (e) {
    throw toAppError(e, ErrorService.NextJsServer, operation);
  } finally {
    reader.releaseLock();
  }
}

/** Fixed upstream only. Expected availability results are returned; transport/validation failures throw AppError. */
export class EventkyFeedProxyService {
  static async read(calendarUri: string, request: CalendarFeedRequest): Promise<CalendarFeedResponse> {
    if (!Env.EVENTKY_PROJECTION_URL)
      throw Err.server(ServerErrorCode.SERVICE_UNAVAILABLE, 'Calendar projection is not configured.', {
        service: ErrorService.NextJsServer,
        operation,
      });
    const headers: Record<string, string> = { Accept: 'text/calendar' };
    if (request.ifNoneMatch) headers['If-None-Match'] = request.ifNoneMatch;
    if (request.ifModifiedSince) headers['If-Modified-Since'] = request.ifModifiedSince;
    const url = `${Env.EVENTKY_PROJECTION_URL.replace(/\/$/, '')}/v1/calendar.ics?${new URLSearchParams({ calendar: calendarUri })}`;
    const response = await safeFetch(
      url,
      {
        method: request.head ? 'HEAD' : 'GET',
        headers,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      },
      ErrorService.NextJsServer,
      operation,
    );
    if ([400, 404, 503].includes(response.status)) {
      await bodyBytes(response, 8192);
      return {
        status: response.status as 400 | 404 | 503,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          ...(response.status === 503 ? { 'Retry-After': '30' } : {}),
        },
        body: request.head
          ? null
          : response.status === 404
            ? 'Calendar not found.'
            : response.status === 400
              ? 'Invalid calendar query.'
              : 'The complete current calendar is temporarily unavailable.',
      };
    }
    if (response.status !== 200 && response.status !== 304) {
      const body = await bodyBytes(response, 8192);
      const error = Err.server(
        ServerErrorCode.INVALID_RESPONSE,
        'Calendar subscription returned an unexpected response.',
        {
          service: ErrorService.NextJsServer,
          operation,
          context: { httpStatus: response.status, statusText: response.statusText },
        },
      );
      Object.defineProperty(error, 'responseBody', { value: new TextDecoder().decode(body), enumerable: false });
      throw error;
    }
    const etag = response.headers.get('etag');
    const modified = response.headers.get('last-modified');
    if (
      !etag ||
      !/^"[0-9a-f]{64}"$/.test(etag) ||
      !modified ||
      !Number.isFinite(Date.parse(modified)) ||
      response.headers.get('x-eventky-coverage') !== 'complete' ||
      (response.status === 304 && !request.ifNoneMatch && !request.ifModifiedSince)
    ) {
      await bodyBytes(response, CALENDAR_FEED_MAX_BYTES);
      throw Err.server(ServerErrorCode.INVALID_RESPONSE, 'Calendar subscription validation headers are invalid.', {
        service: ErrorService.NextJsServer,
        operation,
        context: { httpStatus: response.status },
      });
    }
    const outputHeaders: Record<string, string> = {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="calendar.ics"',
      'Cache-Control': 'public, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      ETag: etag,
      'Last-Modified': modified,
      'X-Eventky-Coverage': 'complete',
      'X-Eventky-Recurrence': 'complete-series',
    };
    if (response.status === 304 || request.head) return { status: response.status, headers: outputHeaders, body: null };
    if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/calendar')) {
      await bodyBytes(response, CALENDAR_FEED_MAX_BYTES);
      throw Err.server(ServerErrorCode.INVALID_RESPONSE, 'Calendar subscription content type is invalid.', {
        service: ErrorService.NextJsServer,
        operation,
        context: { httpStatus: response.status },
      });
    }
    try {
      const bytes = await bodyBytes(response, CALENDAR_FEED_MAX_BYTES);
      const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (!body.startsWith('BEGIN:VCALENDAR\r\n') || !body.endsWith('END:VCALENDAR\r\n'))
        throw Err.server(ServerErrorCode.INVALID_RESPONSE, 'Calendar subscription body is incomplete.', {
          service: ErrorService.NextJsServer,
          operation,
        });
      outputHeaders['Content-Length'] = String(bytes.byteLength);
      return { status: 200, headers: outputHeaders, body };
    } catch (e) {
      throw toAppError(e, ErrorService.NextJsServer, operation);
    }
  }
}
