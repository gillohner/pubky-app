import type { EventOccurrence } from '@eventky/recurrence';
import { calendarTimeToEpoch, occurrenceKey } from '@eventky/temporal';
import type { CalendarTime, ContractResult, EventOccurrencePatch, EventOverride } from '@eventky/types';
import { Temporal } from '@js-temporal/polyfill';

const weekdays = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
export type RecurrencePreset = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'custom';

export function recurrencePreset(rule: string): RecurrencePreset {
  if (!rule) return 'none';
  if (rule === 'FREQ=DAILY') return 'daily';
  if (rule === 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR') return 'weekdays';
  if (/^FREQ=WEEKLY;BYDAY=(MO|TU|WE|TH|FR|SA|SU)$/.test(rule)) return 'weekly';
  if (rule === 'FREQ=MONTHLY') return 'monthly';
  if (rule === 'FREQ=YEARLY') return 'yearly';
  return 'custom';
}

export function presetRule(preset: RecurrencePreset, startDate: string, current: string): string {
  if (preset === 'custom') return current || 'FREQ=WEEKLY;COUNT=10';
  if (preset === 'none') return '';
  if (preset === 'weekdays') return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
  if (preset === 'weekly') {
    try {
      return `FREQ=WEEKLY;BYDAY=${weekdays[Temporal.PlainDate.from(startDate).dayOfWeek - 1]}`;
    } catch {
      return 'FREQ=WEEKLY';
    }
  }
  return `FREQ=${preset.toUpperCase()}`;
}

/** Replaces one patch by immutable original identity, retaining all other exception fields. */
export function patchOccurrence(
  overrides: EventOverride[],
  identity: CalendarTime,
  changes: EventOccurrencePatch,
): EventOverride[] {
  const key = occurrenceKey(identity);
  const existing = overrides.find((item) => occurrenceKey(item.recurrence_id) === key);
  return [
    ...overrides.filter((item) => occurrenceKey(item.recurrence_id) !== key),
    {
      recurrence_id: identity,
      changes: { ...existing?.changes, ...changes },
    },
  ];
}

export function movedOccurrenceTime(identity: CalendarTime, date: string, time: string): ContractResult<CalendarTime> {
  try {
    const value =
      identity.type === 'date'
        ? Temporal.PlainDate.from(date).toString()
        : Temporal.PlainDateTime.from(`${date}T${time}`).toString({ smallestUnit: 'second' });
    const result = { ...identity, value: identity.type === 'utc' ? `${value}Z` : value };
    return { ok: true, value: result };
  } catch {
    return { ok: false, issues: ['Choose a valid date and time for this occurrence.'] };
  }
}

/** A nominal duration (e.g. P1D across DST) stays nominal when an occurrence moves. */
export function moveOccurrence(
  occurrence: EventOccurrence,
  start: CalendarTime,
  summary: string,
): EventOccurrencePatch {
  let duration = occurrence.event.duration ?? null;
  if (!duration && occurrence.start.type === 'date' && occurrence.end.type === 'date') {
    const days = Temporal.PlainDate.from(occurrence.start.value).until(
      Temporal.PlainDate.from(occurrence.end.value),
    ).days;
    duration = `P${days}D`;
  } else if (!duration && occurrence.end_epoch_ms > occurrence.start_epoch_ms) {
    duration = `PT${(occurrence.end_epoch_ms - occurrence.start_epoch_ms) / 1000}S`;
  }
  return { dtstart: start, summary, dtend: null, duration };
}

export function previewWindow(date: string, timezone: string): ContractResult<{ from: string; to: string }> {
  try {
    const from = calendarTimeToEpoch({ type: 'date', value: date }, timezone);
    if (!from.ok) return from;
    const to = calendarTimeToEpoch(
      { type: 'date', value: Temporal.PlainDate.from(date).add({ days: 90 }).toString() },
      timezone,
    );
    if (!to.ok) return to;
    return { ok: true, value: { from: new Date(from.value).toISOString(), to: new Date(to.value).toISOString() } };
  } catch {
    return { ok: false, issues: ['Choose a valid preview date and viewing timezone.'] };
  }
}
