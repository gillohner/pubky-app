import { postUriSchema } from '@eventky/contract';
import type { CalendarFeedRequest, CalendarFeedResponse } from '@eventky-api/feed';
import { EventkyFeedProxyApplication } from '@/application/eventky-feed-proxy/eventky-feed-proxy';
import { getEventkyCalendarEnabled } from '@/libs/runtime-config/runtime-config';

export class EventkyFeedProxyController {
  static read(parameters: URLSearchParams, request: CalendarFeedRequest): Promise<CalendarFeedResponse> {
    if (!getEventkyCalendarEnabled())
      return Promise.resolve({
        status: 503,
        headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' },
        body: request.head ? null : 'Calendar subscriptions are not enabled on this instance.',
      });
    const uri = parameters.get('calendar') ?? '';
    if (
      parameters.toString().length > 4096 ||
      [...parameters.keys()].some((key) => key !== 'calendar') ||
      parameters.getAll('calendar').length !== 1 ||
      !postUriSchema.safeParse(uri).success ||
      (request.ifNoneMatch?.length ?? 0) > 4096 ||
      (request.ifModifiedSince?.length ?? 0) > 128
    )
      return Promise.resolve({
        status: 400,
        headers: { 'Cache-Control': 'no-store' },
        body: request.head ? null : 'Supply one calendar post URI and valid conditional headers.',
      });
    return EventkyFeedProxyApplication.read(uri, request);
  }
}
