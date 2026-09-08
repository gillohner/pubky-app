import type { CalendarTime, EventContent } from '@eventky/contract';
import { parseCalendarDuration } from '@eventky/temporal';

/** Format the declared wall clock without applying the browser's timezone. */
export function formatCalendarTime(time: CalendarTime): string {
  const date = new Date(
    time.type === 'date' ? `${time.value}T00:00:00Z` : time.type === 'utc' ? time.value : `${time.value}Z`,
  );
  const formatted = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
    ...(time.type === 'date' ? {} : { hour: 'numeric', minute: '2-digit' }),
  }).format(date);
  if (time.type === 'date') return `${formatted} · All day`;
  const zone = time.type === 'zoned' ? time.tzid : time.type === 'utc' ? 'UTC' : 'Local time (floating)';
  return `${formatted} (${zone})`;
}

export function formatEventSchedule(event: EventContent): string {
  const start = formatCalendarTime(event.dtstart);
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
  // RFC 5545's all-day DTEND is exclusive. Show the last occupied day to people.
  if (event.dtstart.type === 'date' && event.dtend.type === 'date') {
    const end = new Date(`${event.dtend.value}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() - 1);
    const inclusiveEnd = end.toISOString().slice(0, 10);
    return inclusiveEnd === event.dtstart.value
      ? start
      : `${start} – ${formatCalendarTime({ type: 'date', value: inclusiveEnd })}`;
  }
  return `${start} – ${formatCalendarTime(event.dtend)}`;
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
