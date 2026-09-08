import { describe, expect, it } from 'vitest';
import { EVENT_FIXTURE } from './fixtures';
import { expandOccurrences } from './recurrence';
import { addCalendarDuration, calendarTimeToEpoch, isGeneratedGap, occurrenceKey } from './temporal';
import type { DateTimeValue, EventContent } from './types';

const query = { from: '2026-10-01T00:00:00Z', to: '2026-11-10T00:00:00Z', timezone: 'Europe/Zurich' };
const zoned = (value: string, tzid = 'Europe/Zurich'): DateTimeValue => ({ type: 'zoned', value, tzid });

describe('calendar time and bounded recurrence', () => {
  it('preserves weekly Zurich wall time across DST', () => {
    const result = expandOccurrences(EVENT_FIXTURE, query);
    expect(result.status).toBe('complete');
    expect(result.occurrences.map((event) => new Date(event.start_epoch_ms).toISOString())).toEqual([
      '2026-10-01T16:00:00.000Z',
      '2026-10-08T16:00:00.000Z',
      '2026-10-15T16:00:00.000Z',
      '2026-10-22T16:00:00.000Z',
      '2026-10-29T17:00:00.000Z',
      '2026-11-05T17:00:00.000Z',
    ]);
  });

  it('separates nominal days from elapsed hours across DST', () => {
    const start = zoned('2026-10-24T18:00:00');
    expect(addCalendarDuration(start, 'P1D', 'UTC')).toEqual({ ok: true, value: zoned('2026-10-25T18:00:00') });
    expect(addCalendarDuration(start, 'PT24H', 'UTC')).toEqual({ ok: true, value: zoned('2026-10-25T17:00:00') });
  });

  it('uses first-fold/pre-gap rules for imports and rejects ambiguous authoring input', () => {
    expect(calendarTimeToEpoch(zoned('2026-10-25T02:30:00'), 'UTC')).toEqual({
      ok: true,
      value: Date.parse('2026-10-25T00:30:00Z'),
    });
    expect(calendarTimeToEpoch(zoned('2026-03-29T02:30:00'), 'UTC')).toEqual({
      ok: true,
      value: Date.parse('2026-03-29T01:30:00Z'),
    });
    expect(calendarTimeToEpoch(zoned('2026-10-25T02:30:00'), 'UTC', 'authoring').ok).toBe(false);
    expect(isGeneratedGap(zoned('2026-03-29T02:30:00'))).toBe(true);
  });

  it('does not count a generated DST gap against COUNT', () => {
    const event: EventContent = {
      ...EVENT_FIXTURE,
      dtstart: zoned('2026-03-22T02:30:00'),
      rrule: 'FREQ=WEEKLY;COUNT=3',
    };
    const result = expandOccurrences(event, { ...query, from: '2026-03-01T00:00:00Z', to: '2026-04-15T00:00:00Z' });
    expect(result.status).toBe('complete');
    expect(result.occurrences.map((value) => value.start.value)).toEqual([
      '2026-03-22T02:30:00',
      '2026-04-05T02:30:00',
      '2026-04-12T02:30:00',
    ]);
  });

  it('handles a fractional-offset zone without the host timezone', () => {
    expect(calendarTimeToEpoch(zoned('2026-10-01T18:00:00', 'Asia/Kathmandu'), 'UTC')).toEqual({
      ok: true,
      value: Date.parse('2026-10-01T12:15:00Z'),
    });
  });

  it('counts candidates before exclusions and deduplicates RDATE', () => {
    const event: EventContent = {
      ...EVENT_FIXTURE,
      rrule: 'FREQ=WEEKLY;COUNT=4',
      exdate: [zoned('2026-10-08T18:00:00')],
      rdate: [EVENT_FIXTURE.dtstart, zoned('2026-10-22T18:00:00')],
    };
    const result = expandOccurrences(event, query);
    expect(result.occurrences.map((value) => value.start.value)).toEqual([
      '2026-10-01T18:00:00',
      '2026-10-15T18:00:00',
      '2026-10-22T18:00:00',
    ]);
  });

  it('omits invalid month days rather than clamping them', () => {
    const event: EventContent = {
      ...EVENT_FIXTURE,
      dtstart: zoned('2026-01-31T18:00:00'),
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=31;COUNT=3',
    };
    const result = expandOccurrences(event, { ...query, from: '2026-01-30T00:00:00Z', to: '2026-04-01T00:00:00Z' });
    expect(result.occurrences.map((value) => value.start.value)).toEqual([
      '2026-01-31T18:00:00',
      '2026-03-31T18:00:00',
    ]);
  });

  it('retains original identity and duration when an occurrence moves into the window', () => {
    const original = zoned('2026-10-29T18:00:00');
    const event: EventContent = {
      ...EVENT_FIXTURE,
      duration: undefined,
      dtend: zoned('2026-10-01T20:00:00'),
      overrides: [{ recurrence_id: original, changes: { dtstart: zoned('2026-10-03T14:00:00') } }],
    };
    const result = expandOccurrences(event, { ...query, from: '2026-10-03T00:00:00Z', to: '2026-10-04T00:00:00Z' });
    expect(result.status).toBe('complete');
    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0]).toMatchObject({
      recurrence_id: original,
      key: occurrenceKey(original),
      start: zoned('2026-10-03T14:00:00'),
      end: zoned('2026-10-03T16:00:00'),
    });
  });

  it('retains cancelled occurrences while excluded occurrences disappear', () => {
    const event: EventContent = {
      ...EVENT_FIXTURE,
      overrides: [{ recurrence_id: EVENT_FIXTURE.dtstart, changes: { status: 'CANCELLED' } }],
      exdate: [zoned('2026-10-08T18:00:00')],
    };
    const result = expandOccurrences(event, query);
    expect(result.occurrences).toHaveLength(5);
    expect(result.occurrences[0].event.status).toBe('CANCELLED');
  });

  it('includes long overlaps and excludes intervals ending at the lower bound', () => {
    const event: EventContent = {
      ...EVENT_FIXTURE,
      rrule: undefined,
      dtstart: { type: 'date', value: '2026-09-29' },
      duration: 'P4D',
    };
    expect(
      expandOccurrences(event, { ...query, from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' }).occurrences,
    ).toHaveLength(1);
    expect(
      expandOccurrences(event, { ...query, from: '2026-10-02T22:00:00Z', to: '2026-10-03T22:00:00Z' }).occurrences,
    ).toHaveLength(0);
  });

  it('defaults date-only events to a day and timed events to a point', () => {
    const date = expandOccurrences(
      { ...EVENT_FIXTURE, rrule: undefined, duration: undefined, dtstart: { type: 'date', value: '2026-10-01' } },
      query,
    );
    expect(date.occurrences[0].end.value).toBe('2026-10-02');
    const point = expandOccurrences({ ...EVENT_FIXTURE, rrule: undefined, duration: undefined }, query);
    expect(point.occurrences[0].start_epoch_ms).toBe(point.occurrences[0].end_epoch_ms);
  });

  it('preserves period-specific duration for additional dates', () => {
    const event: EventContent = {
      ...EVENT_FIXTURE,
      rrule: undefined,
      rdate: [{ type: 'period', start: zoned('2026-10-03T18:00:00'), duration: 'PT30M' }],
    };
    const result = expandOccurrences(event, query);
    expect(result.occurrences[1].end.value).toBe('2026-10-03T18:30:00');
  });

  it('returns explicit incomplete work/result limits and cancellation', () => {
    expect(expandOccurrences(EVENT_FIXTURE, { ...query, maxIterations: 2 }).status).toBe('incomplete');
    expect(expandOccurrences(EVENT_FIXTURE, { ...query, maxOccurrences: 1 }).status).toBe('incomplete');
    const controller = new AbortController();
    controller.abort();
    expect(expandOccurrences(EVENT_FIXTURE, { ...query, signal: controller.signal }).status).toBe('incomplete');
    expect(expandOccurrences(EVENT_FIXTURE, { ...query, to: '2027-10-01T00:00:00Z' }).status).toBe('invalid');
    expect(expandOccurrences({ ...EVENT_FIXTURE, rrule: 'FREQ=SECONDLY' }, query).status).toBe('unsupported');
  });

  it('uses UTC UNTIL inclusively for a zoned start', () => {
    const event = { ...EVENT_FIXTURE, rrule: 'FREQ=WEEKLY;UNTIL=20261015T160000Z' };
    expect(expandOccurrences(event, query).occurrences).toHaveLength(3);
  });

  it('does not enter an unbounded engine step for unsupported or contradictory daily rules', () => {
    expect(expandOccurrences({ ...EVENT_FIXTURE, rrule: 'FREQ=DAILY;BYMONTH=2;BYMONTHDAY=31' }, query).status).toBe(
      'unsupported',
    );
    expect(expandOccurrences({ ...EVENT_FIXTURE, rrule: 'FREQ=DAILY;INTERVAL=7;BYDAY=MO' }, query).status).toBe(
      'unsupported',
    );
  });

  it('expands the last weekday of a month using BYSETPOS', () => {
    const event: EventContent = {
      ...EVENT_FIXTURE,
      dtstart: zoned('2026-01-30T18:00:00'),
      rrule: 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
    };
    const result = expandOccurrences(event, { ...query, from: '2026-01-01T00:00:00Z', to: '2026-04-01T00:00:00Z' });
    expect(result.status).toBe('complete');
    expect(result.occurrences.map((value) => value.start.value)).toEqual([
      '2026-01-30T18:00:00',
      '2026-02-27T18:00:00',
      '2026-03-31T18:00:00',
    ]);
  });

  it('finds a leap-day anniversary whose series was created years earlier', () => {
    const event: EventContent = {
      ...EVENT_FIXTURE,
      dtstart: { type: 'date', value: '2020-02-29' },
      duration: 'P1D',
      rrule: 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29',
    };
    const result = expandOccurrences(event, { ...query, from: '2028-02-01T00:00:00Z', to: '2028-03-01T00:00:00Z' });
    expect(result.status).toBe('complete');
    expect(result.occurrences.map((value) => value.start.value)).toEqual(['2028-02-29']);
  });
});
