import { Temporal } from '@js-temporal/polyfill';
import ICAL from 'ical.js';
import type { ContractResult } from './types';

type Transition = { epoch: number; before: number; after: number };
type Timeline = { transitions: Transition[]; offsets: number[]; throughYear: number };

/** A call-local cache: definitions never enter ICAL's process-global timezone registry. */
export type CalendarTimezoneContext = {
  definitions: Readonly<Record<string, string>>;
  timelines: Map<string, ContractResult<Timeline>>;
};

export function createTimezoneContext(definitions: Readonly<Record<string, string>> = {}): CalendarTimezoneContext {
  return { definitions, timelines: new Map() };
}

function localEpoch(text: string): number | undefined {
  try {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text)) return;
    const date = Temporal.PlainDateTime.from(text);
    if (date.toString({ smallestUnit: 'second' }) !== text) return;
    return date.toZonedDateTime('UTC').epochMilliseconds;
  } catch {
    return;
  }
}

function offsetSeconds(text: unknown): number | undefined {
  if (typeof text !== 'string') return;
  const match = /^([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!match || +match[2] > 23 || +match[3] > 59 || +(match[4] ?? 0) > 59 || /^-00:00(?::00)?$/.test(text)) return;
  return (match[1] === '-' ? -1 : 1) * (+match[2] * 3600 + +match[3] * 60 + +(match[4] ?? 0));
}

function scalar(value: unknown): unknown {
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
}

/** Deliberately excludes rules whose next() can perform unbounded empty-period searches. */
function supportedObservanceRule(raw: Record<string, unknown>, start: string): boolean {
  if (
    raw.freq !== 'YEARLY' ||
    Object.keys(raw).some(
      (key) => !['freq', 'interval', 'count', 'until', 'bymonth', 'bymonthday', 'byday', 'wkst'].includes(key),
    )
  )
    return false;
  if (raw.count !== undefined && (!Number.isInteger(raw.count) || Number(raw.count) < 1 || Number(raw.count) > 10000))
    return false;
  if (
    raw.interval !== undefined &&
    (!Number.isInteger(raw.interval) || Number(raw.interval) < 1 || Number(raw.interval) > 10000)
  )
    return false;
  if (raw.count !== undefined && raw.until !== undefined) return false;
  const month = scalar(raw.bymonth) ?? +start.slice(5, 7);
  if (!Number.isInteger(month) || Number(month) < 1 || Number(month) > 12) return false;
  if (raw.byday !== undefined) {
    return (
      raw.bymonthday === undefined &&
      typeof scalar(raw.byday) === 'string' &&
      /^-?[1-4](MO|TU|WE|TH|FR|SA|SU)$/.test(String(scalar(raw.byday)))
    );
  }
  const day = scalar(raw.bymonthday) ?? +start.slice(8, 10);
  // February 29 is productive at least once each Gregorian cycle; no impossible month/day pairs.
  const maximum = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(month) - 1];
  return Number.isInteger(day) && Number(day) !== 0 && Math.abs(Number(day)) <= maximum;
}

function buildTimeline(definition: string, tzid: string, requestedYear: number): ContractResult<Timeline> {
  const failure = (message: string): ContractResult<Timeline> => ({ ok: false, issues: [message] });
  if (new TextEncoder().encode(definition).length > 65536 || requestedYear < 1 || requestedYear > 9997)
    return failure('Timezone definition or year exceeds the supported limits.');
  const throughYear = requestedYear + 2;
  const transitions: Transition[] = [];
  let work = 0;
  let depth = 0;
  for (const line of definition.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) {
    if (/^BEGIN:/i.test(line) && ++depth > 2) return failure('Nested timezone components are unsupported.');
    if (/^END:/i.test(line)) depth--;
    if (depth < 0) return failure('Timezone components are unbalanced.');
  }
  if (depth !== 0) return failure('Timezone components are unbalanced.');
  try {
    const component = new ICAL.Component(ICAL.parse(definition));
    if (
      component.name !== 'vtimezone' ||
      component.getAllProperties('tzid').length !== 1 ||
      component.getFirstPropertyValue('tzid') !== tzid
    )
      return failure('Timezone definition does not match its identifier.');
    const children = component.getAllSubcomponents();
    if (!children.length || children.length > 64) return failure('Timezone observance limits exceeded.');
    for (const child of children) {
      if (!['standard', 'daylight'].includes(child.name) || child.getAllSubcomponents().length)
        return failure('Unsupported timezone observance.');
      if (
        ['dtstart', 'tzoffsetfrom', 'tzoffsetto'].some((name) => child.getAllProperties(name).length !== 1) ||
        child.getAllProperties('rrule').length > 1 ||
        child.hasProperty('exdate') ||
        child.hasProperty('exrule')
      )
        return failure('Timezone observance properties are invalid or unsupported.');
      const startProperty = child.getFirstProperty('dtstart')!;
      const rawStart = startProperty.toJSON();
      const start = rawStart[3];
      if (
        rawStart[2] !== 'date-time' ||
        startProperty.getFirstParameter('tzid') ||
        typeof start !== 'string' ||
        localEpoch(start) === undefined
      )
        return failure('Timezone DTSTART must be a valid floating local date-time.');
      const before = offsetSeconds(child.getFirstProperty('tzoffsetfrom')!.toJSON()[3]);
      const after = offsetSeconds(child.getFirstProperty('tzoffsetto')!.toJSON()[3]);
      if (before === undefined || after === undefined) return failure('Timezone offsets are invalid.');
      const add = (local: string): boolean => {
        if (++work > 20000) return false;
        const epoch = localEpoch(local);
        if (epoch === undefined) return false;
        transitions.push({ epoch: epoch - before * 1000, before, after });
        return true;
      };
      // DTSTART belongs to the observance set even when RDATE or RRULE are present.
      if (!add(start)) return failure('Timezone transition limits exceeded.');
      for (const property of child.getAllProperties('rdate')) {
        const raw = property.toJSON();
        if (raw[2] !== 'date-time' || property.getFirstParameter('tzid'))
          return failure('Timezone RDATE must contain local date-times.');
        for (const value of raw.slice(3))
          if (typeof value !== 'string' || !add(value))
            return failure('Timezone RDATE or transition limits are invalid.');
      }
      const property = child.getFirstProperty('rrule');
      if (property) {
        const raw = property.toJSON()[3] as Record<string, unknown>;
        if (!supportedObservanceRule(raw, start))
          return failure(
            'Timezone recurrence profile is unsupported; use finite RDATE transitions or yearly single-month rules.',
          );
        let until: number | undefined;
        if (raw.until !== undefined) {
          if (
            typeof raw.until !== 'string' ||
            !raw.until.endsWith('Z') ||
            localEpoch(raw.until.slice(0, -1)) === undefined
          )
            return failure('Timezone RRULE UNTIL must be a valid UTC date-time.');
          until = Temporal.Instant.from(raw.until).epochMilliseconds;
        }
        const rule = ICAL.Recur.fromString(String(property.getFirstValue()));
        const count = rule.count;
        rule.count = null;
        rule.until = null;
        const iterator = rule.iterator(ICAL.Time.fromString(start, undefined));
        let generated = 0;
        let previous = '';
        while (true) {
          if (++work > 20000) return failure('Timezone transition work limit reached.');
          const next = iterator.next();
          if (!next || next.year > throughYear || (count && generated >= count)) break;
          const text = next.toString();
          if (text <= previous) return failure('Timezone recurrence did not advance.');
          previous = text;
          const epoch = localEpoch(text);
          if (epoch === undefined) return failure('Timezone recurrence generated an invalid date.');
          if (until !== undefined && epoch - before * 1000 > until) break;
          generated++;
          if (!add(text)) return failure('Timezone transition work limit reached.');
        }
      }
    }
    transitions.sort((a, b) => a.epoch - b.epoch);
    const unique: Transition[] = [];
    for (const transition of transitions) {
      const prior = unique[unique.length - 1];
      if (prior?.epoch === transition.epoch) {
        if (prior.before !== transition.before || prior.after !== transition.after)
          return failure('Timezone transitions conflict at the same instant.');
      } else unique.push(transition);
    }
    return {
      ok: true,
      value: {
        transitions: unique,
        offsets: [...new Set(unique.flatMap((transition) => [transition.before, transition.after]))],
        throughYear,
      },
    };
  } catch {
    return failure('Timezone definition cannot be evaluated safely.');
  }
}

function timeline(context: CalendarTimezoneContext, tzid: string, year: number): ContractResult<Timeline> {
  const cached = context.timelines.get(tzid);
  if (cached && (!cached.ok || cached.value.throughYear >= year)) return cached;
  const definition = context.definitions[tzid];
  if (!definition) return { ok: false, issues: ['Timezone definition is missing.'] };
  const result = buildTimeline(definition, tzid, year);
  context.timelines.set(tzid, result);
  return result;
}

function offsetAt(value: Timeline, epoch: number): number {
  let low = 0;
  let high = value.transitions.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (value.transitions[mid].epoch <= epoch) low = mid + 1;
    else high = mid;
  }
  return low ? value.transitions[low - 1].after : value.transitions[0].before;
}

export function resolveDefinedLocal(
  context: CalendarTimezoneContext,
  tzid: string,
  local: string,
  mode: 'import' | 'authoring' = 'import',
): ContractResult<{ epoch: number; gap: boolean; fold: boolean }> {
  const naive = localEpoch(local);
  if (naive === undefined) return { ok: false, issues: ['Invalid local calendar time.'] };
  const result = timeline(context, tzid, +local.slice(0, 4));
  if (!result.ok) return result;
  const candidates = result.value.offsets
    .map((offset) => naive - offset * 1000)
    .filter((epoch) => epoch + offsetAt(result.value, epoch) * 1000 === naive)
    .sort((a, b) => a - b);
  if (candidates.length === 1 || (candidates.length > 1 && mode === 'import'))
    return { ok: true, value: { epoch: candidates[0], gap: false, fold: candidates.length > 1 } };
  if (mode === 'import' && !candidates.length) {
    const gap = result.value.transitions.find(
      (transition) =>
        transition.after > transition.before &&
        naive >= transition.epoch + transition.before * 1000 &&
        naive < transition.epoch + transition.after * 1000,
    );
    if (gap) return { ok: true, value: { epoch: naive - gap.before * 1000, gap: true, fold: false } };
  }
  return {
    ok: false,
    issues: ['This local time is ambiguous, nonexistent, or cannot be resolved from its timezone definition.'],
  };
}

export function definedLocalFromEpoch(
  context: CalendarTimezoneContext,
  tzid: string,
  epoch: number,
): ContractResult<string> {
  try {
    const instant = Temporal.Instant.fromEpochMilliseconds(epoch);
    const result = timeline(context, tzid, instant.toZonedDateTimeISO('UTC').year);
    if (!result.ok) return result;
    return {
      ok: true,
      value: instant
        .add({ seconds: offsetAt(result.value, epoch) })
        .toString({ smallestUnit: 'second' })
        .replace(/Z$/, ''),
    };
  } catch {
    return { ok: false, issues: ['Calendar instant is outside the supported timezone range.'] };
  }
}
