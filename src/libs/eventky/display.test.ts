import { describe, expect, it } from 'vitest';
import { eventkyEventFixture } from '@/test/fixtures/eventky';
import { formatAuthoringCalendarTime, formatCalendarTime, formatEventRecurrence, formatEventSchedule } from './display';

describe('device-local calendar display', () => {
  it('converts Zurich to New York across the dates where their DST transitions differ', () => {
    expect(formatCalendarTime(eventkyEventFixture.dtstart, { timeZone: 'America/New_York' })).toBe(
      'Oct 25, 2026, 1:30 PM EDT',
    );
    expect(
      formatCalendarTime(
        { type: 'zoned', tzid: 'Europe/Zurich', value: '2026-11-01T18:30:00' },
        { timeZone: 'America/New_York' },
      ),
    ).toBe('Nov 1, 2026, 12:30 PM EST');
  });
  it('converts early Zurich hours to the previous New York date', () => {
    expect(
      formatCalendarTime(
        { type: 'zoned', tzid: 'Europe/Zurich', value: '2026-03-29T00:30:00' },
        { timeZone: 'America/New_York' },
      ),
    ).toBe('Mar 28, 2026, 7:30 PM EDT');
  });
  it('converts New York to the next Zurich date and observes both DST offsets', () => {
    expect(
      formatCalendarTime(
        { type: 'zoned', tzid: 'America/New_York', value: '2026-03-28T23:30:00' },
        { timeZone: 'Europe/Zurich' },
      ),
    ).toBe('Mar 29, 2026, 5:30 AM GMT+2');
  });
  it('converts UTC instants, but leaves floating civil values unshifted', () => {
    expect(formatCalendarTime({ type: 'utc', value: '2026-09-08T02:00:00Z' }, { timeZone: 'America/New_York' })).toBe(
      'Sep 7, 2026, 10:00 PM EDT',
    );
    expect(
      formatCalendarTime({ type: 'floating', value: '2026-09-08T18:00:00' }, { timeZone: 'America/New_York' }),
    ).toBe('Sep 8, 2026, 6:00 PM');
  });
  it('keeps source wall time and zone available only for the authoring interface', () => {
    expect(formatAuthoringCalendarTime(eventkyEventFixture.dtstart)).toBe('Oct 25, 2026, 6:30 PM (Europe/Zurich)');
  });
  it('resolves custom VTIMEZONE through the engine rather than treating its wall time as UTC', () => {
    const definition = [
      'BEGIN:VTIMEZONE',
      'TZID:Custom/Office',
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      'TZOFFSETFROM:+0530',
      'TZOFFSETTO:+0530',
      'END:STANDARD',
      'END:VTIMEZONE',
      '',
    ].join('\r\n');
    expect(
      formatEventSchedule(
        {
          ...eventkyEventFixture,
          dtstart: { type: 'zoned', value: '2026-09-08T01:00:00', tzid: 'Custom/Office' },
          dtend: undefined,
          timezone_definitions: { 'Custom/Office': definition },
        },
        'America/New_York',
      ),
    ).toBe('Sep 7, 2026, 3:30 PM EDT');
  });
  it('fails closed for an unresolved custom timezone instead of showing a false instant', () => {
    expect(
      formatCalendarTime(
        { type: 'zoned', tzid: 'Custom/Missing', value: '2026-09-08T01:00:00' },
        { timeZone: 'America/New_York' },
      ),
    ).toBe('Time unavailable');
  });
  it.each(['America/New_York', 'Pacific/Auckland'])(
    'never shifts all-day dates in %s and respects exclusive DTEND',
    (timeZone) => {
      expect(
        formatEventSchedule(
          {
            ...eventkyEventFixture,
            dtstart: { type: 'date', value: '2026-09-08' },
            dtend: { type: 'date', value: '2026-09-09' },
          },
          timeZone,
        ),
      ).toBe('Sep 8, 2026 · All day');
      expect(
        formatEventSchedule(
          {
            ...eventkyEventFixture,
            dtstart: { type: 'date', value: '2026-09-08' },
            dtend: { type: 'date', value: '2026-09-11' },
          },
          timeZone,
        ),
      ).toBe('Sep 8, 2026 · All day – Sep 10, 2026 · All day');
    },
  );
  it('summarizes recurrence without presenting RRULE syntax', () => {
    expect(formatEventRecurrence({ ...eventkyEventFixture, rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE' })).toBe(
      'Repeats every 2 weeks',
    );
    expect(formatEventRecurrence({ ...eventkyEventFixture, rrule: 'FREQ=MONTHLY;COUNT=10' })).toBe('Repeats monthly');
  });
});
