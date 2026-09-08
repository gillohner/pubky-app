import { Temporal } from '@js-temporal/polyfill';
import ICAL from 'ical.js';
import { z } from 'zod';
import { validateRecurrenceRule } from './rules';
import {
  calendarTimeToEpoch,
  isSupportedTimeZone,
  isValidCalendarTime,
  occurrenceKey,
  parseCalendarDuration,
  sameTemporalMode,
} from './temporal';
import { createTimezoneContext } from './timezone';
import type { CalendarContent, CalendarTime, EventContent, EventOccurrencePatch } from './types';

export const CONTENT_MAX_BYTES = 512 * 1024;
export const MAX_SOCIAL_TEXT_BYTES = 68 * 1024;
export const utf8Length = (text: string): number => new TextEncoder().encode(text).length;
const bytes = (max: number) => z.string().refine((value) => utf8Length(value) <= max, 'Text exceeds the byte limit.');
const title = (max: number) =>
  z
    .string()
    .refine((value) => value.trim().length > 0 && [...value].length <= max, `Enter a title of 1–${max} characters.`);
const identity = z.string().regex(/^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/, 'Enter a valid Pubky identity.');
export const postUriSchema = z
  .string()
  .regex(
    /^pubky:\/\/[ybndrfg8ejkmcpqxot1uwisza345h769]{52}\/pub\/pubky\.app\/posts\/[0-9A-HJKMNP-TV-Z]{13}$/,
    'Enter a normal Pubky post URI.',
  );
const safeUri = z
  .url()
  .max(2048)
  .refine(
    (value) => ['https:', 'http:', 'pubky:', 'mailto:', 'geo:'].includes(new URL(value).protocol),
    'Unsupported link protocol.',
  );
const imageUri = safeUri.refine(
  (value) => ['https:', 'http:', 'pubky:'].includes(new URL(value).protocol),
  'Enter an image URI.',
);
const timestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/)
  .refine((value) => {
    try {
      Temporal.Instant.from(value);
      return true;
    } catch {
      return false;
    }
  }, 'Enter a UTC timestamp.');
const sequence = z.number().int().min(0).max(2_147_483_647);
const social = z.strictObject({ version: z.literal(1), text: bytes(MAX_SOCIAL_TEXT_BYTES) });
const duration = z.string().refine((value) => parseCalendarDuration(value).ok, 'Enter a positive calendar duration.');
const tzid = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => !/[\r\n\x00]/.test(value), 'Invalid timezone identifier.');

export const calendarTimeSchema: z.ZodType<CalendarTime, CalendarTime> = z
  .discriminatedUnion('type', [
    z.strictObject({ type: z.literal('date'), value: z.string() }),
    z.strictObject({ type: z.literal('utc'), value: z.string() }),
    z.strictObject({ type: z.literal('zoned'), value: z.string(), tzid }),
    z.strictObject({ type: z.literal('floating'), value: z.string() }),
  ])
  .refine(isValidCalendarTime, 'Enter a valid calendar date or time.');

const dateTime = calendarTimeSchema.refine((value) => value.type !== 'date', 'Periods require date-times.');
const period = z
  .strictObject({
    type: z.literal('period'),
    start: dateTime,
    end: dateTime.optional(),
    duration: duration.optional(),
  })
  .refine((value) => Boolean(value.end) !== Boolean(value.duration), 'A period requires either an end or duration.');
const styled = z.strictObject({ format: z.literal('markdown'), content: bytes(64 * 1024) });
const status = z.enum(['TENTATIVE', 'CONFIRMED', 'CANCELLED']);
const transparency = z.enum(['OPAQUE', 'TRANSPARENT']);
const location = z.strictObject({
  id: z.string().min(1).max(100),
  kind: z.enum(['PHYSICAL', 'VIRTUAL']),
  label: title(500),
  uri: safeUri.optional(),
  description: bytes(8192).optional(),
  address: bytes(4096).optional(),
  geo: z.strictObject({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).optional(),
});
const locations = z
  .array(location)
  .max(16)
  .refine(
    (value) => new Set(value.map((item) => item.id)).size === value.length,
    'Location identifiers must be unique.',
  );
const organizer = z.strictObject({
  name: title(500).optional(),
  uri: safeUri.optional(),
  pubky_identity: identity.optional(),
});
export const eventAlarmSchema = z.strictObject({
  id: z.string().min(1).max(100),
  action: z.literal('DISPLAY'),
  trigger: z
    .string()
    .max(65)
    .refine(
      (value) => parseCalendarDuration(value.replace(/^[+-]/, '')).ok || value === 'PT0S',
      'Enter a relative display-alarm duration.',
    ),
  description: bytes(4096),
});
const alarms = z.array(eventAlarmSchema).max(8);

const patch: z.ZodType<EventOccurrencePatch, EventOccurrencePatch> = z
  .strictObject({
    dtstart: calendarTimeSchema.optional(),
    dtend: calendarTimeSchema.nullable().optional(),
    duration: duration.nullable().optional(),
    summary: title(500).optional(),
    description: bytes(64 * 1024)
      .nullable()
      .optional(),
    styled_description: styled.nullable().optional(),
    status: status.optional(),
    transp: transparency.nullable().optional(),
    locations: locations.nullable().optional(),
    url: safeUri.nullable().optional(),
    alarms: alarms.nullable().optional(),
  })
  .refine((value) => !(value.dtend && value.duration), 'An override cannot set both end and duration.');

export const eventOverrideSchema = z.strictObject({ recurrence_id: calendarTimeSchema, changes: patch });

function isBoundedJson(value: unknown): boolean {
  let nodes = 0;
  const visit = (item: unknown, depth: number): boolean => {
    if (++nodes > 10_000 || depth > 8) return false;
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return true;
    if (typeof item === 'number') return Number.isFinite(item);
    if (Array.isArray(item)) return item.every((child) => visit(child, depth + 1));
    if (typeof item !== 'object' || Object.getPrototypeOf(item) !== Object.prototype) return false;
    return Object.entries(item).every(
      ([key, child]) => !['__proto__', 'prototype', 'constructor'].includes(key) && visit(child, depth + 1),
    );
  };
  return visit(value, 0);
}
const extensions = z.record(z.string(), z.unknown()).refine((value) => {
  if (!isBoundedJson(value)) return false;
  try {
    return utf8Length(JSON.stringify(value)) <= 16 * 1024;
  } catch {
    return false;
  }
}, 'Extensions exceed safe JSON size or nesting limits.');
const definitions = z.record(tzid, bytes(64 * 1024)).refine((value) => {
  if (Object.keys(value).length > 16 || utf8Length(JSON.stringify(value)) > 64 * 1024) return false;
  return Object.entries(value).every(([key, source]) => {
    try {
      const component = new ICAL.Component(ICAL.parse(source));
      return (
        component.name === 'vtimezone' &&
        component.getFirstPropertyValue('tzid') === key &&
        component.getAllSubcomponents().some((part) => part.name === 'standard' || part.name === 'daylight')
      );
    } catch {
      return false;
    }
  });
}, 'Timezone definitions must be bounded valid VTIMEZONE components matching their identifiers.');

const eventBase = z.strictObject({
  schema: z.literal('eventky.event'),
  schema_version: z.literal(1),
  uid: z.string().min(1).max(255),
  summary: title(500),
  dtstart: calendarTimeSchema,
  dtend: calendarTimeSchema.optional(),
  duration: duration.optional(),
  dtstamp: timestamp,
  created: timestamp,
  last_modified: timestamp,
  sequence,
  description: bytes(64 * 1024).optional(),
  styled_description: styled.optional(),
  status: status.optional(),
  transp: transparency.optional(),
  locations: locations.optional(),
  image_uri: imageUri.optional(),
  url: safeUri.optional(),
  organizer: organizer.optional(),
  contact: organizer.optional(),
  rrule: z.string().max(2048).optional(),
  rdate: z
    .array(z.union([calendarTimeSchema, period]))
    .max(1024)
    .optional(),
  exdate: z.array(calendarTimeSchema).max(1024).optional(),
  overrides: z.array(eventOverrideSchema).max(256).optional(),
  calendar_uris: z.array(postUriSchema).max(32).optional(),
  categories: z.array(title(100)).max(100).optional(),
  related_to: z
    .array(
      z.strictObject({
        uid: z.string().min(1).max(255),
        relation: z.enum(['PARENT', 'CHILD', 'SIBLING']),
        uri: safeUri.optional(),
      }),
    )
    .max(32)
    .optional(),
  alarms: alarms.optional(),
  timezone_definitions: definitions.optional(),
  extensions: extensions.optional(),
  social: social.optional(),
});

export const eventContentSchema = eventBase.superRefine((event, ctx) => {
  const issue = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: 'custom', message, path });
  if (event.dtend && event.duration) issue('Use an end time or duration, not both.', ['dtend']);
  const times: CalendarTime[] = [event.dtstart, ...(event.dtend ? [event.dtend] : []), ...(event.exdate ?? [])];
  for (const addition of event.rdate ?? [])
    times.push(
      ...(addition.type === 'period' ? [addition.start, ...(addition.end ? [addition.end] : [])] : [addition]),
    );
  for (const override of event.overrides ?? [])
    times.push(
      override.recurrence_id,
      ...(override.changes.dtstart ? [override.changes.dtstart] : []),
      ...(override.changes.dtend ? [override.changes.dtend] : []),
    );
  for (const time of times) {
    if (time.type === 'zoned' && !isSupportedTimeZone(time.tzid) && !event.timezone_definitions?.[time.tzid])
      issue('A timezone must be supported or have a supplied definition.');
  }
  const context = createTimezoneContext(event.timezone_definitions);
  const validateEnd = (start: CalendarTime, end: CalendarTime) => {
    if (
      (start.type === 'date') !== (end.type === 'date') ||
      (start.type === 'floating') !== (end.type === 'floating')
    ) {
      issue('Start and end must use compatible date/time modes.');
      return;
    }
    const startEpoch = calendarTimeToEpoch(start, 'UTC', 'import', context);
    const endEpoch = calendarTimeToEpoch(end, 'UTC', 'import', context);
    if (startEpoch.ok && endEpoch.ok && endEpoch.value <= startEpoch.value) issue('The end must be after the start.');
  };
  if (event.dtend) validateEnd(event.dtstart, event.dtend);
  if (event.dtstart.type === 'date' && event.duration && !/^P\d+[WD]$/.test(event.duration))
    issue('All-day duration must contain days or weeks.');
  if (event.rrule) {
    const result = validateRecurrenceRule(event.rrule, event.dtstart);
    if (!result.ok) result.issues.forEach((message) => issue(message, ['rrule']));
  }
  if ((event.rdate?.length ?? 0) + (event.exdate?.length ?? 0) > 1024) issue('Too many explicit recurrence dates.');
  const recurrenceValues = [
    ...(event.exdate ?? []),
    ...(event.rdate ?? []).map((value) => (value.type === 'period' ? value.start : value)),
  ];
  if (recurrenceValues.some((value) => !sameTemporalMode(event.dtstart, value)))
    issue('Recurrence dates must use the original start mode and timezone.');
  for (const addition of event.rdate ?? []) {
    if (addition.type === 'period' && addition.end) validateEnd(addition.start, addition.end);
  }
  const ids = new Set<string>();
  for (const override of event.overrides ?? []) {
    const key = occurrenceKey(override.recurrence_id);
    if (ids.has(key)) issue('Recurrence override identifiers must be unique.');
    ids.add(key);
    if (!sameTemporalMode(event.dtstart, override.recurrence_id))
      issue('An override identifier must use the original start mode and timezone.');
    if (override.changes.dtstart && (override.changes.dtstart.type === 'date') !== (event.dtstart.type === 'date'))
      issue('An override cannot change an all-day series into a timed event or vice versa.');
    if (override.changes.dtend) validateEnd(override.changes.dtstart ?? override.recurrence_id, override.changes.dtend);
    if (event.dtstart.type === 'date' && override.changes.duration && !/^P\d+[WD]$/.test(override.changes.duration))
      issue('All-day override durations must contain days or weeks.');
  }
  if (new Set(event.calendar_uris).size !== (event.calendar_uris?.length ?? 0))
    issue('Calendar references must be unique.');
  if (utf8Length(JSON.stringify(event)) > CONTENT_MAX_BYTES) issue('Event content exceeds the byte limit.');
}) as z.ZodType<EventContent>;

export const calendarContentSchema: z.ZodType<CalendarContent> = z
  .strictObject({
    schema: z.literal('eventky.calendar'),
    schema_version: z.literal(1),
    uid: z.string().min(1).max(255),
    name: title(100),
    description: bytes(64 * 1024).optional(),
    timezone: tzid.refine(isSupportedTimeZone, 'Select a supported IANA timezone.'),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex color.')
      .optional(),
    image_uri: imageUri.optional(),
    url: safeUri.optional(),
    created: timestamp,
    last_modified: timestamp,
    sequence,
    contributors: z.array(identity).max(20).optional(),
    excluded_event_uris: z.array(postUriSchema).max(256).optional(),
    week_start: z.enum(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']).optional(),
    default_event_duration: duration.optional(),
    extensions: extensions.optional(),
    social: social.optional(),
  })
  .superRefine((calendar, ctx) => {
    if (new Set(calendar.contributors).size !== (calendar.contributors?.length ?? 0))
      ctx.addIssue({ code: 'custom', message: 'Contributors must be unique.' });
    if (new Set(calendar.excluded_event_uris).size !== (calendar.excluded_event_uris?.length ?? 0))
      ctx.addIssue({ code: 'custom', message: 'Exclusions must be unique.' });
  });
