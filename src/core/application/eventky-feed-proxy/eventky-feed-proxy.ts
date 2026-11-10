import type { CalendarFeedRequest, CalendarFeedResponse } from '@eventky-api/feed';
import { EventkyFeedProxyService } from '@/services/eventky-feed-proxy/eventky-feed-proxy';

export class EventkyFeedProxyApplication {
  static async read(calendarUri: string, request: CalendarFeedRequest): Promise<CalendarFeedResponse> {
    try {
      return await EventkyFeedProxyService.read(calendarUri, request);
    } catch {
      return {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '30' },
        body: request.head ? null : 'The complete current calendar is temporarily unavailable.',
      };
    }
  }
}
