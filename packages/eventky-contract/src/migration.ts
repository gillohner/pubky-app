import { Temporal } from '@js-temporal/polyfill';
import { getPostAuthor } from './contract';
import { calendarContentSchema, eventContentSchema } from './schema';
import { isValidCalendarTime } from './temporal';
import type {
  CalendarContent,
  CalendarTime,
  ContractResult,
  EventContent,
  EventLocation,
  EventOccurrencePatch,
} from './types';

export type LegacyRecord = { uri: string; data: unknown };
export type LegacyMigrationEntry = {
  sourceUri: string;
  postUri?: string;
  kind: 'event' | 'calendar';
  content?: EventContent | CalendarContent;
  attachmentUris: string[];
  warnings: string[];
  errors: string[];
};
export type LegacyMigrationReport = {
  calendars: LegacyMigrationEntry[];
  events: LegacyMigrationEntry[];
  errors: string[];
};
export type MigrationOptions = { owner: string; now: string; uriMap: Record<string, string> };
const LEGACY_URI =
  /^pubky:\/\/([ybndrfg8ejkmcpqxot1uwisza345h769]{52})\/pub\/eventky\.app\/(events|calendars)\/([0-9A-HJKMNP-TV-Z]{13})$/;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Legacy fields are explicitly microseconds; never guess a seconds/milliseconds conversion. */
export function legacyMicrosecondsToUtc(value: unknown): ContractResult<string> {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    return { ok: false, issues: ['Legacy timestamp must be a nonnegative safe integer in microseconds.'] };
  try {
    return {
      ok: true,
      value: Temporal.Instant.fromEpochNanoseconds(BigInt(value) * BigInt(1000)).toString({
        smallestUnit: 'microsecond',
      }),
    };
  } catch {
    return { ok: false, issues: ['Legacy timestamp is outside the supported range.'] };
  }
}

export function migrateLegacyTime(value: unknown, timezone?: unknown): ContractResult<CalendarTime> {
  if (typeof value !== 'string') return { ok: false, issues: ['Legacy event time must be a string.'] };
  const zone = typeof timezone === 'string' && timezone.trim() ? timezone.trim() : undefined;
  let result: CalendarTime;
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      if (zone) return { ok: false, issues: ['A date-only value must not carry a timezone.'] };
      result = { type: 'date', value };
    } else if (/(Z|[+-]\d{2}:\d{2})$/.test(value)) {
      if (zone) return { ok: false, issues: ['Legacy time has both an offset and TZID; review its intended meaning.'] };
      result = { type: 'utc', value: Temporal.Instant.from(value).toString({ smallestUnit: 'second' }) };
    } else result = zone ? { type: 'zoned', value, tzid: zone } : { type: 'floating', value };
    return isValidCalendarTime(result)
      ? { ok: true, value: result }
      : { ok: false, issues: ['Legacy calendar time is invalid.'] };
  } catch {
    return { ok: false, issues: ['Legacy calendar time cannot be converted.'] };
  }
}

function metadata(data: Record<string, unknown>, field: string, fallback: string, entry: LegacyMigrationEntry): string {
  if (data[field] === undefined || data[field] === null) {
    entry.warnings.push(`Missing ${field} uses the supplied migration timestamp.`);
    return fallback;
  }
  const value = legacyMicrosecondsToUtc(data[field]);
  if (!value.ok) {
    entry.errors.push(...value.issues);
    return fallback;
  }
  return value.value;
}

function locations(value: unknown, entry: LegacyMigrationEntry): EventLocation[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    entry.errors.push('Legacy locations must be an array.');
    return;
  }
  return value.flatMap((input, index) => {
    const location = record(input);
    if (!location) {
      entry.errors.push('A legacy location is invalid.');
      return [];
    }
    const kind = location.kind ?? location.location_type;
    return [
      {
        id: optionalText(location.id) ?? `legacy-location-${index}`,
        label: optionalText(location.label ?? location.name) ?? '',
        kind: (kind === 'ONLINE' ? 'VIRTUAL' : kind) as EventLocation['kind'],
        uri: optionalText(location.uri ?? location.structured_data),
        description: optionalText(location.description),
      },
    ];
  });
}

function mappedCalendars(value: unknown, options: MigrationOptions, entry: LegacyMigrationEntry): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    entry.errors.push('Legacy calendar references must be an array.');
    return [];
  }
  return value.flatMap((uri) => {
    if (typeof uri !== 'string') {
      entry.errors.push('Invalid legacy calendar reference.');
      return [];
    }
    const mapped = options.uriMap[uri];
    if (!mapped) {
      entry.errors.push('A referenced calendar has no allocated normal-post URI.');
      return [];
    }
    return [mapped];
  });
}

function migrateEvent(
  data: Record<string, unknown>,
  options: MigrationOptions,
  entry: LegacyMigrationEntry,
): EventContent | undefined {
  const start = migrateLegacyTime(data.dtstart, data.dtstart_tzid);
  if (!start.ok) {
    entry.errors.push(...start.issues);
    return;
  }
  const inheritedEndZone =
    typeof data.dtend === 'string' && !/(Z|[+-]\d{2}:\d{2})$/.test(data.dtend) ? data.dtstart_tzid : undefined;
  const end = data.dtend ? migrateLegacyTime(data.dtend, data.dtend_tzid ?? inheritedEndZone) : undefined;
  if (end && !end.ok) {
    entry.errors.push(...end.issues);
    return;
  }
  if (start.value.type === 'floating')
    entry.warnings.push('The source has no timezone; its floating time is preserved for review.');
  const explicit = (field: string): CalendarTime[] => {
    if (data[field] === undefined || data[field] === null) return [];
    if (!Array.isArray(data[field])) {
      entry.errors.push(`Legacy ${field} must be an array.`);
      return [];
    }
    return data[field].flatMap((value) => {
      const converted = migrateLegacyTime(
        value,
        typeof value === 'string' && /(Z|[+-]\d{2}:\d{2})$/.test(value) ? undefined : data.dtstart_tzid,
      );
      if (!converted.ok) {
        entry.errors.push(...converted.issues);
        return [];
      }
      return [converted.value];
    });
  };
  const styled = record(data.styled_description);
  if (styled && styled.format !== 'markdown' && styled.format !== 'plain')
    entry.errors.push('Legacy rich HTML needs an explicit reviewed conversion before migration.');
  if (Array.isArray(styled?.attachments))
    entry.attachmentUris.push(...styled.attachments.filter((uri): uri is string => typeof uri === 'string'));
  const image = optionalText(data.image_uri);
  if (image?.startsWith('pubky://')) entry.attachmentUris.push(image);
  const result = eventContentSchema.safeParse({
    schema: 'eventky.event',
    schema_version: 1,
    uid: data.uid,
    summary: data.summary,
    dtstart: start.value,
    ...(end?.ok ? { dtend: end.value } : {}),
    duration: optionalText(data.duration),
    dtstamp: metadata(data, 'dtstamp', options.now, entry),
    created: metadata(data, 'created', options.now, entry),
    last_modified: metadata(data, 'last_modified', options.now, entry),
    sequence: data.sequence ?? 0,
    description:
      optionalText(data.description) ?? (styled?.format === 'plain' ? optionalText(styled.content) : undefined),
    ...(styled?.format === 'markdown' ? { styled_description: { format: 'markdown', content: styled.content } } : {}),
    status: data.status ?? 'CONFIRMED',
    locations: locations(data.locations, entry),
    image_uri: image,
    url: optionalText(data.url),
    rrule: optionalText(data.rrule),
    rdate: explicit('rdate'),
    exdate: explicit('exdate'),
    calendar_uris: mappedCalendars(data.x_pubky_calendar_uris, options, entry),
    overrides: [],
    extensions: { 'eventky.legacy-uri': entry.sourceUri },
  });
  if (!result.success) {
    entry.errors.push(...result.error.issues.map((issue) => issue.message));
    return;
  }
  return result.data;
}

function migrateCalendar(
  data: Record<string, unknown>,
  options: MigrationOptions,
  entry: LegacyMigrationEntry,
): CalendarContent | undefined {
  const authors = Array.isArray(data.x_pubky_authors) ? data.x_pubky_authors : [];
  const image = optionalText(data.image_uri);
  if (image?.startsWith('pubky://')) entry.attachmentUris.push(image);
  const result = calendarContentSchema.safeParse({
    schema: 'eventky.calendar',
    schema_version: 1,
    uid: `eventky-calendar:${entry.sourceUri}`,
    name: data.name,
    timezone: data.timezone,
    description: optionalText(data.description),
    color: optionalText(data.color),
    image_uri: image,
    url: optionalText(data.url),
    created: metadata(data, 'created', options.now, entry),
    last_modified: metadata(data, 'last_modified', options.now, entry),
    sequence: data.sequence ?? 0,
    contributors: authors.map((value) =>
      typeof value === 'string' && value.startsWith('pubky://') ? value.slice(8).split('/')[0] : value,
    ),
    extensions: { 'eventky.legacy-uri': entry.sourceUri },
  });
  if (!result.success) {
    entry.errors.push(...result.error.issues.map((issue) => issue.message));
    return;
  }
  return result.data;
}

/** Resumable-plan input/output only. Callers allocate IDs first and publish calendars before events. */
export function prepareLegacyMigration(records: LegacyRecord[], options: MigrationOptions): LegacyMigrationReport {
  const report: LegacyMigrationReport = { calendars: [], events: [], errors: [] };
  if (records.length > 500) {
    report.errors.push('Migrate at most 500 legacy records at once.');
    return report;
  }
  const eventGroups = new Map<string, { data: Record<string, unknown>; entry: LegacyMigrationEntry }[]>();
  for (const source of records) {
    const match = LEGACY_URI.exec(source.uri);
    const data = record(source.data);
    if (!match || match[1] !== options.owner || !data) {
      report.errors.push('Only valid legacy records owned by the migrating account may be converted.');
      continue;
    }
    const kind = match[2] === 'events' ? 'event' : 'calendar';
    const entry: LegacyMigrationEntry = {
      sourceUri: source.uri,
      postUri: options.uriMap[source.uri],
      kind,
      attachmentUris: [],
      warnings: [],
      errors: [],
    };
    if (entry.postUri && getPostAuthor(entry.postUri) !== options.owner)
      entry.errors.push('The allocated post URI must belong to the migrating account.');
    if (kind === 'calendar') {
      if (!entry.postUri) entry.errors.push('Allocate a normal post URI before publishing this calendar.');
      entry.content = migrateCalendar(data, options, entry);
      report.calendars.push(entry);
    } else {
      if (typeof data.uid !== 'string') {
        entry.errors.push('Legacy event has no UID.');
        report.events.push(entry);
        continue;
      }
      eventGroups.set(data.uid, [...(eventGroups.get(data.uid) ?? []), { data, entry }]);
    }
  }
  for (const group of eventGroups.values()) {
    const masters = group.filter(({ data }) => !data.recurrence_id);
    if (masters.length !== 1) {
      for (const { entry } of group) {
        entry.errors.push('Resolve duplicate masters or orphan recurrence exceptions before migration.');
        report.events.push(entry);
      }
      continue;
    }
    const { data, entry } = masters[0];
    if (!entry.postUri) entry.errors.push('Allocate a normal post URI before publishing this event.');
    const event = migrateEvent(data, options, entry);
    if (event) {
      for (const exception of group.filter((item) => item !== masters[0])) {
        const converted = migrateEvent(exception.data, options, exception.entry);
        const identity = migrateLegacyTime(exception.data.recurrence_id, data.dtstart_tzid);
        entry.errors.push(...exception.entry.errors);
        if (!identity.ok) entry.errors.push(...identity.issues);
        if (!converted || !identity.ok) continue;
        const changes: EventOccurrencePatch = {
          dtstart: converted.dtstart,
          ...(converted.dtend ? { dtend: converted.dtend } : {}),
          ...(converted.duration ? { duration: converted.duration } : {}),
          summary: converted.summary,
          description: converted.description,
          styled_description: converted.styled_description,
          status: converted.status,
          locations: converted.locations,
          url: converted.url,
        };
        event.overrides!.push({ recurrence_id: identity.value, changes });
        const sources = event.extensions!['eventky.legacy-exception-uris'];
        event.extensions!['eventky.legacy-exception-uris'] = [
          ...(Array.isArray(sources) ? sources : []),
          exception.entry.sourceUri,
        ];
        entry.warnings.push(
          'A legacy exception is merged into this series; its previous URI remains a migration provenance link.',
        );
        entry.warnings.push(...exception.entry.warnings);
        entry.attachmentUris.push(...exception.entry.attachmentUris);
      }
      const parsed = eventContentSchema.safeParse(event);
      if (parsed.success) entry.content = parsed.data;
      else entry.errors.push(...parsed.error.issues.map((issue) => issue.message));
    }
    entry.attachmentUris = [...new Set(entry.attachmentUris)];
    report.events.push(entry);
  }
  return report;
}
