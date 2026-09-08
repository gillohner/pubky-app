import { Temporal } from '@js-temporal/polyfill';
import type { CalendarTimezoneContext } from './timezone';
import { definedLocalFromEpoch, resolveDefinedLocal } from './timezone';
import type { CalendarTime, ContractResult } from './types';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const DURATION = /^P(?:(\d+)W|(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?)$/;

export function isValidCalendarTime(value: CalendarTime): boolean {
  try {
    if (value.type === 'date') return DATE.test(value.value) && !!Temporal.PlainDate.from(value.value);
    if (value.type === 'utc')
      return (
        UTC.test(value.value) && Temporal.Instant.from(value.value).toString({ smallestUnit: 'second' }) === value.value
      );
    return (
      LOCAL.test(value.value) &&
      Temporal.PlainDateTime.from(value.value).toString({ smallestUnit: 'second' }) === value.value
    );
  } catch {
    return false;
  }
}

export function isSupportedTimeZone(tzid: string): boolean {
  if (/^[+-]/.test(tzid)) return false;
  try {
    Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(tzid);
    return true;
  } catch {
    return false;
  }
}

export function parseCalendarDuration(value: string): ContractResult<Temporal.Duration> {
  if (value.length > 64 || !DURATION.test(value) || value.endsWith('T')) {
    return { ok: false, issues: ['Use a positive duration in weeks, days, hours, minutes, or seconds.'] };
  }
  try {
    const duration = Temporal.Duration.from(value);
    if (duration.sign !== 1) return { ok: false, issues: ['Duration must be positive.'] };
    return { ok: true, value: duration };
  } catch {
    return { ok: false, issues: ['Duration is outside the supported range.'] };
  }
}

/** A recurrence identity keeps the original temporal mode and zone, not its moved start. */
export function occurrenceKey(value: CalendarTime): string {
  return JSON.stringify(value.type === 'zoned' ? [value.type, value.tzid, value.value] : [value.type, value.value]);
}

export function sameTemporalMode(a: CalendarTime, b: CalendarTime): boolean {
  return a.type === b.type && (a.type !== 'zoned' || (b.type === 'zoned' && a.tzid === b.tzid));
}

/**
 * Converts in an explicit view zone. `import` follows first-fold/pre-gap-offset semantics;
 * `authoring` rejects gaps and overlaps so the caller can obtain an explicit choice.
 */
export function calendarTimeToEpoch(
  value: CalendarTime,
  viewTimeZone: string,
  mode: 'import' | 'authoring' = 'import',
  context?: CalendarTimezoneContext,
): ContractResult<number> {
  if (!isValidCalendarTime(value)) return { ok: false, issues: ['Invalid calendar date or time.'] };
  try {
    if (value.type === 'utc') return { ok: true, value: Temporal.Instant.from(value.value).epochMilliseconds };
    const zone = value.type === 'zoned' ? value.tzid : viewTimeZone;
    if (value.type === 'zoned' && context?.definitions[zone]) {
      const defined = resolveDefinedLocal(context, zone, value.value, mode);
      return defined.ok ? { ok: true, value: defined.value.epoch } : defined;
    }
    if (!isSupportedTimeZone(zone)) return { ok: false, issues: ['Unsupported timezone.'] };
    const local = Temporal.PlainDateTime.from(value.type === 'date' ? `${value.value}T00:00:00` : value.value);
    const instant = local.toZonedDateTime(zone, { disambiguation: mode === 'authoring' ? 'reject' : 'compatible' });
    return { ok: true, value: instant.epochMilliseconds };
  } catch {
    return { ok: false, issues: ['This local time is ambiguous, nonexistent, or outside the supported range.'] };
  }
}

/** A generated RRULE gap is excluded; an explicitly supplied DTSTART/RDATE uses import semantics. */
export function isGeneratedGap(value: CalendarTime, context?: CalendarTimezoneContext): boolean {
  if (value.type === 'zoned' && context?.definitions[value.tzid]) {
    const defined = resolveDefinedLocal(context, value.tzid, value.value);
    return defined.ok && defined.value.gap;
  }
  if (value.type !== 'zoned' || !isSupportedTimeZone(value.tzid)) return false;
  try {
    const local = Temporal.PlainDateTime.from(value.value);
    return !local.equals(local.toZonedDateTime(value.tzid, { disambiguation: 'compatible' }).toPlainDateTime());
  } catch {
    return true;
  }
}

export function addCalendarDuration(
  start: CalendarTime,
  durationText: string,
  viewTimeZone: string,
  context?: CalendarTimezoneContext,
): ContractResult<CalendarTime> {
  const parsed = parseCalendarDuration(durationText);
  if (!parsed.ok) return parsed;
  try {
    const duration = parsed.value;
    if (start.type === 'date') {
      if (duration.hours || duration.minutes || duration.seconds) {
        return { ok: false, issues: ['All-day durations must contain only days or weeks.'] };
      }
      return {
        ok: true,
        value: { type: 'date', value: Temporal.PlainDate.from(start.value).add(duration).toString() },
      };
    }
    if (start.type === 'floating') {
      return {
        ok: true,
        value: {
          type: 'floating',
          value: Temporal.PlainDateTime.from(start.value).add(duration).toString({ smallestUnit: 'second' }),
        },
      };
    }
    const epoch = calendarTimeToEpoch(start, viewTimeZone, 'import', context);
    if (!epoch.ok) return epoch;
    if (start.type === 'zoned' && context?.definitions[start.tzid]) {
      const wall = definedLocalFromEpoch(context, start.tzid, epoch.value);
      if (!wall.ok) return wall;
      const nominal = Temporal.PlainDateTime.from(wall.value)
        .add({ weeks: duration.weeks, days: duration.days })
        .toString({ smallestUnit: 'second' });
      const dayEnd = resolveDefinedLocal(context, start.tzid, nominal);
      if (!dayEnd.ok) return dayEnd;
      const exactEnd = Temporal.Instant.fromEpochMilliseconds(dayEnd.value.epoch).add({
        hours: duration.hours,
        minutes: duration.minutes,
        seconds: duration.seconds,
      });
      return epochToCalendarTime(exactEnd.epochMilliseconds, start, viewTimeZone, context);
    }
    const zone = start.type === 'zoned' ? start.tzid : 'UTC';
    const end = Temporal.Instant.fromEpochMilliseconds(epoch.value).toZonedDateTimeISO(zone).add(duration);
    return epochToCalendarTime(end.epochMilliseconds, start, viewTimeZone, context);
  } catch {
    return { ok: false, issues: ['Duration exceeds the supported calendar range.'] };
  }
}

/** A second-fold instant needs UTC because a local RFC date-time denotes the first fold. */
export function epochToCalendarTime(
  epoch: number,
  template: CalendarTime,
  viewTimeZone: string,
  context?: CalendarTimezoneContext,
): ContractResult<CalendarTime> {
  try {
    const instant = Temporal.Instant.fromEpochMilliseconds(epoch);
    if (template.type === 'utc')
      return { ok: true, value: { type: 'utc', value: instant.toString({ smallestUnit: 'second' }) } };
    if (template.type === 'zoned' && context?.definitions[template.tzid]) {
      const defined = definedLocalFromEpoch(context, template.tzid, epoch);
      if (!defined.ok) return defined;
      const roundtrip = resolveDefinedLocal(context, template.tzid, defined.value);
      if (!roundtrip.ok) return roundtrip;
      return {
        ok: true,
        value:
          roundtrip.value.epoch === epoch
            ? { ...template, value: defined.value }
            : { type: 'utc', value: instant.toString({ smallestUnit: 'second' }) },
      };
    }
    const zoned = instant.toZonedDateTimeISO(template.type === 'zoned' ? template.tzid : viewTimeZone);
    if (template.type === 'date') return { ok: true, value: { type: 'date', value: zoned.toPlainDate().toString() } };
    const local = zoned.toPlainDateTime().toString({ smallestUnit: 'second' });
    const value: CalendarTime =
      template.type === 'zoned' ? { ...template, value: local } : { type: 'floating', value: local };
    const roundtrip = calendarTimeToEpoch(value, viewTimeZone);
    return {
      ok: true,
      value:
        template.type === 'zoned' && roundtrip.ok && roundtrip.value !== epoch
          ? { type: 'utc', value: instant.toString({ smallestUnit: 'second' }) }
          : value,
    };
  } catch {
    return { ok: false, issues: ['The instant cannot be converted to the requested calendar mode.'] };
  }
}
