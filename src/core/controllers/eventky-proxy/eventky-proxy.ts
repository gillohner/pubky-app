import type { OccurrencePage, ProjectionResult, ProjectionStatus } from '@eventky-api/types';
import { EventkyProxyApplication } from '@/application/eventky-proxy/eventky-proxy';
import { getEventkyCalendarEnabled } from '@/libs/runtime-config/runtime-config';

export class EventkyProxyController {
  static occurrences(parameters: URLSearchParams): Promise<ProjectionResult<OccurrencePage>> {
    if (!getEventkyCalendarEnabled())
      return Promise.resolve({
        ok: false,
        code: 'NOT_READY',
        message: 'Calendar views are not enabled on this instance.',
      });
    const allowed = new Set(['from', 'to', 'timezone', 'calendar', 'author', 'include_cancelled', 'limit', 'cursor']);
    if (parameters.toString().length > 16384 || [...parameters.keys()].some((key) => !allowed.has(key)))
      return Promise.resolve({ ok: false, code: 'INVALID_QUERY', message: 'Invalid calendar query.' });
    return EventkyProxyApplication.occurrences(parameters.toString());
  }
  static status(): Promise<ProjectionResult<ProjectionStatus>> {
    if (!getEventkyCalendarEnabled())
      return Promise.resolve({
        ok: false,
        code: 'NOT_READY',
        message: 'Calendar views are not enabled on this instance.',
      });
    return EventkyProxyApplication.status();
  }
}
