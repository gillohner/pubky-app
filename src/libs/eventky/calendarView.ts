import type { ProjectedOccurrence } from '@eventky-api/types';
import { Temporal } from '@js-temporal/polyfill';
import type { CalendarView } from '@/stores/eventkyCalendar/eventkyCalendar.store';

export interface CalendarDay {
  date: string;
  label: string;
  weekday: string;
  start: number;
  end: number;
}

export function getCalendarWindow(anchor: string, view: CalendarView, timezone: string, weekStart: 1 | 7) {
  const date = Temporal.PlainDate.from(anchor);
  let start = view === 'month' ? date.with({ day: 1 }) : date;
  if (view === 'month' || view === 'week') start = start.subtract({ days: (start.dayOfWeek - weekStart + 7) % 7 });
  let end =
    view === 'day'
      ? start.add({ days: 1 })
      : view === 'week'
        ? start.add({ days: 7 })
        : view === 'agenda'
          ? start.add({ days: 30 })
          : date.with({ day: 1 }).add({ months: 1 });
  if (view === 'month') end = end.add({ days: (weekStart - end.dayOfWeek + 7) % 7 });
  const epoch = (day: Temporal.PlainDate) =>
    day.toZonedDateTime({ timeZone: timezone, plainTime: '00:00' }).epochMilliseconds;
  const days: CalendarDay[] = [];
  for (let day = start; Temporal.PlainDate.compare(day, end) < 0; day = day.add({ days: 1 })) {
    days.push({
      date: day.toString(),
      label: day.toLocaleString('en-US', { month: 'short', day: 'numeric' }),
      weekday: day.toLocaleString('en-US', { weekday: 'short' }),
      start: epoch(day),
      end: epoch(day.add({ days: 1 })),
    });
  }
  return { from: new Date(epoch(start)).toISOString(), to: new Date(epoch(end)).toISOString(), days };
}

export function occurrenceOverlapsDay(occurrence: ProjectedOccurrence, day: CalendarDay): boolean {
  return (
    occurrence.start_epoch_ms < day.end &&
    (occurrence.end_epoch_ms > day.start ||
      (occurrence.end_epoch_ms === occurrence.start_epoch_ms && occurrence.start_epoch_ms >= day.start))
  );
}

export function moveCalendarAnchor(anchor: string, view: CalendarView, direction: -1 | 1): string {
  return Temporal.PlainDate.from(anchor)
    .add(
      view === 'month'
        ? { months: direction }
        : { days: direction * (view === 'week' ? 7 : view === 'agenda' ? 30 : 1) },
    )
    .toString();
}

export function calendarToday(timezone: string): string {
  return Temporal.Now.plainDateISO(timezone).toString();
}
