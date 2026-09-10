import { createHash } from 'node:crypto';
import { isCalendarMember, parseEventkyContent } from '@eventky/contract';
import { exportCalendarIcs } from '@eventky/ical';
import { supportedRecurrenceProfile } from '@eventky/rules';
import { calendarTimeToEpoch } from '@eventky/temporal';
import { createTimezoneContext } from '@eventky/timezone';
import type { EventContent } from '@eventky/types';
import { CALENDAR_FEED_MAX_BYTES, type CalendarFeedRequest, type CalendarFeedResponse } from '@eventky-api/feed';
import type { ProjectionMetadata, StoredSource } from './types';

export type { CalendarFeedRequest, CalendarFeedResponse } from '@eventky-api/feed';
type FeedSnapshot = {
  metadata: ProjectionMetadata;
  stats: { total: number; invalid: number; unavailable: number };
  pending: number;
  sources: StoredSource[] | null;
  lastModified: string | null;
};

const MAX_FEED_SERIES = 500;
const MAX_FEED_BYTES = CALENDAR_FEED_MAX_BYTES;

/** Public configured-Nexus policy: complete current masters, cancelled included, no viewer-specific mutes. */
export function buildCalendarFeed(
  snapshot: FeedSnapshot,
  calendarUri: string,
  request: CalendarFeedRequest = {},
  now = Date.now(),
): CalendarFeedResponse {
  const fail = (status: 404 | 503, body: string): CalendarFeedResponse => ({
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(status === 503 ? { 'Retry-After': '30' } : {}),
    },
    body: request.head ? null : body,
  });
  const { metadata, stats, sources } = snapshot;
  if (
    !metadata.reconciled_at ||
    !metadata.source_ready ||
    !metadata.checked_at ||
    now - Date.parse(metadata.checked_at) > 60000 ||
    snapshot.pending ||
    stats.invalid ||
    stats.unavailable ||
    !sources
  )
    return fail(503, 'The complete current calendar is temporarily unavailable.');
  const source = sources.find(
    (value) => value.uri === calendarUri && value.state === 'valid' && value.kind === 'calendar',
  );
  if (!source) return fail(404, 'Calendar not found.');
  const calendar = parseEventkyContent(source.kind, source.content);
  if (calendar.status !== 'supported' || calendar.kind !== 'calendar')
    return fail(503, 'Calendar content is unsupported.');
  const events: { event: EventContent; postUri: string }[] = [];
  let sourceBytes = 0;
  for (const value of sources) {
    if (value.kind !== 'event' || value.state !== 'valid') continue;
    const parsed = parseEventkyContent(value.kind, value.content);
    if (parsed.status !== 'supported' || parsed.kind !== 'event')
      return fail(503, 'An event cannot be safely exported.');
    if (!isCalendarMember(calendarUri, calendar.value, value.uri, parsed.value)) continue;
    sourceBytes += Buffer.byteLength(value.content);
    if (events.length >= MAX_FEED_SERIES || sourceBytes > MAX_FEED_BYTES)
      return fail(503, 'Calendar subscription work limits exceeded.');
    if (parsed.value.rrule && !supportedRecurrenceProfile(parsed.value.rrule).ok)
      return fail(503, 'A calendar recurrence rule is outside the subscription profile.');
    const context = createTimezoneContext(parsed.value.timezone_definitions);
    if (!calendarTimeToEpoch(parsed.value.dtstart, calendar.value.timezone, 'import', context).ok)
      return fail(503, 'A calendar timezone cannot be evaluated.');
    events.push({ event: parsed.value, postUri: value.uri });
  }
  const exported = exportCalendarIcs(events, { calendar: calendar.value, timezone: calendar.value.timezone });
  if (!exported.ok || Buffer.byteLength(exported.value) > MAX_FEED_BYTES)
    return fail(503, 'The complete calendar cannot be serialized within the subscription profile.');
  const etag = `"${createHash('sha256').update(exported.value).digest('hex')}"`;
  const modified = snapshot.lastModified ? Date.parse(snapshot.lastModified) : now;
  const headers: Record<string, string> = {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': 'inline; filename="calendar.ics"',
    'Cache-Control': 'public, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    ETag: etag,
    'Last-Modified': new Date(Math.min(modified, now)).toUTCString(),
    'X-Eventky-Coverage': 'complete',
    'X-Eventky-Scope': metadata.scope,
    'X-Eventky-Recurrence': 'complete-series',
  };
  const matches = request.ifNoneMatch
    ?.split(',')
    .some((part) => part.trim() === '*' || part.trim().replace(/^W\//, '') === etag);
  // Subsecond revisions cannot safely be validated by a date rounded down to whole seconds.
  const dateMatches =
    !request.ifNoneMatch &&
    request.ifModifiedSince &&
    Number.isFinite(Date.parse(request.ifModifiedSince)) &&
    Date.parse(request.ifModifiedSince) >= modified;
  if (matches || dateMatches) return { status: 304, headers, body: null };
  headers['Content-Length'] = String(Buffer.byteLength(exported.value));
  return { status: 200, headers, body: request.head ? null : exported.value };
}
