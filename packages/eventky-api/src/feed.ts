export const CALENDAR_FEED_MAX_BYTES = 2 * 1024 * 1024;
export type CalendarFeedRequest = { ifNoneMatch?: string; ifModifiedSince?: string; head?: boolean };
export type CalendarFeedResponse = {
  status: 200 | 304 | 400 | 404 | 503;
  headers: Record<string, string>;
  body: string | null;
};
