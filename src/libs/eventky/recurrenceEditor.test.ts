import { EVENT_FIXTURE } from '@eventky/fixtures';
import { expandOccurrences } from '@eventky/recurrence';
import type { EventContent } from '@eventky/types';
import { describe, expect, it } from 'vitest';
import { movedOccurrenceTime, moveOccurrence, patchOccurrence, presetRule, previewWindow } from './recurrenceEditor';

describe('occurrence editing', () => {
  it('keeps the original identity and prior fields when moving or cancelling an already edited occurrence', () => {
    const identity = EVENT_FIXTURE.dtstart;
    const old = [{ recurrence_id: identity, changes: { description: 'Retain this', summary: 'Earlier title' } }];
    const moved = movedOccurrenceTime(identity, '2026-10-02', '18:30');
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const next = patchOccurrence(old, identity, { dtstart: moved.value, status: 'CANCELLED' });
    expect(next).toEqual([
      {
        recurrence_id: identity,
        changes: {
          ...old[0].changes,
          dtstart: { type: 'zoned', value: '2026-10-02T18:30:00', tzid: 'Europe/Zurich' },
          status: 'CANCELLED',
        },
      },
    ]);
    expect(old[0].changes).not.toHaveProperty('status');
  });

  it('keeps all-day durations in calendar days across the autumn DST change', () => {
    const event: EventContent = {
      ...EVENT_FIXTURE,
      rrule: undefined,
      dtstart: { type: 'date', value: '2026-10-25' },
      duration: 'P1D',
    };
    const occurrence = expandOccurrences(event, {
      from: '2026-10-24T00:00:00Z',
      to: '2026-10-28T00:00:00Z',
      timezone: 'Europe/Zurich',
    }).occurrences[0];
    expect(occurrence.end_epoch_ms - occurrence.start_epoch_ms).toBe(25 * 3600000);
    expect(moveOccurrence(occurrence, { type: 'date', value: '2026-11-01' }, 'Moved')).toMatchObject({
      duration: 'P1D',
      dtend: null,
    });
  });

  it('does not create an invalid zero duration when moving an instantaneous event', () => {
    const event = { ...EVENT_FIXTURE, rrule: undefined, duration: undefined };
    const occurrence = expandOccurrences(event, {
      from: '2026-10-01T00:00:00Z',
      to: '2026-10-02T00:00:00Z',
      timezone: 'Europe/Zurich',
    }).occurrences[0];
    expect(moveOccurrence(occurrence, occurrence.start, 'Instant')).toMatchObject({ duration: null, dtend: null });
  });

  it('keeps weekly presets aligned to the first date and rejects an impossible preview date', () => {
    expect(presetRule('weekly', '2026-10-01', '')).toBe('FREQ=WEEKLY;BYDAY=TH');
    expect(previewWindow('2026-02-30', 'UTC').ok).toBe(false);
    expect(previewWindow('2026-10-25', 'Europe/Zurich')).toEqual({
      ok: true,
      value: { from: '2026-10-24T22:00:00.000Z', to: '2027-01-22T23:00:00.000Z' },
    });
  });
});
