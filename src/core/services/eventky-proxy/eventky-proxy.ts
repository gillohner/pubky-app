import { occurrenceResponseSchema, statusResponseSchema } from '@eventky-api/schema';
import type { z } from 'zod';
import { Env } from '@/libs/env/env';
import { ServerErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { safeFetch } from '@/libs/error/error.http';
import { ErrorService } from '@/libs/error/error.types';
import { toAppError } from '@/libs/error/error.utils';

/** Server-only transport. Never forwards browser credentials or accepts a browser-selected upstream. */
export class EventkyProxyService {
  private static async read<T extends { ok: boolean }>(path: string, schema: z.ZodType<T>): Promise<T> {
    if (!Env.EVENTKY_PROJECTION_URL)
      throw Err.server(ServerErrorCode.SERVICE_UNAVAILABLE, 'Calendar projection is not configured.', {
        service: ErrorService.NextJsServer,
        operation: 'eventkyProxy',
      });
    const response = await safeFetch(
      `${Env.EVENTKY_PROJECTION_URL.replace(/\/$/, '')}/v1/${path}`,
      {
        credentials: 'omit',
        headers: { Accept: 'application/json' },
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      },
      ErrorService.NextJsServer,
      'eventkyProxy',
    );
    const reader = response.body?.getReader();
    if (!reader)
      throw Err.server(ServerErrorCode.INVALID_RESPONSE, 'Calendar response is empty.', {
        service: ErrorService.NextJsServer,
        operation: 'eventkyProxy',
        context: { httpStatus: response.status },
      });
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 2 * 1024 * 1024) {
          const failure = Err.server(ServerErrorCode.INVALID_RESPONSE, 'Calendar response exceeds its limit.', {
            service: ErrorService.NextJsServer,
            operation: 'eventkyProxy',
          });
          try {
            await reader.cancel();
          } catch {
            /* Preserve the size failure. */
          }
          throw failure;
        }
        chunks.push(part.value);
      }
    } catch (error) {
      throw toAppError(error, ErrorService.NextJsServer, 'eventkyProxy');
    } finally {
      reader.releaseLock();
    }
    let parsed: T;
    try {
      parsed = schema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
    } catch (e) {
      throw Err.server(ServerErrorCode.INVALID_RESPONSE, 'Calendar response is invalid.', {
        service: ErrorService.NextJsServer,
        operation: 'eventkyProxy',
        cause: e,
        context: { httpStatus: response.status },
      });
    }
    if (
      !response.headers.get('content-type')?.toLowerCase().startsWith('application/json') ||
      (parsed.ok ? response.status !== 200 : ![400, 409, 503].includes(response.status))
    ) {
      throw Err.server(ServerErrorCode.INVALID_RESPONSE, 'Calendar response status or content type is invalid.', {
        service: ErrorService.NextJsServer,
        operation: 'eventkyProxy',
        context: { httpStatus: response.status },
      });
    }
    return parsed;
  }
  static occurrences(query: string) {
    return this.read(`occurrences?${query}`, occurrenceResponseSchema);
  }
  static status() {
    return this.read('status', statusResponseSchema);
  }
}
