import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { OccurrenceQuery } from '@eventky-api/types';
import { CalendarProjector } from './projector';
import { ProjectionWorkers } from './workers';

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

export function createProjectionServer(projector: CalendarProjector, workers: ProjectionWorkers) {
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      json(response, 405, { ok: false, code: 'INVALID_QUERY', message: 'Only read requests are supported.' });
      return;
    }
    const cancellation = new AbortController();
    response.once('close', () => {
      if (!response.writableEnded) cancellation.abort();
    });
    try {
      const url = new URL(request.url ?? '/', 'http://projection.internal');
      if ((request.url?.length ?? 0) > 16384) {
        json(response, 400, { ok: false, code: 'INVALID_QUERY', message: 'Calendar query exceeds its limit.' });
        return;
      }
      if (url.pathname === '/healthz') {
        const status = projector.status();
        json(response, status.coverage.complete ? 200 : 503, { ready: status.coverage.complete });
        return;
      }
      if (url.pathname === '/v1/status') {
        json(response, 200, { ok: true, value: projector.status() });
        return;
      }
      if (url.pathname === '/v1/calendar.ics') {
        if (
          url.searchParams.getAll('calendar').length !== 1 ||
          [...url.searchParams.keys()].some((key) => key !== 'calendar')
        ) {
          json(response, 400, { ok: false, code: 'INVALID_QUERY', message: 'Supply one calendar post URI.' });
          return;
        }
        const outcome = await workers.execute(
          {
            operation: 'subscription',
            calendarUri: url.searchParams.get('calendar')!,
            request: {
              ifNoneMatch: request.headers['if-none-match'],
              ifModifiedSince: request.headers['if-modified-since'],
              head: request.method === 'HEAD',
            },
          },
          cancellation.signal,
        );
        if (response.destroyed) return;
        if (!outcome.ok || outcome.value.operation !== 'subscription') {
          response.setHeader('Retry-After', '1');
          json(response, 503, {
            ok: false,
            code: 'UNAVAILABLE',
            message: 'The complete current calendar is temporarily unavailable.',
          });
          return;
        }
        const result = outcome.value.result;
        response.writeHead(result.status, result.headers);
        response.end(result.body);
        return;
      }
      if (url.pathname === '/v1/occurrences') {
        const parameters = url.searchParams;
        const allowed = new Set([
          'from',
          'to',
          'timezone',
          'calendar',
          'author',
          'include_cancelled',
          'limit',
          'cursor',
        ]);
        if (
          [...parameters.keys()].some((key) => !allowed.has(key)) ||
          [...allowed].some((key) => key !== 'calendar' && parameters.getAll(key).length > 1) ||
          (parameters.has('include_cancelled') && !['true', 'false'].includes(parameters.get('include_cancelled')!))
        ) {
          json(response, 400, { ok: false, code: 'INVALID_QUERY', message: 'Invalid query parameters.' });
          return;
        }
        const query: OccurrenceQuery = {
          from: parameters.get('from') ?? '',
          to: parameters.get('to') ?? '',
          timezone: parameters.get('timezone') ?? 'UTC',
          calendars: parameters.getAll('calendar'),
          author: parameters.get('author') ?? undefined,
          include_cancelled: parameters.get('include_cancelled') !== 'false',
          limit: parameters.has('limit') ? Number(parameters.get('limit')) : undefined,
          cursor: parameters.get('cursor') ?? undefined,
        };
        const outcome = await workers.execute({ operation: 'query', query }, cancellation.signal);
        if (response.destroyed) return;
        if (!outcome.ok || outcome.value.operation !== 'query') {
          const staleCursor = !outcome.ok && outcome.reason === 'stale' && !!query.cursor;
          response.setHeader('Retry-After', '1');
          json(response, staleCursor ? 409 : 503, {
            ok: false,
            code: staleCursor ? 'STALE_CURSOR' : 'UNAVAILABLE',
            message: staleCursor
              ? 'The calendar changed. Reload the requested range.'
              : 'Calendar work is temporarily unavailable or exceeded its limits.',
          });
          return;
        }
        const result = outcome.value.result;
        json(
          response,
          result.ok ? 200 : result.code === 'STALE_CURSOR' ? 409 : result.code === 'INVALID_QUERY' ? 400 : 503,
          result,
        );
        return;
      }
      json(response, 404, { ok: false, code: 'INVALID_QUERY', message: 'Unknown projection route.' });
    } catch {
      json(response, 503, {
        ok: false,
        code: 'UNAVAILABLE',
        message: 'The calendar service is temporarily unavailable.',
      });
    }
  });
  server.once('close', () => {
    void workers.close();
  });
  return server;
}
