import { describe, expect, it } from 'vitest';
import { importCalendarIcsInWorker } from './eventkyImportPreview';

const calendar = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:worker-roundtrip@example.org',
  'DTSTAMP:20260908T120000Z',
  'DTSTART;TZID=Europe/Zurich:20261001T180000',
  'DURATION:PT1H',
  'RRULE:FREQ=WEEKLY;COUNT=3',
  'SUMMARY:Workshop 🌍',
  'X-CLIENT-FIELD:Preserve this metadata',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:worker-roundtrip@example.org',
  'DTSTAMP:20260908T120000Z',
  'RECURRENCE-ID;TZID=Europe/Zurich:20261008T180000',
  'DTSTART;TZID=Europe/Zurich:20261008T190000',
  'DURATION:PT1H',
  'SUMMARY:Moved workshop',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

describe('real browser calendar preview worker', () => {
  it('preserves recurring identity, moved instances, Unicode and unknown metadata across its transport', async () => {
    const result = await importCalendarIcsInWorker(calendar, {
      now: '2026-09-08T12:00:00Z',
      defaultTimezone: 'Europe/Zurich',
    });
    expect(result.errors).toEqual([]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].errors).toEqual([]);
    expect(result.entries[0].event).toMatchObject({
      uid: 'worker-roundtrip@example.org',
      summary: 'Workshop 🌍',
      rrule: 'FREQ=WEEKLY;COUNT=3',
      overrides: [
        {
          recurrence_id: { type: 'zoned', value: '2026-10-08T18:00:00', tzid: 'Europe/Zurich' },
          changes: { dtstart: { type: 'zoned', value: '2026-10-08T19:00:00', tzid: 'Europe/Zurich' } },
        },
      ],
    });
    expect(JSON.stringify(result.entries[0].event?.extensions)).toContain('Preserve this metadata');
  });
});
