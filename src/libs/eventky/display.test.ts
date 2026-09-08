import { describe, expect, it } from 'vitest';
import { eventkyEventFixture } from '@/test/fixtures/eventky';
import { formatCalendarTime, formatEventRecurrence, formatEventSchedule } from './display';

describe('calendar display', () => {
  it('keeps source wall time and timezone across a daylight-saving transition', () => {
    expect(formatCalendarTime(eventkyEventFixture.dtstart)).toBe('Oct 25, 2026, 6:30 PM (Europe/Zurich)');
  });
  it('labels floating and UTC times explicitly', () => {
    expect(formatCalendarTime({ type: 'floating', value: '2026-09-08T18:00:00' })).toContain(
      '6:00 PM (Local time (floating))',
    );
    expect(formatCalendarTime({ type: 'utc', value: '2026-09-08T18:00:00Z' })).toContain('6:00 PM (UTC)');
  });
  it('shows a one-day date event only once, respecting its exclusive end', () => {
    expect(
      formatEventSchedule({
        ...eventkyEventFixture,
        dtstart: { type: 'date', value: '2026-09-08' },
        dtend: { type: 'date', value: '2026-09-09' },
      }),
    ).toBe('Sep 8, 2026 · All day');
  });
  it('shows the last occupied day of a multi-day date event', () => {
    expect(
      formatEventSchedule({
        ...eventkyEventFixture,
        dtstart: { type: 'date', value: '2026-09-08' },
        dtend: { type: 'date', value: '2026-09-11' },
      }),
    ).toBe('Sep 8, 2026 · All day – Sep 10, 2026 · All day');
  });
  it('summarizes recurrence without presenting RRULE syntax', () => {
    expect(formatEventRecurrence({ ...eventkyEventFixture, rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE' })).toBe(
      'Repeats every 2 weeks',
    );
    expect(formatEventRecurrence({ ...eventkyEventFixture, rrule: 'FREQ=MONTHLY;COUNT=10' })).toBe('Repeats monthly');
  });
});
