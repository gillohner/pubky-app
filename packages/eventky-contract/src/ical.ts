import ICAL from 'ical.js';
import { tzlib_get_ical_block, tzlib_get_timezones } from 'timezones-ical-library';
import { resolveOccurrenceEvent } from './recurrence';
import { calendarContentSchema, eventContentSchema, postUriSchema, utf8Length } from './schema';
import { calendarTimeToEpoch, isSupportedTimeZone, isValidCalendarTime, occurrenceKey } from './temporal';
import { createTimezoneContext } from './timezone';
import type {
  CalendarContent,
  CalendarTime,
  ContractResult,
  EventContent,
  EventOccurrencePatch,
  EventOverride,
  Organizer,
  RecurrencePeriod,
} from './types';

export type IcsExportOptions = {
  calendarName?: string;
  timezone?: string;
  postUri?: string;
  attachmentUris?: string[];
};
export type IcsImportEntry = {
  uid: string;
  event?: EventContent;
  warnings: string[];
  errors: string[];
  requiresAcknowledgement: string[];
  /** Conflicts are suggestions for preview; this package never writes or overwrites a post. */
  action: 'create' | 'unchanged' | 'review-update' | 'conflict';
  existingPostUri?: string;
  contentFingerprint?: string;
};
export type IcsImportReport = {
  entries: IcsImportEntry[];
  calendar?: CalendarContent;
  warnings: string[];
  errors: string[];
};
export type IcsImportOptions = {
  now: string;
  calendarUid?: string;
  defaultTimezone?: string;
  source?: string;
  existing?: {
    uid: string;
    postUri: string;
    sequence: number;
    lastModified: string;
    source?: string;
    owned: boolean;
    contentFingerprint?: string;
  }[];
};

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const KNOWN_PROPERTIES = new Set([
  'uid',
  'summary',
  'dtstart',
  'dtend',
  'duration',
  'dtstamp',
  'created',
  'last-modified',
  'sequence',
  'description',
  'status',
  'transp',
  'location',
  'geo',
  'url',
  'image',
  'organizer',
  'contact',
  'rrule',
  'rdate',
  'exdate',
  'recurrence-id',
  'categories',
  'related-to',
  'attach',
  'conference',
  'styled-description',
  'x-pubky-locations',
  'x-pubky-post-uri',
]);
const PRIVATE_PROPERTIES = new Set(['attendee', 'class']);
const ZONES = new Set(tzlib_get_timezones() as string[]);

/** Folds by UTF-8 octets, including the continuation space, without splitting a code point. */
export function foldIcsLines(source: string): string {
  const unfolded = source.replace(/\r?\n[ \t]/g, '').replace(/\r\n?/g, '\n');
  const lines: string[] = [];
  for (const input of unfolded.split('\n').filter((line) => line.length > 0)) {
    let line = '';
    let size = 0;
    for (const point of input) {
      const length = utf8Length(point);
      if (size + length > 75) {
        lines.push(line);
        line = ' ';
        size = 1;
      }
      line += point;
      size += length;
    }
    lines.push(line);
  }
  return `${lines.join('\r\n')}\r\n`;
}

function textProperty(component: ICAL.Component, name: string, value: string, type = 'text'): ICAL.Property {
  const property = new ICAL.Property(name);
  property.resetType(type);
  property.setValue(value.replace(/\r\n?/g, '\n'));
  component.addProperty(property);
  return property;
}

function safeExportUri(value: string): boolean {
  if (value.length > 2048 || /[\x00-\x20\x7f]/.test(value)) return false;
  try {
    return ['https:', 'http:', 'pubky:', 'mailto:', 'geo:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function safeComponentLines(component: ICAL.Component): boolean {
  return (
    component
      .getAllProperties()
      .every((property) => !/[\r\n\x00]/.test(property.toICALString().replace(/\r?\n[ \t]/g, ''))) &&
    component.getAllSubcomponents().every(safeComponentLines)
  );
}

function dateProperty(component: ICAL.Component, name: string, time: CalendarTime): ICAL.Property {
  const property = new ICAL.Property(name);
  property.resetType(time.type === 'date' ? 'date' : 'date-time');
  property.setValue(ICAL.Time.fromString(time.value, undefined));
  if (time.type === 'zoned') property.setParameter('tzid', time.tzid);
  component.addProperty(property);
  return property;
}

function timestampProperty(component: ICAL.Component, name: string, value: string) {
  dateProperty(component, name, { type: 'utc', value: value.replace(/\.\d+Z$/, 'Z') });
}

function restoredParameters(component: ICAL.Component, event: EventContent) {
  const source = event.extensions?.['ical.parameters'];
  if (!source || typeof source !== 'object' || Array.isArray(source)) return;
  for (const [name, params] of Object.entries(source)) {
    if (!KNOWN_PROPERTIES.has(name) || !params || typeof params !== 'object' || Array.isArray(params)) continue;
    const property = component.getFirstProperty(name);
    if (!property) continue;
    for (const [key, value] of Object.entries(params)) {
      if (['tzid', 'value', 'encoding'].includes(key) || !/^[a-z0-9-]+$/.test(key)) continue;
      if (typeof value === 'string' || (Array.isArray(value) && value.every((part) => typeof part === 'string')))
        property.setParameter(key, value);
    }
  }
}

function eventComponent(event: EventContent, options: IcsExportOptions, recurrenceId?: CalendarTime): ICAL.Component {
  const component = new ICAL.Component('vevent');
  textProperty(component, 'uid', event.uid);
  textProperty(component, 'summary', event.summary);
  timestampProperty(component, 'dtstamp', event.dtstamp);
  timestampProperty(component, 'created', event.created);
  timestampProperty(component, 'last-modified', event.last_modified);
  component.updatePropertyWithValue('sequence', event.sequence);
  dateProperty(component, 'dtstart', event.dtstart);
  if (event.dtend) dateProperty(component, 'dtend', event.dtend);
  if (event.duration) component.updatePropertyWithValue('duration', ICAL.Duration.fromString(event.duration));
  if (recurrenceId) dateProperty(component, 'recurrence-id', recurrenceId);
  if (event.description) textProperty(component, 'description', event.description);
  if (event.status) textProperty(component, 'status', event.status);
  if (event.transp) textProperty(component, 'transp', event.transp);
  if (event.url) textProperty(component, 'url', event.url, 'uri');
  if (options.postUri) textProperty(component, 'x-pubky-post-uri', options.postUri, 'uri');
  if (event.image_uri) textProperty(component, 'image', event.image_uri, 'uri');
  if (event.styled_description)
    textProperty(component, 'styled-description', event.styled_description.content).setParameter(
      'fmttype',
      'text/markdown',
    );
  const physical = event.locations?.find((location) => location.kind === 'PHYSICAL');
  if (physical)
    textProperty(
      component,
      'location',
      [physical.label, physical.address, physical.description].filter(Boolean).join(' — '),
    );
  if (physical?.geo) {
    const property = new ICAL.Property('geo');
    property.setValue([physical.geo.latitude, physical.geo.longitude]);
    component.addProperty(property);
  }
  if (event.locations?.length) textProperty(component, 'x-pubky-locations', JSON.stringify(event.locations));
  for (const location of event.locations ?? []) {
    if (location.kind === 'VIRTUAL' && location.uri)
      textProperty(component, 'conference', location.uri, 'uri').setParameter('label', location.label);
  }
  const organizer = event.organizer;
  if (organizer?.uri) {
    const property = textProperty(component, 'organizer', organizer.uri, 'cal-address');
    if (organizer.name) property.setParameter('cn', organizer.name);
  }
  if (event.contact)
    textProperty(component, 'contact', [event.contact.name, event.contact.uri].filter(Boolean).join(' — '));
  if (event.categories?.length) {
    const property = new ICAL.Property('categories');
    property.setValues(event.categories);
    component.addProperty(property);
  }
  for (const relation of event.related_to ?? [])
    textProperty(component, 'related-to', relation.uid).setParameter('reltype', relation.relation);
  for (const uri of options.attachmentUris ?? []) textProperty(component, 'attach', uri, 'uri');
  if (!recurrenceId) {
    if (event.rrule) component.updatePropertyWithValue('rrule', ICAL.Recur.fromString(event.rrule));
    for (const date of event.rdate ?? []) {
      if (date.type !== 'period') dateProperty(component, 'rdate', date);
      else {
        const property = new ICAL.Property('rdate');
        property.resetType('period');
        property.setValue(
          new ICAL.Period({
            start: ICAL.Time.fromString(date.start.value, undefined),
            ...(date.end
              ? { end: ICAL.Time.fromString(date.end.value, undefined) }
              : { duration: ICAL.Duration.fromString(date.duration!) }),
          }),
        );
        if (date.start.type === 'zoned') property.setParameter('tzid', date.start.tzid);
        component.addProperty(property);
      }
    }
    for (const date of event.exdate ?? []) dateProperty(component, 'exdate', date);
  }
  for (const alarm of event.alarms ?? []) {
    const child = new ICAL.Component('valarm');
    textProperty(child, 'action', 'DISPLAY');
    textProperty(child, 'description', alarm.description);
    child.updatePropertyWithValue('trigger', ICAL.Duration.fromString(alarm.trigger));
    component.addSubcomponent(child);
  }
  const preserved = event.extensions?.['ical.properties'];
  if (Array.isArray(preserved)) {
    for (const raw of preserved) {
      if (
        !Array.isArray(raw) ||
        typeof raw[0] !== 'string' ||
        KNOWN_PROPERTIES.has(raw[0]) ||
        PRIVATE_PROPERTIES.has(raw[0]) ||
        !/^[a-z0-9-]+$/.test(raw[0])
      )
        continue;
      component.addProperty(new ICAL.Property(raw));
    }
  }
  restoredParameters(component, event);
  return component;
}

function allTimes(event: EventContent): CalendarTime[] {
  const result = [event.dtstart, ...(event.dtend ? [event.dtend] : []), ...(event.exdate ?? [])];
  for (const addition of event.rdate ?? [])
    result.push(
      ...(addition.type === 'period' ? [addition.start, ...(addition.end ? [addition.end] : [])] : [addition]),
    );
  for (const override of event.overrides ?? [])
    result.push(
      override.recurrence_id,
      ...(override.changes.dtstart ? [override.changes.dtstart] : []),
      ...(override.changes.dtend ? [override.changes.dtend] : []),
    );
  return result;
}

function timezoneComponent(zone: string, definition?: string): ContractResult<ICAL.Component> {
  try {
    if (definition) return { ok: true, value: new ICAL.Component(ICAL.parse(definition)) };
    if (!ZONES.has(zone)) return { ok: false, issues: [`No export timezone definition is available for ${zone}.`] };
    const data = tzlib_get_ical_block(zone);
    if (!Array.isArray(data) || !data[0]) return { ok: false, issues: ['Timezone data is unavailable.'] };
    const component = new ICAL.Component(ICAL.parse(data[0]));
    // Aliases may share transitions, but every reference must resolve its exact emitted TZID.
    component.updatePropertyWithValue('tzid', zone);
    return { ok: true, value: component };
  } catch {
    return { ok: false, issues: ['Timezone data cannot be serialized.'] };
  }
}

export function exportEventIcs(event: EventContent, options: IcsExportOptions = {}): ContractResult<string> {
  return exportCalendarIcs([{ event, postUri: options.postUri, attachmentUris: options.attachmentUris }], options);
}

export function exportCalendarIcs(
  entries: { event: EventContent; postUri?: string; attachmentUris?: string[] }[],
  options: IcsExportOptions & { calendar?: CalendarContent } = {},
): ContractResult<string> {
  try {
    if (entries.length > 1000) return { ok: false, issues: ['Too many events for one calendar export.'] };
    if (options.calendar && !calendarContentSchema.safeParse(options.calendar).success)
      return { ok: false, issues: ['Calendar metadata is invalid.'] };
    const calendar = new ICAL.Component('vcalendar');
    textProperty(calendar, 'version', '2.0');
    textProperty(calendar, 'prodid', '-//Pubky//Eventky Native//EN');
    textProperty(calendar, 'calscale', 'GREGORIAN');
    const name = options.calendar?.name ?? options.calendarName;
    if (name) {
      textProperty(calendar, 'name', name);
      textProperty(calendar, 'x-wr-calname', name);
    }
    if (options.calendar?.description) textProperty(calendar, 'description', options.calendar.description);
    if (options.calendar?.uid) textProperty(calendar, 'uid', options.calendar.uid);
    if (options.calendar?.color) textProperty(calendar, 'x-apple-calendar-color', options.calendar.color);
    const ids = new Set<string>();
    const zones = new Map<string, ICAL.Component>();
    for (const { event, postUri, attachmentUris } of entries) {
      if (
        (postUri && !postUriSchema.safeParse(postUri).success) ||
        (attachmentUris && (attachmentUris.length > 100 || attachmentUris.some((uri) => !safeExportUri(uri))))
      )
        return { ok: false, issues: ['Export source or attachment URIs are invalid.'] };
      const parsed = eventContentSchema.safeParse(event);
      if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((issue) => issue.message) };
      if (ids.has(event.uid))
        return {
          ok: false,
          issues: ['Different event posts share an interchange UID; resolve this export conflict first.'],
        };
      ids.add(event.uid);
      for (const value of allTimes(event)) {
        if (value.type !== 'zoned') continue;
        const definition = timezoneComponent(value.tzid, event.timezone_definitions?.[value.tzid]);
        if (!definition.ok) return definition;
        const existing = zones.get(value.tzid);
        if (existing && existing.toString() !== definition.value.toString())
          return { ok: false, issues: ['Conflicting timezone definitions cannot share one exported calendar.'] };
        zones.set(value.tzid, definition.value);
        if (isSupportedTimeZone(value.tzid) && !event.timezone_definitions?.[value.tzid]) {
          const context = createTimezoneContext({ [value.tzid]: definition.value.toString() });
          const engineTime = calendarTimeToEpoch(value, value.tzid, 'import', context);
          const expected = calendarTimeToEpoch(value, value.tzid);
          if (!expected.ok || !engineTime.ok || engineTime.value !== expected.value)
            return {
              ok: false,
              issues: ['Export timezone data disagrees with this event time. Supply an accurate timezone definition.'],
            };
        }
      }
      calendar.addSubcomponent(eventComponent(event, { ...options, postUri, attachmentUris }));
      for (const override of event.overrides ?? []) {
        const resolved = resolveOccurrenceEvent(event, override.recurrence_id, options.timezone ?? 'UTC');
        if (!resolved.ok) return resolved;
        calendar.addSubcomponent(
          eventComponent(resolved.value.event, { ...options, postUri, attachmentUris }, override.recurrence_id),
        );
      }
    }
    for (const component of zones.values()) calendar.addSubcomponent(component);
    if (!safeComponentLines(calendar))
      return { ok: false, issues: ['A calendar property contains unsafe line breaks.'] };
    const value = foldIcsLines(calendar.toString());
    if (utf8Length(value) > 16 * 1024 * 1024)
      return { ok: false, issues: ['The calendar export exceeds its byte limit.'] };
    return { ok: true, value };
  } catch {
    return { ok: false, issues: ['The calendar cannot be exported safely.'] };
  }
}

function readTime(property: ICAL.Property, supplied?: unknown): CalendarTime | null {
  const value = supplied ?? property.getFirstValue();
  if (!(value instanceof ICAL.Time)) return null;
  const text = value.toString();
  if (value.isDate) return { type: 'date', value: text };
  if (text.endsWith('Z')) return { type: 'utc', value: text };
  const zone = property.getFirstParameter('tzid');
  return zone ? { type: 'zoned', value: text, tzid: zone } : { type: 'floating', value: text };
}

function valueString(component: ICAL.Component, name: string): string | undefined {
  const value = component.getFirstPropertyValue(name);
  return value === null ? undefined : String(value);
}

function readRecurrenceDates(component: ICAL.Component, name: string): (CalendarTime | RecurrencePeriod)[] {
  const dates: (CalendarTime | RecurrencePeriod)[] = [];
  for (const property of component.getAllProperties(name)) {
    for (const value of property.getValues()) {
      if (value instanceof ICAL.Period) {
        const start = readTime(property, value.start);
        const end = value.end ? readTime(property, value.end) : undefined;
        if (start && start.type !== 'date' && (!end || end.type !== 'date')) {
          dates.push(
            end ? { type: 'period', start, end } : { type: 'period', start, duration: value.duration.toString() },
          );
        }
      } else {
        const date = readTime(property, value);
        if (date) dates.push(date);
      }
    }
  }
  return dates;
}

function readOrganizer(component: ICAL.Component): Organizer | undefined {
  const property = component.getFirstProperty('organizer');
  if (!property) return undefined;
  return {
    uri: String(property.getFirstValue()),
    ...(property.getFirstParameter('cn') ? { name: property.getFirstParameter('cn') } : {}),
  };
}

function hasValidRawDates(component: ICAL.Component): boolean {
  for (const property of component.getAllProperties()) {
    const raw = property.toJSON();
    if (raw[2] === 'date' || raw[2] === 'date-time') {
      for (const value of raw.slice(3)) {
        if (typeof value !== 'string') return false;
        const time: CalendarTime =
          raw[2] === 'date'
            ? { type: 'date', value }
            : value.endsWith('Z')
              ? { type: 'utc', value }
              : { type: 'floating', value };
        if (!isValidCalendarTime(time)) return false;
      }
    }
    if (raw[2] === 'recur') {
      const until = raw[3]?.until;
      if (
        typeof until === 'string' &&
        !isValidCalendarTime(
          until.length === 10
            ? { type: 'date', value: until }
            : until.endsWith('Z')
              ? { type: 'utc', value: until }
              : { type: 'floating', value: until },
        )
      )
        return false;
    }
    if (raw[2] === 'period') {
      for (const period of raw.slice(3)) {
        if (!Array.isArray(period) || period.length !== 2) return false;
        for (const value of period) {
          if (typeof value !== 'string') return false;
          if (/^[+-]?P/.test(value)) continue;
          if (!isValidCalendarTime(value.endsWith('Z') ? { type: 'utc', value } : { type: 'floating', value }))
            return false;
        }
      }
    }
  }
  return component.getAllSubcomponents().every(hasValidRawDates);
}

function readEvent(
  component: ICAL.Component,
  options: IcsImportOptions,
  definitions: Record<string, string>,
  entry: IcsImportEntry,
): EventContent | undefined {
  if (!hasValidRawDates(component)) {
    entry.errors.push('The file contains an invalid date that must not be normalized silently.');
    return;
  }
  if (
    [
      'uid',
      'dtstart',
      'dtend',
      'dtstamp',
      'duration',
      'summary',
      'sequence',
      'created',
      'last-modified',
      'status',
      'transp',
      'organizer',
      'recurrence-id',
    ].some((name) => component.getAllProperties(name).length > 1)
  ) {
    entry.errors.push('Duplicate singleton event properties require review.');
    return;
  }
  const startProperty = component.getFirstProperty('dtstart');
  const start = startProperty ? readTime(startProperty) : null;
  if (!start) {
    entry.errors.push('Event has no supported DTSTART.');
    return;
  }
  const endProperty = component.getFirstProperty('dtend');
  const end = endProperty ? readTime(endProperty) : null;
  const fallbackStamp = valueString(component, 'dtstamp') ?? options.now;
  if (!component.hasProperty('dtstamp')) entry.warnings.push('Missing DTSTAMP uses the supplied import timestamp.');
  const event: EventContent = {
    schema: 'eventky.event',
    schema_version: 1,
    uid: entry.uid,
    summary: valueString(component, 'summary') ?? '(Untitled event)',
    dtstart: start,
    ...(end ? { dtend: end } : {}),
    ...(valueString(component, 'duration') ? { duration: valueString(component, 'duration') } : {}),
    dtstamp: fallbackStamp,
    created: valueString(component, 'created') ?? fallbackStamp,
    last_modified: valueString(component, 'last-modified') ?? fallbackStamp,
    sequence: Number(component.getFirstPropertyValue('sequence') ?? 0),
    description: valueString(component, 'description'),
    status: (valueString(component, 'status') as EventContent['status']) ?? 'CONFIRMED',
    transp: valueString(component, 'transp') as EventContent['transp'],
    url: valueString(component, 'url'),
    image_uri: valueString(component, 'image'),
    organizer: readOrganizer(component),
    ...(valueString(component, 'contact') ? { contact: { name: valueString(component, 'contact') } } : {}),
    related_to: component.getAllProperties('related-to').map((property) => ({
      uid: String(property.getFirstValue()),
      relation: (property.getFirstParameter('reltype') ?? 'PARENT') as 'PARENT' | 'CHILD' | 'SIBLING',
    })),
    rrule: valueString(component, 'rrule'),
    rdate: readRecurrenceDates(component, 'rdate'),
    exdate: readRecurrenceDates(component, 'exdate') as CalendarTime[],
    categories: component.getAllProperties('categories').flatMap((property) => property.getValues().map(String)),
    overrides: [],
    calendar_uris: [],
    extensions: {},
  };
  const referenced = new Set(
    allTimes(event)
      .filter((time): time is Extract<CalendarTime, { type: 'zoned' }> => time.type === 'zoned')
      .map((time) => time.tzid),
  );
  if ([...referenced].some((zone) => definitions[zone]))
    event.timezone_definitions = Object.fromEntries(
      [...referenced].filter((zone) => definitions[zone]).map((zone) => [zone, definitions[zone]]),
    );
  const location = valueString(component, 'location');
  const preservedLocations = valueString(component, 'x-pubky-locations');
  if (preservedLocations) {
    try {
      event.locations = JSON.parse(preservedLocations);
    } catch {
      entry.errors.push('Structured location data is invalid.');
    }
  } else {
    event.locations = location ? [{ id: 'location', kind: 'PHYSICAL', label: location }] : [];
    for (const [index, property] of component.getAllProperties('conference').entries())
      event.locations.push({
        id: `conference-${index}`,
        kind: 'VIRTUAL',
        label: property.getFirstParameter('label') || 'Online meeting',
        uri: String(property.getFirstValue()),
      });
  }
  const styled = component.getFirstProperty('styled-description');
  const geo = component.getFirstPropertyValue('geo');
  if (geo !== null) {
    if (!Array.isArray(geo) || geo.length !== 2 || geo.some((value) => typeof value !== 'number')) {
      entry.errors.push('Event coordinates are invalid.');
    } else {
      let physical = event.locations?.find((value) => value.kind === 'PHYSICAL');
      if (!physical) {
        physical = { id: 'geo', kind: 'PHYSICAL', label: 'Event location' };
        event.locations = [...(event.locations ?? []), physical];
      }
      if (physical.geo && (physical.geo.latitude !== geo[0] || physical.geo.longitude !== geo[1]))
        entry.errors.push('Standard and structured event coordinates conflict.');
      else physical.geo = { latitude: geo[0], longitude: geo[1] };
    }
  }
  if (styled?.getFirstParameter('fmttype') === 'text/markdown')
    event.styled_description = { format: 'markdown', content: String(styled.getFirstValue()) };
  else if (styled) {
    event.extensions!['ical.inactive-styled-description'] = styled.toICALString();
    entry.warnings.push('Unsupported styled text is preserved as inert metadata; review the plain description.');
    entry.requiresAcknowledgement.push('Review preserved rich description before public publication.');
  }
  const attachments = component.getAllProperties('attach');
  if (attachments.length) {
    event.extensions!['ical.inactive-attachments'] = attachments.map((property) => property.toICALString());
    entry.requiresAcknowledgement.push(
      'Source attachment references are preserved as inert metadata and will not be fetched.',
    );
  }
  if (component.hasProperty('attendee')) {
    entry.warnings.push('Attendee details were omitted from public event content.');
    entry.requiresAcknowledgement.push('Attendees will not be imported or contacted.');
  }
  const privacy = valueString(component, 'class');
  if (privacy && privacy !== 'PUBLIC')
    entry.requiresAcknowledgement.push(
      'This source event is marked private or confidential; publishing creates public data.',
    );
  if (component.getAllSubcomponents('valarm').length) {
    entry.warnings.push('Imported alarms remain inactive and require a separate personal reminder choice.');
    const display = component
      .getAllSubcomponents('valarm')
      .filter((alarm) => valueString(alarm, 'action') === 'DISPLAY');
    event.alarms = display.flatMap((alarm, index) => {
      const trigger = valueString(alarm, 'trigger');
      if (
        alarm.getFirstProperty('trigger')?.type !== 'duration' ||
        alarm.getFirstProperty('trigger')?.getFirstParameter('related') === 'END' ||
        alarm.hasProperty('repeat') ||
        alarm.hasProperty('duration')
      ) {
        const prior = event.extensions!['ical.inactive-alarms'];
        event.extensions!['ical.inactive-alarms'] = [...(Array.isArray(prior) ? prior : []), alarm.toString()];
        entry.warnings.push('An unsupported alarm trigger is retained as inert metadata.');
        return [];
      }
      return trigger
        ? [
            {
              id: `alarm-${index}`,
              action: 'DISPLAY' as const,
              trigger,
              description: valueString(alarm, 'description') ?? event.summary,
            },
          ]
        : [];
    });
  }
  const unsupportedComponents = component.getAllSubcomponents().filter((child) => child.name !== 'valarm');
  if (unsupportedComponents.length) {
    event.extensions!['ical.inactive-components'] = unsupportedComponents.map((child) => child.toString());
    entry.requiresAcknowledgement.push('Unsupported structured subcomponents are preserved as public inert metadata.');
  }
  const unknown = component
    .getAllProperties()
    .filter((property) => !KNOWN_PROPERTIES.has(property.name) && !PRIVATE_PROPERTIES.has(property.name));
  if (unknown.length) {
    event.extensions!['ical.properties'] = unknown.map((property) => property.toJSON());
    entry.warnings.push('Additional calendar properties are preserved as public inert metadata.');
    entry.requiresAcknowledgement.push('Review preserved source metadata before public publication.');
  }
  const parameters: Record<string, unknown> = {};
  for (const property of component.getAllProperties()) {
    if (!KNOWN_PROPERTIES.has(property.name)) continue;
    const raw = property.toJSON();
    if (Object.keys(raw[1]).some((name) => !['tzid', 'value'].includes(name))) parameters[property.name] = raw[1];
  }
  if (Object.keys(parameters).length) event.extensions!['ical.parameters'] = parameters;
  if (options.source) event.extensions!['eventky.import-source'] = options.source;
  if (component.getAllProperties('rrule').length > 1)
    entry.errors.push('Multiple RRULE properties require an unsupported import profile.');
  const parsed = eventContentSchema.safeParse(event);
  if (!parsed.success) {
    entry.errors.push(...parsed.error.issues.map((issue) => issue.message));
    return;
  }
  return parsed.data;
}

/** Parse/preview only: no network requests, alarm execution, mail, or storage writes. */
export function importCalendarIcs(text: string, options: IcsImportOptions): IcsImportReport {
  const report: IcsImportReport = { entries: [], warnings: [], errors: [] };
  if (typeof text !== 'string' || utf8Length(text) > MAX_IMPORT_BYTES) {
    report.errors.push('The import exceeds the 2 MiB file limit.');
    return report;
  }
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  let depth = 0;
  let components = 0;
  for (const line of unfolded.split(/\r?\n/)) {
    if (/^BEGIN:/i.test(line)) {
      if (++depth > 8 || ++components > 2048) {
        report.errors.push('Calendar component limits exceeded.');
        return report;
      }
    }
    if (/^END:/i.test(line)) depth--;
    if (depth < 0 || utf8Length(line) > 256 * 1024) {
      report.errors.push('Calendar structure or line limits exceeded.');
      return report;
    }
  }
  if (depth !== 0) {
    report.errors.push('Calendar components are unbalanced.');
    return report;
  }
  try {
    const calendar = new ICAL.Component(ICAL.parse(text));
    if (calendar.name !== 'vcalendar' || valueString(calendar, 'version') !== '2.0') {
      report.errors.push('Import requires one VERSION:2.0 VCALENDAR.');
      return report;
    }
    if (calendar.hasProperty('method'))
      report.warnings.push('Scheduling METHOD was ignored; this is a publication preview, not an invitation response.');
    const definitions: Record<string, string> = {};
    for (const component of calendar.getAllSubcomponents('vtimezone')) {
      if (!hasValidRawDates(component)) {
        report.errors.push('A timezone definition contains invalid dates.');
        return report;
      }
      const zone = valueString(component, 'tzid');
      if (!zone || definitions[zone]) {
        report.errors.push('Timezone identifiers are missing or duplicated.');
        return report;
      }
      definitions[zone] = foldIcsLines(component.toString());
    }
    const groups = new Map<string, ICAL.Component[]>();
    for (const component of calendar.getAllSubcomponents('vevent')) {
      const uid = valueString(component, 'uid');
      if (!uid) {
        report.errors.push('An event without UID cannot be imported.');
        continue;
      }
      groups.set(uid, [...(groups.get(uid) ?? []), component]);
    }
    if (groups.size > 500) {
      report.errors.push('Import at most 500 event series at once.');
      return report;
    }
    for (const [uid, group] of groups) {
      const entry: IcsImportEntry = { uid, warnings: [], errors: [], requiresAcknowledgement: [], action: 'create' };
      report.entries.push(entry);
      const masters = group.filter((component) => !component.hasProperty('recurrence-id'));
      if (masters.length !== 1) {
        entry.errors.push('Each UID requires exactly one master event; resolve duplicates or orphan exceptions.');
        entry.action = 'conflict';
        continue;
      }
      const event = readEvent(masters[0], options, definitions, entry);
      if (!event) continue;
      const overrides: EventOverride[] = [];
      for (const component of group.filter((candidate) => candidate.hasProperty('recurrence-id'))) {
        const property = component.getFirstProperty('recurrence-id')!;
        if (property.getFirstParameter('range')) {
          entry.errors.push('THISANDFUTURE exceptions require an unsupported import profile.');
          continue;
        }
        const identity = readTime(property);
        const resolved = readEvent(component, options, definitions, entry);
        if (!identity || !resolved) continue;
        const changes: EventOccurrencePatch = { dtstart: resolved.dtstart };
        const mapping: [keyof EventOccurrencePatch, string][] = [
          ['summary', 'summary'],
          ['description', 'description'],
          ['styled_description', 'styled-description'],
          ['status', 'status'],
          ['transp', 'transp'],
          ['locations', 'location'],
          ['url', 'url'],
          ['dtend', 'dtend'],
          ['duration', 'duration'],
        ];
        for (const [key, name] of mapping)
          if (component.hasProperty(name)) (changes as Record<string, unknown>)[key] = resolved[key];
        if (component.hasProperty('x-pubky-locations') || component.hasProperty('conference'))
          changes.locations = resolved.locations;
        if (component.getAllSubcomponents('valarm').length) changes.alarms = resolved.alarms;
        overrides.push({ recurrence_id: identity, changes });
        event.timezone_definitions = { ...event.timezone_definitions, ...resolved.timezone_definitions };
      }
      event.overrides = overrides;
      if (new Set(overrides.map((override) => occurrenceKey(override.recurrence_id))).size !== overrides.length)
        entry.errors.push('Duplicate recurrence exception identifiers require review.');
      const parsed = eventContentSchema.safeParse(event);
      if (parsed.success) {
        entry.event = parsed.data;
        entry.contentFingerprint = JSON.stringify(parsed.data);
      } else entry.errors.push(...parsed.error.issues.map((issue) => issue.message));
      const existing = (options.existing ?? []).filter(
        (record) => record.uid === uid && record.source === options.source,
      );
      if (existing.length > 1 || existing.some((record) => !record.owned)) {
        entry.action = 'conflict';
        entry.errors.push('The UID maps to ambiguous or unowned posts.');
      } else if (existing.length === 1) {
        entry.existingPostUri = existing[0].postUri;
        entry.action = entry.contentFingerprint === existing[0].contentFingerprint ? 'unchanged' : 'review-update';
        if (event.sequence < existing[0].sequence)
          entry.warnings.push('The imported sequence is older than the mapped event; review before replacing it.');
      }
    }
    if (options.calendarUid) {
      const candidate = calendarContentSchema.safeParse({
        schema: 'eventky.calendar',
        schema_version: 1,
        uid: options.calendarUid,
        name: valueString(calendar, 'name') ?? valueString(calendar, 'x-wr-calname') ?? 'Imported calendar',
        description: valueString(calendar, 'description') ?? valueString(calendar, 'x-wr-caldesc'),
        timezone: options.defaultTimezone ?? 'UTC',
        created: options.now,
        last_modified: options.now,
        sequence: 0,
      });
      if (candidate.success) report.calendar = candidate.data;
      else report.errors.push(...candidate.error.issues.map((issue) => issue.message));
    }
    if (calendar.getAllSubcomponents().some((component) => !['vevent', 'vtimezone'].includes(component.name)))
      report.warnings.push('Non-event calendar components were not converted to public posts.');
    return report;
  } catch {
    report.errors.push('The calendar file cannot be parsed safely.');
    return report;
  }
}
