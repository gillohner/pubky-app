import ICAL from 'ical.js';
import { isValidCalendarTime } from './temporal';
import type { CalendarTime, ContractResult } from './types';

const FREQUENCIES = new Set(['SECONDLY', 'MINUTELY', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);
const PARTS = new Set([
  'FREQ',
  'INTERVAL',
  'COUNT',
  'UNTIL',
  'BYSECOND',
  'BYMINUTE',
  'BYHOUR',
  'BYDAY',
  'BYMONTHDAY',
  'BYYEARDAY',
  'BYWEEKNO',
  'BYMONTH',
  'BYSETPOS',
  'WKST',
]);
const DAY = /^(?:[+-]?[1-9]\d?)?(MO|TU|WE|TH|FR|SA|SU)$/;

export function validateRecurrenceRule(text: string, start?: CalendarTime): ContractResult<string> {
  if (!text || text.length > 2048 || /[\r\n]/.test(text)) return { ok: false, issues: ['Invalid recurrence rule.'] };
  const parts = new Map<string, string>();
  for (const entry of text.split(';')) {
    const pair = entry.split('=');
    if (pair.length !== 2 || !PARTS.has(pair[0]) || !pair[1] || parts.has(pair[0])) {
      return { ok: false, issues: ['Recurrence contains an unknown, duplicate, or empty rule part.'] };
    }
    parts.set(pair[0], pair[1]);
  }
  if (!FREQUENCIES.has(parts.get('FREQ') ?? '')) return { ok: false, issues: ['Select a valid recurrence frequency.'] };
  if (parts.has('COUNT') && parts.has('UNTIL'))
    return { ok: false, issues: ['Use a recurrence count or end date, not both.'] };
  for (const key of ['COUNT', 'INTERVAL']) {
    const value = parts.get(key);
    if (value && (!/^[1-9]\d*$/.test(value) || Number(value) > 1_000_000))
      return { ok: false, issues: [`Invalid ${key} value.`] };
  }
  const ranges: Record<string, [number, number, boolean]> = {
    BYSECOND: [0, 59, false],
    BYMINUTE: [0, 59, false],
    BYHOUR: [0, 23, false],
    BYMONTH: [1, 12, false],
    BYMONTHDAY: [-31, 31, true],
    BYYEARDAY: [-366, 366, true],
    BYWEEKNO: [-53, 53, true],
    BYSETPOS: [-366, 366, true],
  };
  for (const [key, [min, max, noZero]] of Object.entries(ranges)) {
    if (!parts.has(key)) continue;
    if (
      parts
        .get(key)!
        .split(',')
        .some((v) => !/^[+-]?\d+$/.test(v) || Number(v) < min || Number(v) > max || (noZero && Number(v) === 0))
    ) {
      return { ok: false, issues: [`Invalid ${key} value.`] };
    }
  }
  const days = parts.get('BYDAY');
  if (days?.split(',').some((day) => !DAY.test(day) || Math.abs(parseInt(day, 10) || 0) > 53)) {
    return { ok: false, issues: ['Invalid recurrence weekday.'] };
  }
  if (parts.has('WKST') && !/^(MO|TU|WE|TH|FR|SA|SU)$/.test(parts.get('WKST')!))
    return { ok: false, issues: ['Invalid week start.'] };
  const frequency = parts.get('FREQ');
  if (
    (parts.has('BYMONTHDAY') && frequency === 'WEEKLY') ||
    (parts.has('BYWEEKNO') && frequency !== 'YEARLY') ||
    (parts.has('BYYEARDAY') && ['DAILY', 'WEEKLY', 'MONTHLY'].includes(frequency!)) ||
    (days?.split(',').some((day) => /^[+-]?\d/.test(day)) &&
      (!['MONTHLY', 'YEARLY'].includes(frequency!) || parts.has('BYWEEKNO'))) ||
    (parts.has('BYSETPOS') && ![...parts.keys()].some((key) => key.startsWith('BY') && key !== 'BYSETPOS'))
  ) {
    return { ok: false, issues: ['This combination of recurrence rule parts is invalid.'] };
  }
  const until = parts.get('UNTIL');
  if (until && start) {
    const valid =
      start.type === 'date'
        ? /^\d{8}$/.test(until)
        : start.type === 'floating'
          ? /^\d{8}T\d{6}$/.test(until)
          : /^\d{8}T\d{6}Z$/.test(until);
    if (!valid) return { ok: false, issues: ['Recurrence end must use the correct date/time mode for the start.'] };
    const isoDate = `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`;
    const isoTime =
      until.length > 8
        ? `${isoDate}T${until.slice(9, 11)}:${until.slice(11, 13)}:${until.slice(13, 15)}${until.endsWith('Z') ? 'Z' : ''}`
        : isoDate;
    const untilValue: CalendarTime = until.endsWith('Z')
      ? { type: 'utc', value: isoTime }
      : until.length === 8
        ? { type: 'date', value: isoDate }
        : { type: 'floating', value: isoTime };
    if (!isValidCalendarTime(untilValue))
      return { ok: false, issues: ['Recurrence end is not a valid calendar date or time.'] };
  }
  if (start?.type === 'date' && ['BYSECOND', 'BYMINUTE', 'BYHOUR'].some((key) => parts.has(key))) {
    return { ok: false, issues: ['All-day recurrence cannot specify time-of-day parts.'] };
  }
  try {
    ICAL.Recur.fromString(text);
    return { ok: true, value: text };
  } catch {
    return { ok: false, issues: ['The recurrence rule cannot be parsed.'] };
  }
}

/** Restrict synchronous iteration to tested combinations whose engine steps can make progress. */
export function supportedRecurrenceProfile(text: string): ContractResult<string> {
  const parts = new Map(text.split(';').map((entry) => entry.split('=') as [string, string]));
  const frequency = parts.get('FREQ') ?? '';
  const allowed: Record<string, string[]> = {
    DAILY: ['BYDAY'],
    WEEKLY: ['BYDAY'],
    MONTHLY: ['BYDAY', 'BYMONTHDAY', 'BYSETPOS'],
    YEARLY: ['BYDAY', 'BYMONTHDAY', 'BYMONTH', 'BYSETPOS'],
  };
  if (
    !allowed[frequency] ||
    [...parts.keys()].some((key) => key.startsWith('BY') && !allowed[frequency].includes(key))
  ) {
    return {
      ok: false,
      issues: ['This recurrence combination is preserved but outside the tested expansion profile.'],
    };
  }
  return { ok: true, value: text };
}
