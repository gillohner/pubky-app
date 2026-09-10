import type { CalendarTime, EventContent } from '@eventky/contract';
import { calendarTimeToEpoch, parseCalendarDuration } from '@eventky/temporal';
import { type CalendarTimezoneContext, createTimezoneContext } from '@eventky/timezone';
import { Temporal } from '@js-temporal/polyfill';

type DisplayOptions = { timeZone?: string; context?: CalendarTimezoneContext };
const dateOptions: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };

/** Dates and floating values are civil values, not instants. UTC here is only a formatting anchor. */
function formatCivilTime(time: CalendarTime): string {
  const local = Temporal.PlainDateTime.from(
    time.type === 'date' ? `${time.value}T00:00:00` : time.value.replace(/Z$/, ''),
  );
  return new Intl.DateTimeFormat('en-US', {
    ...dateOptions,
    timeZone: 'UTC',
    ...(time.type === 'date' ? {} : { hour: 'numeric', minute: '2-digit' }),
  }).format(local.toZonedDateTime('UTC').epochMilliseconds);
}

/** Native reading surfaces resolve instants through the calendar engine and display in the device zone. */
export function formatCalendarTime(time: CalendarTime, options: DisplayOptions = {}): string {
  if (time.type === 'date') return `${formatCivilTime(time)} · All day`;
  if (time.type === 'floating') return formatCivilTime(time);
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const epoch = calendarTimeToEpoch(time, timeZone, 'import', options.context);
  if (!epoch.ok) return 'Time unavailable';
  return new Intl.DateTimeFormat('en-US', {
    ...dateOptions,
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(epoch.value);
}

/** Authoring needs the declared wall time and zone so recurrence edits preserve source semantics. */
export function formatAuthoringCalendarTime(time: CalendarTime): string {
  const formatted = formatCivilTime(time);
  if (time.type === 'date') return `${formatted} · All day`;
  const zone = time.type === 'zoned' ? time.tzid : time.type === 'utc' ? 'UTC' : 'Local time (floating)';
  return `${formatted} (${zone})`;
}

export function formatEventSchedule(event: EventContent, timeZone?: string): string {
  const options = { timeZone, context: createTimezoneContext(event.timezone_definitions) };
  const start = formatCalendarTime(event.dtstart, options);
  if (!event.dtend) {
    if (!event.duration) return start;
    const duration = parseCalendarDuration(event.duration);
    if (!duration.ok) return start;
    const units = ['weeks', 'days', 'hours', 'minutes', 'seconds'] as const;
    const label = units
      .filter((unit) => duration.value[unit])
      .map((unit) => `${duration.value[unit]} ${duration.value[unit] === 1 ? unit.slice(0, -1) : unit}`)
      .join(', ');
    return `${start} · ${label}`;
  }
  // RFC 5545's all-day DTEND is exclusive. Show the last occupied civil day without shifting dates.
  if (event.dtstart.type === 'date' && event.dtend.type === 'date') {
    const inclusiveEnd = Temporal.PlainDate.from(event.dtend.value).subtract({ days: 1 }).toString();
    return inclusiveEnd === event.dtstart.value
      ? start
      : `${start} – ${formatCalendarTime({ type: 'date', value: inclusiveEnd }, options)}`;
  }
  return `${start} – ${formatCalendarTime(event.dtend, options)}`;
}

export function formatEventRecurrence(event: EventContent): string | null {
  if (!event.rrule) return event.rdate?.length ? 'Additional dates' : null;
  const frequency = /(?:^|;)FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(?:;|$)/.exec(event.rrule)?.[1];
  const interval = /(?:^|;)INTERVAL=(\d+)(?:;|$)/.exec(event.rrule)?.[1];
  const units: Record<string, string> = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' };
  if (!frequency) return 'Recurring event';
  return interval && interval !== '1'
    ? `Repeats every ${interval} ${units[frequency]}s`
    : `Repeats ${frequency.toLowerCase()}`;
}
