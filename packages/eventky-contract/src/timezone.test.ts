import { describe, expect, it } from 'vitest';
import { EVENT_FIXTURE } from './fixtures';
import { exportEventIcs, importCalendarIcs } from './ical';
import { expandOccurrences } from './recurrence';
import { addCalendarDuration, calendarTimeToEpoch } from './temporal';
import { createTimezoneContext, definedLocalFromEpoch, resolveDefinedLocal } from './timezone';
import type { CalendarTime, EventContent } from './types';

const zone = 'Custom/Builders';
const definition = [
  'BEGIN:VTIMEZONE',
  `TZID:${zone}`,
  'BEGIN:DAYLIGHT',
  'DTSTART:19700329T020000',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'DTSTART:19701025T030000',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
  '',
].join('\r\n');
const definitions = { [zone]: definition };
const local = (value: string): CalendarTime => ({ type: 'zoned', tzid: zone, value });
const fixture = (patch: Partial<EventContent> = {}): EventContent => ({
  ...EVENT_FIXTURE,
  dtstart: local('2026-10-01T18:00:00'),
  timezone_definitions: definitions,
  ...patch,
});
const query = { from: '2026-10-01T00:00:00Z', to: '2026-11-10T00:00:00Z', timezone: 'Europe/Zurich' };

describe('event-scoped VTIMEZONE evaluation', () => {
  it('evaluates custom recurring transitions with no global registration', () => {
    const result = expandOccurrences(fixture(), query);
    expect(result.status).toBe('complete');
    expect(result.occurrences.map((value) => new Date(value.start_epoch_ms).toISOString())).toEqual([
      '2026-10-01T16:00:00.000Z',
      '2026-10-08T16:00:00.000Z',
      '2026-10-15T16:00:00.000Z',
      '2026-10-22T16:00:00.000Z',
      '2026-10-29T17:00:00.000Z',
      '2026-11-05T17:00:00.000Z',
    ]);
    expect(calendarTimeToEpoch(local('2026-10-01T18:00:00'), 'UTC').ok).toBe(false);
  });

  it('chooses the first repeated hour and pre-gap offset for explicit imported local times', () => {
    const context = createTimezoneContext(definitions);
    expect(resolveDefinedLocal(context, zone, '2026-10-25T02:30:00')).toEqual({
      ok: true,
      value: { epoch: Date.parse('2026-10-25T00:30:00Z'), gap: false, fold: true },
    });
    expect(resolveDefinedLocal(context, zone, '2026-03-29T02:30:00')).toEqual({
      ok: true,
      value: { epoch: Date.parse('2026-03-29T01:30:00Z'), gap: true, fold: false },
    });
    expect(resolveDefinedLocal(context, zone, '2026-10-25T02:30:00', 'authoring').ok).toBe(false);
    expect(resolveDefinedLocal(context, zone, '2026-03-29T02:30:00', 'authoring').ok).toBe(false);
    expect(definedLocalFromEpoch(context, zone, Date.parse('2026-10-25T01:30:00Z'))).toEqual({
      ok: true,
      value: '2026-10-25T02:30:00',
    });
  });

  it('skips generated gaps without consuming COUNT and preserves an explicit gap RDATE', () => {
    const event = fixture({
      dtstart: local('2026-03-28T02:30:00'),
      rrule: 'FREQ=DAILY;COUNT=3',
      rdate: [local('2026-03-29T02:30:00')],
    });
    const result = expandOccurrences(event, { ...query, from: '2026-03-28T00:00:00Z', to: '2026-04-03T00:00:00Z' });
    expect(result.status).toBe('complete');
    expect(result.occurrences.map((value) => value.recurrence_id.value)).toEqual([
      '2026-03-28T02:30:00',
      '2026-03-29T02:30:00',
      '2026-03-30T02:30:00',
      '2026-03-31T02:30:00',
    ]);
  });

  it('distinguishes nominal days from exact hours across a custom timezone transition', () => {
    const context = createTimezoneContext(definitions);
    expect(addCalendarDuration(local('2026-03-28T12:00:00'), 'P1D', 'UTC', context)).toEqual({
      ok: true,
      value: local('2026-03-29T12:00:00'),
    });
    expect(addCalendarDuration(local('2026-03-28T12:00:00'), 'PT24H', 'UTC', context)).toEqual({
      ok: true,
      value: local('2026-03-29T13:00:00'),
    });
    const event = fixture({
      dtstart: local('2026-03-28T12:00:00'),
      duration: undefined,
      dtend: local('2026-03-29T12:00:00'),
      rrule: 'FREQ=DAILY;COUNT=2',
    });
    const result = expandOccurrences(event, { ...query, from: '2026-03-28T00:00:00Z', to: '2026-04-01T00:00:00Z' });
    expect(result.occurrences.map((value) => (value.end_epoch_ms - value.start_epoch_ms) / 3600000)).toEqual([23, 23]);
  });

  it('keeps exact durations when the end falls in the second repeated hour', () => {
    for (const custom of [true, false]) {
      const start: CalendarTime = {
        type: 'zoned',
        tzid: custom ? zone : 'Europe/Zurich',
        value: '2026-10-25T01:30:00',
      };
      const event = fixture({
        dtstart: start,
        duration: 'PT2H',
        rrule: undefined,
        timezone_definitions: custom ? definitions : undefined,
      });
      const result = expandOccurrences(event, query);
      expect(result.status).toBe('complete');
      expect(result.occurrences[0].end).toEqual({ type: 'utc', value: '2026-10-25T01:30:00Z' });
      expect(result.occurrences[0].end_epoch_ms - result.occurrences[0].start_epoch_ms).toBe(7200000);
    }
  });

  it('retains second-resolution historical offsets and earliest pre-transition offset', () => {
    const fixed = definition
      .replace(/BEGIN:DAYLIGHT[\s\S]*END:DAYLIGHT\r\n/, '')
      .replace('DTSTART:19701025T030000', 'DTSTART:19700101T000000')
      .replace('TZOFFSETFROM:+0200', 'TZOFFSETFROM:+054530')
      .replace('TZOFFSETTO:+0100', 'TZOFFSETTO:+054530')
      .replace('RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU\r\n', '');
    const context = createTimezoneContext({ [zone]: fixed });
    expect(resolveDefinedLocal(context, zone, '1960-01-01T12:00:00')).toMatchObject({
      ok: true,
      value: { epoch: Date.parse('1960-01-01T06:14:30Z') },
    });
  });

  it('uses all RDATE values and respects inclusive UTC UNTIL on observances', () => {
    const finite = definition
      .replace('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'RDATE:20260329T020000,20270328T020000')
      .replace(
        'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
        'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU;UNTIL=20261025T010000Z',
      );
    const context = createTimezoneContext({ [zone]: finite });
    expect(resolveDefinedLocal(context, zone, '2026-10-26T12:00:00')).toMatchObject({
      ok: true,
      value: { epoch: Date.parse('2026-10-26T11:00:00Z') },
    });
    expect(resolveDefinedLocal(context, zone, '2027-03-29T12:00:00')).toMatchObject({
      ok: true,
      value: { epoch: Date.parse('2027-03-29T10:00:00Z') },
    });
    expect(resolveDefinedLocal(context, zone, '2027-11-01T12:00:00')).toMatchObject({
      ok: true,
      value: { epoch: Date.parse('2027-11-01T10:00:00Z') },
    });
  });

  it('treats a supplied definition as authoritative even when TZID names an IANA zone', () => {
    const source = definition
      .split(zone)
      .join('Europe/Zurich')
      .split('+0100')
      .join('+0300')
      .split('+0200')
      .join('+0400');
    const result = expandOccurrences({ ...EVENT_FIXTURE, timezone_definitions: { 'Europe/Zurich': source } }, query);
    expect(result.status).toBe('complete');
    expect(result.occurrences[0].start_epoch_ms).toBe(Date.parse('2026-10-01T14:00:00Z'));
  });

  it('preserves custom definitions across ICS export/import including moved exceptions', () => {
    const event = fixture({
      overrides: [{ recurrence_id: local('2026-10-08T18:00:00'), changes: { dtstart: local('2026-10-09T19:00:00') } }],
    });
    const output = exportEventIcs(event);
    expect(output.ok).toBe(true);
    if (!output.ok) return;
    const imported = importCalendarIcs(output.value, { now: EVENT_FIXTURE.dtstamp }).entries[0];
    expect(imported.errors).toEqual([]);
    expect(expandOccurrences(imported.event!, query).occurrences.map((value) => value.start_epoch_ms)).toEqual(
      expandOccurrences(event, query).occurrences.map((value) => value.start_epoch_ms),
    );
  });

  it('returns explicit unsupported results for unproductive or explosive observance rules', () => {
    for (const rule of [
      'FREQ=SECONDLY',
      'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=31',
      'FREQ=YEARLY;BYMONTH=3;BYDAY=SU;BYSETPOS=-1',
    ]) {
      const result = expandOccurrences(
        fixture({ timezone_definitions: { [zone]: definition.replace('FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', rule) } }),
        query,
      );
      expect(result.status).toBe('unsupported');
      expect(result.occurrences).toEqual([]);
    }
  });
});
