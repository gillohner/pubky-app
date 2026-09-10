import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';
import { CALENDAR_FIXTURE, EVENT_FIXTURE, FIXTURE_EVENT_URI } from './fixtures';
import { exportCalendarIcs, exportEventIcs, foldIcsLines, importCalendarIcs } from './ical';
import { expandOccurrences } from './recurrence';
import { utf8Length } from './schema';
import type { EventContent } from './types';

const options = { now: '2026-09-08T12:00:00Z', source: 'fixture.ics' };
const query = { from: '2026-10-01T00:00:00Z', to: '2026-11-10T00:00:00Z', timezone: 'Europe/Zurich' };
const rawEvent = (lines: string[]) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//Calendar//EN',
    'BEGIN:VEVENT',
    'UID:example-event',
    'DTSTAMP:20260908T090000Z',
    'DTSTART:20261001T180000Z',
    'SUMMARY:External event',
    ...lines,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');

describe('iCalendar interchange', () => {
  it('retains standard GEO coordinates with and without a location label', () => {
    for (const lines of [['GEO:47.37;8.54'], ['LOCATION:Main hall', 'GEO:47.37;8.54']]) {
      const imported = importCalendarIcs(rawEvent(lines), options).entries[0];
      expect(imported.errors).toEqual([]);
      expect(imported.event?.locations?.[0].geo).toEqual({ latitude: 47.37, longitude: 8.54 });
      const output = exportEventIcs(imported.event!);
      expect(output.ok).toBe(true);
      if (output.ok)
        expect(
          new ICAL.Component(ICAL.parse(output.value)).getFirstSubcomponent('vevent')?.getFirstPropertyValue('geo'),
        ).toEqual([47.37, 8.54]);
    }
  });
  it('exports one ordinary event with an explicit timezone and no scheduling METHOD', () => {
    const result = exportEventIcs(
      { ...EVENT_FIXTURE, rrule: undefined },
      { calendarName: 'Builders', postUri: FIXTURE_EVENT_URI },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('BEGIN:VTIMEZONE');
    expect(result.value).toContain('DTSTART;TZID=Europe/Zurich:20261001T180000');
    expect(result.value).toContain('DURATION:PT2H');
    expect(result.value).toContain('SUMMARY:Pubky builders meetup');
    expect(result.value).not.toContain('METHOD:');
    const parsed = new ICAL.Component(ICAL.parse(result.value));
    expect(parsed.getFirstSubcomponent('vevent')?.getFirstPropertyValue('x-pubky-post-uri')).toBe(FIXTURE_EVENT_URI);
  });

  it('round-trips a zoned series through independently parsed ICS and retains UTC occurrences', () => {
    const output = exportEventIcs(EVENT_FIXTURE);
    expect(output.ok).toBe(true);
    if (!output.ok) return;
    const report = importCalendarIcs(output.value, options);
    expect(report.errors).toEqual([]);
    expect(report.entries[0].errors).toEqual([]);
    const imported = report.entries[0].event!;
    expect(imported.uid).toBe(EVENT_FIXTURE.uid);
    expect(imported.dtstart).toEqual(EVENT_FIXTURE.dtstart);
    expect(imported.rrule?.split(';').sort()).toEqual(EVENT_FIXTURE.rrule?.split(';').sort());
    expect(expandOccurrences(imported, query).occurrences.map((value) => value.start_epoch_ms)).toEqual([
      Date.parse('2026-10-01T16:00:00Z'),
      Date.parse('2026-10-08T16:00:00Z'),
      Date.parse('2026-10-15T16:00:00Z'),
      Date.parse('2026-10-22T16:00:00Z'),
      Date.parse('2026-10-29T17:00:00Z'),
      Date.parse('2026-11-05T17:00:00Z'),
    ]);
  });

  it('exports and imports moved/cancelled instances as VEVENT exceptions sharing UID', () => {
    const event: EventContent = {
      ...EVENT_FIXTURE,
      duration: undefined,
      dtend: { type: 'zoned', value: '2026-10-01T20:00:00', tzid: 'Europe/Zurich' },
      overrides: [
        {
          recurrence_id: { type: 'zoned', value: '2026-10-08T18:00:00', tzid: 'Europe/Zurich' },
          changes: { dtstart: { type: 'zoned', value: '2026-10-09T19:00:00', tzid: 'Europe/Zurich' } },
        },
        {
          recurrence_id: { type: 'zoned', value: '2026-10-15T18:00:00', tzid: 'Europe/Zurich' },
          changes: { status: 'CANCELLED' },
        },
      ],
    };
    const output = exportEventIcs(event);
    expect(output.ok).toBe(true);
    if (!output.ok) return;
    const components = new ICAL.Component(ICAL.parse(output.value)).getAllSubcomponents('vevent');
    expect(components).toHaveLength(3);
    expect(new Set(components.map((component) => component.getFirstPropertyValue('uid'))).size).toBe(1);
    expect(components[1].getFirstPropertyValue('dtend')?.toString()).toBe('2026-10-09T21:00:00');
    expect(components[1].hasProperty('rrule')).toBe(false);
    const imported = importCalendarIcs(output.value, options).entries[0];
    expect(imported.errors).toEqual([]);
    expect(imported.event?.overrides).toHaveLength(2);
    expect(imported.event?.overrides?.[1].changes.status).toBe('CANCELLED');
  });

  it('keeps DATE endings exclusive and emits no timezone on all-day dates', () => {
    const event: EventContent = {
      ...EVENT_FIXTURE,
      rrule: undefined,
      duration: undefined,
      dtstart: { type: 'date', value: '2026-10-01' },
      dtend: { type: 'date', value: '2026-10-04' },
    };
    const output = exportEventIcs(event);
    expect(output.ok).toBe(true);
    if (!output.ok) return;
    expect(output.value).toContain('DTSTART;VALUE=DATE:20261001');
    expect(output.value).toContain('DTEND;VALUE=DATE:20261004');
    expect(output.value).not.toContain('BEGIN:VTIMEZONE');
    expect(importCalendarIcs(output.value, options).entries[0].event?.dtend).toEqual(event.dtend);
  });

  it('escapes multiline text and folds all Unicode lines within 75 octets', () => {
    const summary = 'Community 🙂, 中文; \\ \nBEGIN:VEVENT';
    const output = exportEventIcs({ ...EVENT_FIXTURE, summary, description: '🙂汉字'.repeat(100) });
    expect(output.ok).toBe(true);
    if (!output.ok) return;
    for (const line of output.value.split('\r\n')) expect(utf8Length(line)).toBeLessThanOrEqual(75);
    const events = new ICAL.Component(ICAL.parse(output.value)).getAllSubcomponents('vevent');
    expect(events).toHaveLength(1);
    expect(events[0].getFirstPropertyValue('summary')).toBe(summary);
    expect(foldIcsLines('SUMMARY:' + '🙂'.repeat(100))).not.toContain('\uFFFD');
  });

  it('preserves unknown properties and parameters without making network requests', () => {
    const source = rawEvent(['X-EXAMPLE-COLOR:blue']).replace(
      'SUMMARY:External event',
      'SUMMARY;LANGUAGE=de;X-EXAMPLE="a^nb":External event',
    );
    const imported = importCalendarIcs(source, options).entries[0];
    expect(imported.errors).toEqual([]);
    expect(imported.event?.extensions?.['ical.properties']).toBeDefined();
    expect(imported.requiresAcknowledgement).toContain('Review preserved source metadata before public publication.');
    const output = exportEventIcs(imported.event!);
    expect(output.ok).toBe(true);
    if (!output.ok) return;
    const event = new ICAL.Component(ICAL.parse(output.value)).getFirstSubcomponent('vevent')!;
    expect(event.getFirstPropertyValue('x-example-color')).toBe('blue');
    expect(event.getFirstProperty('summary')?.getFirstParameter('language')).toBe('de');
    expect(event.getFirstProperty('summary')?.getFirstParameter('x-example')).toBe('a\nb');
  });

  it('marks private data for explicit review and drops attendee addresses', () => {
    const imported = importCalendarIcs(
      rawEvent([
        'CLASS:PRIVATE',
        'ATTENDEE:mailto:private@example.org',
        'BEGIN:VALARM',
        'ACTION:EMAIL',
        'TRIGGER:-PT15M',
        'SUMMARY:Secret',
        'DESCRIPTION:Secret',
        'ATTENDEE:mailto:private@example.org',
        'END:VALARM',
      ]),
      options,
    ).entries[0];
    expect(imported.requiresAcknowledgement.some((message) => message.includes('public data'))).toBe(true);
    expect(JSON.stringify(imported.event)).not.toContain('private@example.org');
    expect(imported.event?.alarms).toEqual([]);
  });

  it('uses exact imported content fingerprints and ownership/provenance for update previews', () => {
    const first = importCalendarIcs(rawEvent([]), options).entries[0];
    const existing = [
      {
        uid: first.uid,
        postUri: FIXTURE_EVENT_URI,
        sequence: 0,
        lastModified: '2026-09-08T09:00:00Z',
        source: options.source,
        owned: true,
        contentFingerprint: first.contentFingerprint,
      },
    ];
    expect(importCalendarIcs(rawEvent([]), { ...options, existing }).entries[0].action).toBe('unchanged');
    expect(
      importCalendarIcs(rawEvent([]).replace('External event', 'Changed event'), { ...options, existing }).entries[0]
        .action,
    ).toBe('review-update');
    expect(
      importCalendarIcs(rawEvent([]), { ...options, existing: [{ ...existing[0], owned: false }] }).entries[0].action,
    ).toBe('conflict');
  });

  it('rejects oversized, unbalanced, and deeply nested input before parsing', () => {
    expect(importCalendarIcs('x'.repeat(2 * 1024 * 1024 + 1), options).errors).not.toEqual([]);
    expect(importCalendarIcs('BEGIN:VCALENDAR', options).errors).not.toEqual([]);
    expect(importCalendarIcs('BEGIN:X\n'.repeat(20) + 'END:X\n'.repeat(20), options).errors).not.toEqual([]);
  });

  it('rejects impossible dates, periods and duplicate singleton properties without normalization', () => {
    for (const source of [
      rawEvent([]).replace('20261001T180000Z', '20260230T180000Z'),
      rawEvent(['RDATE;VALUE=PERIOD:20260230T180000Z/PT1H']),
      rawEvent(['DTSTART:20261002T180000Z']),
    ]) {
      expect(importCalendarIcs(source, options).entries[0].errors).not.toEqual([]);
    }
  });

  it('rejects line injection through opaque non-text metadata and unvalidated export options', () => {
    const event = {
      ...EVENT_FIXTURE,
      extensions: { 'ical.properties': [['x-example', {}, 'uri', 'https://example.org\nBEGIN:VEVENT']] },
    };
    expect(exportEventIcs(event).ok).toBe(false);
    expect(exportEventIcs(EVENT_FIXTURE, { postUri: 'invalid\r\nBEGIN:VEVENT' }).ok).toBe(false);
    expect(exportEventIcs(EVENT_FIXTURE, { attachmentUris: ['https://example.org/\r\nBEGIN:VEVENT'] }).ok).toBe(false);
  });

  it('preserves unsupported styled text and alarm triggers without assigning wrong active semantics', () => {
    const imported = importCalendarIcs(
      rawEvent([
        'STYLED-DESCRIPTION;FMTTYPE=text/html:<b>External</b>',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'TRIGGER;RELATED=END:-PT15M',
        'DESCRIPTION:End reminder',
        'END:VALARM',
      ]),
      options,
    ).entries[0];
    expect(imported.errors).toEqual([]);
    expect(imported.event?.styled_description).toBeUndefined();
    expect(imported.event?.alarms).toEqual([]);
    expect(imported.event?.extensions?.['ical.inactive-styled-description']).toContain('<b>External</b>');
    expect(imported.event?.extensions?.['ical.inactive-alarms']).toBeDefined();
  });

  it('reports duplicate UIDs and unsupported THISANDFUTURE without silently merging', () => {
    const duplicate = rawEvent([]).replace(
      'END:VCALENDAR',
      'BEGIN:VEVENT\r\nUID:example-event\r\nDTSTAMP:20260908T090000Z\r\nDTSTART:20261002T180000Z\r\nEND:VEVENT\r\nEND:VCALENDAR',
    );
    expect(importCalendarIcs(duplicate, options).entries[0].action).toBe('conflict');
    const exception = duplicate.replace(
      'DTSTART:20261002T180000Z',
      'DTSTART:20261002T180000Z\r\nRECURRENCE-ID;RANGE=THISANDFUTURE:20261001T180000Z',
    );
    expect(
      importCalendarIcs(exception, options).entries[0].errors.some((message) => message.includes('THISANDFUTURE')),
    ).toBe(true);
  });

  it('exports calendar display colors as an extension and rejects ambiguous event UIDs', () => {
    const output = exportCalendarIcs([{ event: EVENT_FIXTURE }], { calendar: CALENDAR_FIXTURE });
    expect(output.ok).toBe(true);
    if (output.ok) {
      expect(new ICAL.Component(ICAL.parse(output.value)).getFirstPropertyValue('x-apple-calendar-color')).toBe(
        '#6757E8',
      );
      expect(output.value).not.toContain('\r\nCOLOR:#');
    }
    expect(exportCalendarIcs([{ event: EVENT_FIXTURE }, { event: EVENT_FIXTURE }]).ok).toBe(false);
  });
});
