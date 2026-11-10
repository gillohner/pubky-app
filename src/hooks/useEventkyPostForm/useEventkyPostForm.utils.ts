import {
  createCalendarContent,
  createEventContent,
  serializeEventkyContent,
  updateCalendarContent,
  updateEventContent,
} from '@eventky/contract';
import type { CalendarContent, CalendarTime, ContractResult, EventContent } from '@eventky/types';
import { Temporal } from '@js-temporal/polyfill';
import type { EventkyPostFormData, EventkyPostKind } from './useEventkyPostForm.types';

const splitValues = (input: string) => [
  ...new Set(
    input
      .split(/[\n,]/)
      .map((value) => value.trim())
      .filter(Boolean),
  ),
];

export function getEventkyFormDefaults(
  _kind: EventkyPostKind,
  source?: EventContent | CalendarContent,
  initialDescription = '',
): EventkyPostFormData {
  const timezone =
    source?.schema === 'eventky.calendar'
      ? source.timezone
      : source?.schema === 'eventky.event' && source.dtstart.type === 'zoned'
        ? source.dtstart.tzid
        : source?.schema === 'eventky.event' && source.dtstart.type === 'utc'
          ? 'UTC'
          : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  let now;
  try {
    now = Temporal.Now.zonedDateTimeISO(timezone);
  } catch {
    now = Temporal.Now.zonedDateTimeISO('UTC');
  }
  now = now.add({ hours: 1 }).with({ minute: 0, second: 0, millisecond: 0 });
  const defaultEnd = now.add({ hours: 1 });
  const start = source?.schema === 'eventky.event' ? source.dtstart : undefined;
  const end = source?.schema === 'eventky.event' ? source.dtend : undefined;
  const allDay = start?.type === 'date';
  const event = source?.schema === 'eventky.event' ? source : undefined;
  const calendar = source?.schema === 'eventky.calendar' ? source : undefined;
  const endDate =
    end?.type === 'date'
      ? Temporal.PlainDate.from(end.value).subtract({ days: 1 }).toString()
      : (end?.value.slice(0, 10) ?? start?.value.slice(0, 10) ?? defaultEnd.toPlainDate().toString());
  return {
    title: event?.summary ?? calendar?.name ?? '',
    description: event?.styled_description?.content ?? source?.description ?? initialDescription,
    startDate: start?.value.slice(0, 10) ?? now.toPlainDate().toString(),
    startTime:
      start && start.type !== 'date'
        ? start.value.slice(11).replace(/Z$/, '')
        : now.toPlainTime().toString().slice(0, 5),
    endDate,
    endTime:
      end && end.type !== 'date'
        ? end.value.slice(11).replace(/Z$/, '')
        : defaultEnd.toPlainTime().toString().slice(0, 5),
    allDay,
    useDuration: Boolean(event?.duration),
    duration: event?.duration ?? 'PT1H',
    timezone,
    timeMode: start?.type === 'floating' ? 'floating' : start?.type === 'utc' ? 'utc' : 'zoned',
    status: event?.status ?? 'CONFIRMED',
    recurrence: event?.rrule ?? '',
    overrides: event?.overrides ?? [],
    location: event?.locations?.find((location) => location.kind === 'PHYSICAL')?.label ?? '',
    locationUrl: event?.locations?.find((location) => location.kind === 'PHYSICAL')?.uri ?? '',
    onlineUrl: event?.locations?.find((location) => location.kind === 'VIRTUAL')?.uri ?? '',
    website: source?.url ?? '',
    calendarUris: event?.calendar_uris?.join('\n') ?? '',
    contributors: calendar?.contributors?.join('\n') ?? '',
    excludedEventUris: calendar?.excluded_event_uris?.join('\n') ?? '',
    weekStart: calendar?.week_start ?? 'MO',
    defaultDuration: calendar?.default_event_duration ?? '',
    color: calendar?.color ?? '#6757E8',
    organizerName: event?.organizer?.name ?? '',
    organizerUrl: event?.organizer?.uri ?? '',
    categories: event?.categories?.join(', ') ?? '',
    transparent: event?.transp === 'TRANSPARENT',
  };
}

function formTime(date: string, time: string, form: EventkyPostFormData, _source?: CalendarTime): CalendarTime {
  if (form.allDay) return { type: 'date', value: date };
  const value = `${date}T${time.length === 5 ? `${time}:00` : time}`;
  if (form.timeMode === 'floating') return { type: 'floating', value };
  if (form.timeMode === 'utc') return { type: 'utc', value: `${value}Z` };
  return { type: 'zoned', value, tzid: form.timezone };
}

/** Applies only form-owned fields; recurrence exceptions and unknown extensions survive edits. */
export function buildEventkyFormContent(
  kind: EventkyPostKind,
  form: EventkyPostFormData,
  identity: { uid: string; now: string },
  source?: EventContent | CalendarContent,
  initialValues?: EventkyPostFormData,
): ContractResult<string> {
  if (kind === 'calendar') {
    const previous = source?.schema === 'eventky.calendar' ? source : undefined;
    const patch = {
      ...previous,
      name: form.title,
      description: form.description,
      timezone: form.timezone,
      color: form.color,
      contributors: splitValues(form.contributors),
      excluded_event_uris: splitValues(form.excludedEventUris),
      week_start: form.weekStart,
      default_event_duration: form.defaultDuration || undefined,
      url: form.website || undefined,
      sequence: previous ? previous.sequence + 1 : 0,
      last_modified: identity.now,
    };
    const parsed = previous
      ? updateCalendarContent(previous, patch, identity.now)
      : createCalendarContent(patch, identity);
    return parsed.ok ? serializeEventkyContent(parsed.value) : parsed;
  }

  const previous = source?.schema === 'eventky.event' ? source : undefined;
  let end: CalendarTime | undefined;
  try {
    end = form.allDay
      ? { type: 'date', value: Temporal.PlainDate.from(form.endDate).add({ days: 1 }).toString() }
      : form.useDuration
        ? undefined
        : formTime(form.endDate, form.endTime, form, previous?.dtend);
  } catch {
    return { ok: false, issues: ['Choose a valid end date.'] };
  }
  const primaryPhysical = previous?.locations?.find((location) => location.kind === 'PHYSICAL');
  const primaryVirtual = previous?.locations?.find((location) => location.kind === 'VIRTUAL');
  const extraLocations =
    previous?.locations?.filter((location) => location !== primaryPhysical && location !== primaryVirtual) ?? [];
  const patch: Partial<EventContent> & Pick<EventContent, 'summary' | 'dtstart'> = {
    ...previous,
    summary: form.title,
    description: form.description,
    styled_description: { format: 'markdown', content: form.description },
    dtstart: formTime(form.startDate, form.startTime, form, previous?.dtstart),
    dtend: end,
    duration: !form.allDay && form.useDuration ? form.duration : undefined,
    status: form.status,
    rrule: form.recurrence.trim() || undefined,
    overrides: form.overrides,
    calendar_uris: splitValues(form.calendarUris),
    locations: [
      ...extraLocations,
      ...(form.location
        ? [
            {
              ...primaryPhysical,
              id: primaryPhysical?.id ?? 'venue',
              kind: 'PHYSICAL' as const,
              label: form.location,
              uri: form.locationUrl || undefined,
            },
          ]
        : []),
      ...(form.onlineUrl
        ? [
            {
              ...primaryVirtual,
              id: primaryVirtual?.id ?? 'online',
              kind: 'VIRTUAL' as const,
              label: primaryVirtual?.label ?? 'Join online',
              uri: form.onlineUrl,
            },
          ]
        : []),
    ],
    url: form.website || undefined,
    organizer:
      form.organizerName || form.organizerUrl
        ? { ...previous?.organizer, name: form.organizerName || undefined, uri: form.organizerUrl || undefined }
        : undefined,
    categories: splitValues(form.categories),
    transp: form.transparent ? 'TRANSPARENT' : 'OPAQUE',
    sequence: previous ? previous.sequence + 1 : 0,
    last_modified: identity.now,
    dtstamp: identity.now,
  };
  if (previous) {
    const baseline = initialValues ?? getEventkyFormDefaults(kind, previous);
    const unchanged = (keys: (keyof EventkyPostFormData)[]) => keys.every((key) => form[key] === baseline[key]);
    if (unchanged(['startDate', 'startTime', 'allDay', 'timezone', 'timeMode'])) patch.dtstart = previous.dtstart;
    if (unchanged(['endDate', 'endTime', 'allDay', 'timezone', 'timeMode', 'useDuration', 'duration'])) {
      patch.dtend = previous.dtend;
      patch.duration = previous.duration;
    }
    if (unchanged(['description'])) {
      patch.description = previous.description;
      patch.styled_description = previous.styled_description;
    }
    if (unchanged(['location', 'locationUrl', 'onlineUrl'])) patch.locations = previous.locations;
    if (unchanged(['organizerName', 'organizerUrl'])) patch.organizer = previous.organizer;
  }
  const parsed = previous ? updateEventContent(previous, patch, identity.now) : createEventContent(patch, identity);
  return parsed.ok ? serializeEventkyContent(parsed.value) : parsed;
}
