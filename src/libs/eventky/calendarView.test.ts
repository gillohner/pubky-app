import { describe, expect, it } from 'vitest';
import { projectedOccurrenceFixture } from '@/test/fixtures/eventkyProjection';
import { getCalendarWindow, moveCalendarAnchor, occurrenceOverlapsDay } from './calendarView';

describe('calendar view boundaries', () => {
  it.each([
    ['2026-03-29', 23],
    ['2026-10-25', 25],
  ] as const)('uses local midnight on the %s DST transition', (anchor, hours) => {
    const window = getCalendarWindow(anchor, 'day', 'Europe/Zurich', 1);
    expect(window.days).toHaveLength(1);
    expect(Date.parse(window.to) - Date.parse(window.from)).toBe(hours * 60 * 60 * 1000);
    expect(window.days[0].date).toBe(anchor);
  });
  it('includes complete Monday weeks around a month, with an exclusive end', () => {
    const window = getCalendarWindow('2026-10-25', 'month', 'Europe/Zurich', 1);
    expect(window.days[0].date).toBe('2026-09-28');
    expect(window.days.at(-1)?.date).toBe('2026-11-01');
    expect(window.days).toHaveLength(35);
    expect(window.to).toBe('2026-11-01T23:00:00.000Z');
  });
  it('supports Sunday week starts and calendar-day agenda lengths across DST', () => {
    expect(getCalendarWindow('2026-10-27', 'week', 'UTC', 7).days[0].date).toBe('2026-10-25');
    const window = getCalendarWindow('2026-10-01', 'agenda', 'Europe/Zurich', 1);
    expect(window.days).toHaveLength(30);
    expect(Date.parse(window.to) - Date.parse(window.from)).toBe((30 * 24 + 1) * 60 * 60 * 1000);
  });
  it('does not place exclusive end-midnight on the following day and includes instantaneous events', () => {
    const day = getCalendarWindow('2026-10-25', 'day', 'UTC', 1).days[0];
    expect(
      occurrenceOverlapsDay(
        { ...projectedOccurrenceFixture, start_epoch_ms: day.start - 86400000, end_epoch_ms: day.start },
        day,
      ),
    ).toBe(false);
    expect(
      occurrenceOverlapsDay({ ...projectedOccurrenceFixture, start_epoch_ms: day.start, end_epoch_ms: day.start }, day),
    ).toBe(true);
    expect(
      occurrenceOverlapsDay({ ...projectedOccurrenceFixture, start_epoch_ms: day.end, end_epoch_ms: day.end }, day),
    ).toBe(false);
  });
  it('navigates month/year boundaries using calendar arithmetic', () => {
    expect(moveCalendarAnchor('2026-01-31', 'month', 1)).toBe('2026-02-28');
    expect(moveCalendarAnchor('2026-12-31', 'day', 1)).toBe('2027-01-01');
    expect(moveCalendarAnchor('2026-01-01', 'week', -1)).toBe('2025-12-25');
  });
});
