import { calendarContentSchema, CONTENT_MAX_BYTES, eventContentSchema, postUriSchema, utf8Length } from './schema';
import type { CalendarContent, CalendarTime, ContractResult, EventContent, ParsedEventkyContent } from './types';

export {
  calendarContentSchema,
  eventAlarmSchema,
  eventContentSchema,
  eventOverrideSchema,
  MAX_SOCIAL_TEXT_BYTES,
  postUriSchema,
} from './schema';
export type * from './types';

/** The opt-in index text contains human prose only; calendar/location/organizer references stay opaque. */
export function withSocialText<T extends EventContent | CalendarContent>(value: T): T {
  const title = value.schema === 'eventky.event' ? value.summary : value.name;
  const body =
    value.schema === 'eventky.event' ? (value.styled_description?.content ?? value.description) : value.description;
  return { ...value, social: { version: 1, text: [title, body].filter(Boolean).join('\n\n') } };
}

/** Network reads never throw and preserve exact kind strings rather than lowercasing them. */
export function parseEventkyContent(kind: string, content: string): ParsedEventkyContent {
  if (kind !== 'event' && kind !== 'calendar') return { status: 'unsupported-kind' };
  if (typeof content !== 'string' || utf8Length(content) > CONTENT_MAX_BYTES)
    return { status: 'invalid', issues: ['Content exceeds the byte limit or is not a string.'] };
  try {
    const value: unknown = JSON.parse(content);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return { status: 'invalid', issues: ['Content must be a JSON object.'] };
    const header = value as Record<string, unknown>;
    if (header.schema !== `eventky.${kind}`)
      return { status: 'invalid', issues: ['The content schema does not match its post kind.'] };
    if (typeof header.schema_version === 'number' && header.schema_version !== 1)
      return { status: 'unsupported-version' };
    if (kind === 'event') {
      const result = eventContentSchema.safeParse(value);
      return result.success
        ? { status: 'supported', kind, value: result.data }
        : { status: 'invalid', issues: result.error.issues.map((issue) => issue.message) };
    }
    const result = calendarContentSchema.safeParse(value);
    return result.success
      ? { status: 'supported', kind, value: result.data }
      : { status: 'invalid', issues: result.error.issues.map((issue) => issue.message) };
  } catch {
    return { status: 'invalid', issues: ['Content cannot be decoded safely.'] };
  }
}

export function serializeEventkyContent(value: EventContent | CalendarContent): ContractResult<string> {
  try {
    const kind = value.schema === 'eventky.event' ? 'event' : 'calendar';
    const parsed = parseEventkyContent(kind, JSON.stringify(value));
    if (parsed.status !== 'supported')
      return { ok: false, issues: parsed.status === 'invalid' ? parsed.issues : ['Unsupported schema version.'] };
    const valueWithSocial = withSocialText(parsed.value);
    const final = parseEventkyContent(kind, JSON.stringify(valueWithSocial));
    return final.status === 'supported'
      ? { ok: true, value: JSON.stringify(final.value) }
      : { ok: false, issues: final.status === 'invalid' ? final.issues : ['Unsupported content.'] };
  } catch {
    return { ok: false, issues: ['Content cannot be serialized safely.'] };
  }
}

export function summarizeEventkyContent(kind: string, content: string): string {
  const parsed = parseEventkyContent(kind, content);
  if (parsed.status !== 'supported')
    return parsed.status === 'invalid' ? 'Event content unavailable' : 'Unsupported post format';
  const value = parsed.value;
  return value.schema === 'eventky.calendar'
    ? value.name
    : `${value.summary} · ${value.dtstart.value}${value.dtstart.type === 'zoned' ? ` (${value.dtstart.tzid})` : ''}${value.status === 'CANCELLED' ? ' · Cancelled' : ''}`;
}

export function getEventkyPlainText(kind: string, content: string): string {
  const parsed = parseEventkyContent(kind, content);
  if (parsed.status !== 'supported') return summarizeEventkyContent(kind, content);
  return [summarizeEventkyContent(kind, content), parsed.value.description].filter(Boolean).join('\n\n');
}

export function createEventContent(
  input: { summary: string; dtstart: CalendarTime } & Partial<EventContent>,
  context: { uid: string; now: string },
): ContractResult<EventContent> {
  const result = eventContentSchema.safeParse(
    withSocialText({
      status: 'CONFIRMED',
      calendar_uris: [],
      locations: [],
      rdate: [],
      exdate: [],
      overrides: [],
      categories: [],
      extensions: {},
      ...input,
      schema: 'eventky.event',
      schema_version: 1,
      uid: context.uid,
      created: context.now,
      dtstamp: context.now,
      last_modified: context.now,
      sequence: 0,
    } as EventContent),
  );
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, issues: result.error.issues.map((issue) => issue.message) };
}

export function createCalendarContent(
  input: { name: string; timezone: string } & Partial<CalendarContent>,
  context: { uid: string; now: string },
): ContractResult<CalendarContent> {
  const result = calendarContentSchema.safeParse(
    withSocialText({
      contributors: [],
      excluded_event_uris: [],
      week_start: 'MO',
      default_event_duration: 'PT1H',
      extensions: {},
      ...input,
      schema: 'eventky.calendar',
      schema_version: 1,
      uid: context.uid,
      created: context.now,
      last_modified: context.now,
      sequence: 0,
    } as CalendarContent),
  );
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, issues: result.error.issues.map((issue) => issue.message) };
}

/** Caller first refreshes the source and checks its base revision before applying this pure update. */
export function updateEventContent(
  existing: EventContent,
  patch: Partial<EventContent>,
  now: string,
): ContractResult<EventContent> {
  const next = {
    ...existing,
    ...patch,
    schema: existing.schema,
    schema_version: existing.schema_version,
    uid: existing.uid,
    created: existing.created,
    sequence: existing.sequence + 1,
    dtstamp: now,
    last_modified: now,
  };
  const result = eventContentSchema.safeParse(withSocialText(next));
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, issues: result.error.issues.map((issue) => issue.message) };
}

export function updateCalendarContent(
  existing: CalendarContent,
  patch: Partial<CalendarContent>,
  now: string,
): ContractResult<CalendarContent> {
  const next = {
    ...existing,
    ...patch,
    schema: existing.schema,
    schema_version: existing.schema_version,
    uid: existing.uid,
    created: existing.created,
    sequence: existing.sequence + 1,
    last_modified: now,
  };
  const result = calendarContentSchema.safeParse(withSocialText(next));
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, issues: result.error.issues.map((issue) => issue.message) };
}

export function getPostAuthor(uri: string): string | null {
  return postUriSchema.safeParse(uri).success ? uri.slice('pubky://'.length).split('/')[0] : null;
}

/** Authorization comes from source post URIs; presentation organizer metadata grants no rights. */
export function isCalendarMember(
  calendarUri: string,
  calendar: CalendarContent,
  eventUri: string,
  event: EventContent,
): boolean {
  const owner = getPostAuthor(calendarUri);
  const author = getPostAuthor(eventUri);
  return (
    !!owner &&
    !!author &&
    !!event.calendar_uris?.includes(calendarUri) &&
    (owner === author || !!calendar.contributors?.includes(author)) &&
    !calendar.excluded_event_uris?.includes(eventUri)
  );
}

/** Hash exact source content and kind; this is a change detector, not a signature or write lock. */
export async function hashPostContent(kind: string, content: string): Promise<ContractResult<string>> {
  if (kind.includes('\0') || utf8Length(kind) > 128 || utf8Length(content) > CONTENT_MAX_BYTES)
    return { ok: false, issues: ['Source exceeds hashing limits.'] };
  try {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${kind}\0${content}`));
    return {
      ok: true,
      value: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''),
    };
  } catch {
    return { ok: false, issues: ['A secure hashing implementation is unavailable.'] };
  }
}
