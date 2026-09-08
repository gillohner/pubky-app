import { Temporal } from '@js-temporal/polyfill';
import ICAL from 'ical.js';
import { supportedRecurrenceProfile } from './rules';
import { eventContentSchema } from './schema';
import {
  addCalendarDuration,
  calendarTimeToEpoch,
  epochToCalendarTime,
  isGeneratedGap,
  isSupportedTimeZone,
  occurrenceKey,
} from './temporal';
import type { CalendarTimezoneContext } from './timezone';
import { createTimezoneContext } from './timezone';
import type { CalendarTime, ContractResult, EventContent, EventOccurrencePatch, RecurrencePeriod } from './types';

export const CALENDAR_ENGINE_VERSION = 'eventky-1.1/ical.js@2.2.1/temporal@0.5.1/vtimezone-1';
export type EventOccurrence = {
  recurrence_id: CalendarTime;
  key: string;
  start: CalendarTime;
  end: CalendarTime;
  start_epoch_ms: number;
  end_epoch_ms: number;
  event: EventContent;
};
export type OccurrenceQuery = {
  from: string;
  to: string;
  timezone: string;
  maxOccurrences?: number;
  maxIterations?: number;
  /** Caller can cancel between engine steps; workers should also have a hard termination deadline. */
  signal?: AbortSignal;
};
export type OccurrenceResult = {
  status: 'complete' | 'incomplete' | 'unsupported' | 'invalid';
  occurrences: EventOccurrence[];
  issues: string[];
  iterations: number;
  engine_version: string;
};

/** Explicit patches never mutate the series or its original instance identity. */
export function applyOccurrencePatch(series: EventContent, patch: EventOccurrencePatch): EventContent {
  const event = { ...series };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete (event as unknown as Record<string, unknown>)[key];
    else if (value !== undefined) (event as unknown as Record<string, unknown>)[key] = value;
  }
  if (patch.dtend) delete event.duration;
  if (patch.duration) delete event.dtend;
  return event;
}

function occurrenceEnd(
  series: EventContent,
  start: CalendarTime,
  viewZone: string,
  context: CalendarTimezoneContext,
): ContractResult<CalendarTime> {
  if (series.duration) return addCalendarDuration(start, series.duration, viewZone, context);
  if (!series.dtend)
    return start.type === 'date' ? addCalendarDuration(start, 'P1D', viewZone, context) : { ok: true, value: start };
  if (start.type === 'date' && series.dtstart.type === 'date' && series.dtend.type === 'date') {
    const days = Temporal.PlainDate.from(series.dtstart.value).until(Temporal.PlainDate.from(series.dtend.value)).days;
    return addCalendarDuration(start, `P${days}D`, viewZone, context);
  }
  if (start.type === 'floating' && series.dtstart.type === 'floating' && series.dtend.type === 'floating') {
    const duration = Temporal.PlainDateTime.from(series.dtstart.value).until(
      Temporal.PlainDateTime.from(series.dtend.value),
    );
    return addCalendarDuration(start, duration.toString(), viewZone, context);
  }
  const originalStart = calendarTimeToEpoch(series.dtstart, viewZone, 'import', context);
  const originalEnd = calendarTimeToEpoch(series.dtend, viewZone, 'import', context);
  const effectiveStart = calendarTimeToEpoch(start, viewZone, 'import', context);
  if (!originalStart.ok) return originalStart;
  if (!originalEnd.ok) return originalEnd;
  if (!effectiveStart.ok) return effectiveStart;
  return epochToCalendarTime(
    effectiveStart.value + originalEnd.value - originalStart.value,
    series.dtend,
    viewZone,
    context,
  );
}

function fromEngineTime(value: ICAL.Time, template: CalendarTime): CalendarTime {
  const text = value.toString();
  return template.type === 'zoned'
    ? { ...template, value: text.replace(/Z$/, '') }
    : template.type === 'utc'
      ? { type: 'utc', value: `${text.replace(/Z$/, '')}Z` }
      : { ...template, value: text };
}

/** Resolve one known series identity for rendering or exception export; does not assert RRULE membership. */
export function resolveOccurrenceEvent(
  series: EventContent,
  identity: CalendarTime,
  viewZone: string,
  context = createTimezoneContext(series.timezone_definitions),
): ContractResult<{ event: EventContent; start: CalendarTime; end: CalendarTime }> {
  try {
    const base: EventContent = { ...series, dtstart: identity };
    if (series.dtend) {
      const inherited = occurrenceEnd(series, identity, viewZone, context);
      if (!inherited.ok) return inherited;
      base.dtend = inherited.value;
    }
    const period = series.rdate?.find(
      (value): value is RecurrencePeriod =>
        value.type === 'period' && occurrenceKey(value.start) === occurrenceKey(identity),
    );
    if (period?.end) {
      base.dtend = period.end;
      delete base.duration;
    }
    if (period?.duration) {
      base.duration = period.duration;
      delete base.dtend;
    }
    const patch = series.overrides?.find(
      (override) => occurrenceKey(override.recurrence_id) === occurrenceKey(identity),
    )?.changes;
    const effective = patch ? applyOccurrencePatch(base, patch) : base;
    const basis = { ...effective, dtstart: patch?.dtend ? effective.dtstart : base.dtstart };
    const end = occurrenceEnd(basis, effective.dtstart, viewZone, context);
    if (!end.ok) return end;
    if (effective.dtend) effective.dtend = end.value;
    return { ok: true, value: { event: effective, start: effective.dtstart, end: end.value } };
  } catch {
    return { ok: false, issues: ['The occurrence cannot be resolved.'] };
  }
}

/**
 * Bounded schedule expansion. Incomplete results must not be presented as a complete calendar.
 * Supported authoring frequencies are DAILY/WEEKLY/MONTHLY/YEARLY; subdaily rules and
 * uncommon observance rules remain explicit unsupported results, retaining source data.
 */
export function expandOccurrences(event: EventContent, query: OccurrenceQuery): OccurrenceResult {
  const result: OccurrenceResult = {
    status: 'complete',
    occurrences: [],
    issues: [],
    iterations: 0,
    engine_version: CALENDAR_ENGINE_VERSION,
  };
  const fail = (status: OccurrenceResult['status'], message: string) => ({
    ...result,
    status,
    issues: [...result.issues, message],
  });
  try {
    const validated = eventContentSchema.safeParse(event);
    if (!validated.success) return fail('invalid', validated.error.issues.map((issue) => issue.message).join(' '));
    event = validated.data;
    const from = Temporal.Instant.from(query.from).epochMilliseconds;
    const to = Temporal.Instant.from(query.to).epochMilliseconds;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > 93 * 86_400_000)
      return fail('invalid', 'Select a positive range of at most 93 days.');
    if (!isSupportedTimeZone(query.timezone)) return fail('invalid', 'Select a supported viewing timezone.');
    const maxItems = query.maxOccurrences ?? 500;
    const maxIterations = query.maxIterations ?? 5000;
    if (
      !Number.isInteger(maxItems) ||
      maxItems < 1 ||
      maxItems > 5000 ||
      !Number.isInteger(maxIterations) ||
      maxIterations < 1 ||
      maxIterations > 100_000
    )
      return fail('invalid', 'Invalid occurrence or iteration limit.');
    const context = createTimezoneContext(event.timezone_definitions);
    if (event.rrule) {
      const profile = supportedRecurrenceProfile(event.rrule);
      if (!profile.ok) return fail('unsupported', profile.issues.join(' '));
    }

    const seen = new Set<string>();
    const excluded = new Set((event.exdate ?? []).map(occurrenceKey));
    let candidateError: string | undefined;

    const add = (identity: CalendarTime) => {
      const key = occurrenceKey(identity);
      if (seen.has(key)) return;
      seen.add(key);
      if (excluded.has(key)) return;
      const resolved = resolveOccurrenceEvent(event, identity, query.timezone, context);
      if (!resolved.ok) {
        candidateError = resolved.issues.join(' ');
        return;
      }
      const { event: effective, start, end } = resolved.value;
      const startEpoch = calendarTimeToEpoch(start, query.timezone, 'import', context);
      const endEpoch = calendarTimeToEpoch(end, query.timezone, 'import', context);
      if (!startEpoch.ok || !endEpoch.ok) {
        candidateError = 'An occurrence timezone cannot be resolved.';
        return;
      }
      if (endEpoch.value < startEpoch.value) {
        candidateError = 'An occurrence ends before it starts.';
        return;
      }
      const overlaps =
        startEpoch.value === endEpoch.value
          ? startEpoch.value >= from && startEpoch.value < to
          : startEpoch.value < to && endEpoch.value > from;
      if (overlaps)
        result.occurrences.push({
          recurrence_id: identity,
          key,
          start,
          end,
          start_epoch_ms: startEpoch.value,
          end_epoch_ms: endEpoch.value,
          event: effective,
        });
    };

    add(event.dtstart);
    for (const value of event.rdate ?? []) add(value.type === 'period' ? value.start : value);

    if (event.rrule) {
      const rule = ICAL.Recur.fromString(event.rrule);
      if (['DAILY', 'WEEKLY'].includes(rule.freq)) {
        const byday = /(?:^|;)BYDAY=([^;]+)/.exec(event.rrule)?.[1].split(',');
        const weekday = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'][
          Temporal.PlainDate.from(event.dtstart.value.slice(0, 10)).dayOfWeek - 1
        ];
        if (byday && !byday.includes(weekday))
          return fail('unsupported', 'The series start does not match its recurrence weekdays.');
      }
      const until = rule.until;
      const count = rule.count;
      rule.count = null;
      rule.until = null;
      const iterator = rule.iterator(ICAL.Time.fromString(event.dtstart.value, undefined));
      let validCandidates = 0;
      let scanUntil = to;
      for (const override of event.overrides ?? []) {
        const epoch = calendarTimeToEpoch(override.recurrence_id, query.timezone, 'import', context);
        if (epoch.ok) scanUntil = Math.max(scanUntil, epoch.value + 1);
      }
      let previous = '';
      while (true) {
        if (query.signal?.aborted) {
          result.status = 'incomplete';
          result.issues.push('Expansion was cancelled.');
          break;
        }
        if (++result.iterations > maxIterations) {
          result.status = 'incomplete';
          result.issues.push('Recurrence work limit reached.');
          break;
        }
        const next = iterator.next();
        if (!next) break;
        const identity = fromEngineTime(next, event.dtstart);
        const key = occurrenceKey(identity);
        if (validCandidates === 0 && key !== occurrenceKey(event.dtstart))
          return fail('unsupported', 'The series start does not match its recurrence rule.');
        if (key === previous) {
          result.status = 'incomplete';
          result.issues.push('The recurrence engine made no progress.');
          break;
        }
        previous = key;
        const epoch = calendarTimeToEpoch(identity, query.timezone, 'import', context);
        if (!epoch.ok) return fail('unsupported', epoch.issues.join(' '));
        if (until) {
          const text = until.toString();
          const untilTime: CalendarTime = text.endsWith('Z')
            ? { type: 'utc', value: text }
            : { ...event.dtstart, value: text };
          const untilEpoch = calendarTimeToEpoch(untilTime, query.timezone, 'import', context);
          if (!untilEpoch.ok) return fail('invalid', 'The recurrence end is invalid.');
          if (epoch.value > untilEpoch.value) break;
        }
        if (epoch.value >= scanUntil) break;
        if (isGeneratedGap(identity, context) && key !== occurrenceKey(event.dtstart)) continue;
        if (count && validCandidates >= count) break;
        validCandidates++;
        add(identity);
      }
    }
    if (candidateError) return fail('unsupported', candidateError);
    result.occurrences.sort((a, b) => a.start_epoch_ms - b.start_epoch_ms || a.key.localeCompare(b.key));
    if (result.occurrences.length > maxItems) {
      result.occurrences = result.occurrences.slice(0, maxItems);
      result.status = 'incomplete';
      result.issues.push('Occurrence result limit reached.');
    }
    return result;
  } catch {
    return fail('invalid', 'The schedule or query cannot be expanded safely.');
  }
}
