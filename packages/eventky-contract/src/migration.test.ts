import { describe, expect, it } from 'vitest';
import { FIXTURE_CONTRIBUTOR, FIXTURE_OWNER } from './fixtures';
import { legacyMicrosecondsToUtc, migrateLegacyTime, prepareLegacyMigration } from './migration';
import type { EventContent } from './types';

const calendarUri = `pubky://${FIXTURE_OWNER}/pub/eventky.app/calendars/0034A0X7NJ52A`;
const eventUri = `pubky://${FIXTURE_OWNER}/pub/eventky.app/events/0034A0X7NJ52B`;
const exceptionUri = `pubky://${FIXTURE_OWNER}/pub/eventky.app/events/0034A0X7NJ52C`;
const post = (id: string) => `pubky://${FIXTURE_OWNER}/pub/pubky.app/posts/${id}`;
const options = {
  owner: FIXTURE_OWNER,
  now: '2026-09-08T12:00:00Z',
  uriMap: { [calendarUri]: post('0034A0X7NJ52D'), [eventUri]: post('0034A0X7NJ52E') },
};
const legacy = {
  uid: 'legacy-series',
  summary: 'Builders',
  dtstart: '2026-10-01T18:00:00',
  dtstart_tzid: 'Europe/Zurich',
  duration: 'PT2H',
  dtstamp: 1788858000123456,
  created: 1788858000123456,
  last_modified: 1788858000123456,
  sequence: 2,
  rrule: 'FREQ=WEEKLY;BYDAY=TH;COUNT=6',
  x_pubky_calendar_uris: [calendarUri],
};

describe('legacy migration previews', () => {
  it('converts microseconds exactly and refuses unsafe integer precision', () => {
    expect(legacyMicrosecondsToUtc(1788858000123456)).toEqual({ ok: true, value: '2026-09-08T09:00:00.123456Z' });
    expect(legacyMicrosecondsToUtc(Number.MAX_SAFE_INTEGER + 1).ok).toBe(false);
    expect(legacyMicrosecondsToUtc('1788858000123456').ok).toBe(false);
  });

  it('preserves temporal intent without guessing all-day events from midnight', () => {
    expect(migrateLegacyTime('2026-10-01')).toEqual({ ok: true, value: { type: 'date', value: '2026-10-01' } });
    expect(migrateLegacyTime('2026-10-01T00:00:00')).toEqual({
      ok: true,
      value: { type: 'floating', value: '2026-10-01T00:00:00' },
    });
    expect(migrateLegacyTime('2026-10-01T18:00:00+05:45')).toEqual({
      ok: true,
      value: { type: 'utc', value: '2026-10-01T12:15:00Z' },
    });
    expect(migrateLegacyTime('2026-10-01T18:00:00Z', 'Europe/Zurich').ok).toBe(false);
    expect(migrateLegacyTime('2026-02-30').ok).toBe(false);
  });

  it('converts owner records and rewrites references to allocated ordinary post URIs', () => {
    const source = [
      {
        uri: eventUri,
        data: { ...legacy, locations: [{ kind: 'PHYSICAL', label: 'Main hall', uri: 'https://example.org/hall' }] },
      },
      {
        uri: calendarUri,
        data: {
          name: 'Builders calendar',
          timezone: 'Europe/Zurich',
          color: '#6757E8',
          x_pubky_authors: [`pubky://${FIXTURE_CONTRIBUTOR}`],
        },
      },
    ];
    const snapshot = JSON.stringify(source);
    const report = prepareLegacyMigration(source, options);
    expect(report.errors).toEqual([]);
    expect(report.calendars[0].errors).toEqual([]);
    expect(report.events[0].errors).toEqual([]);
    expect(report.calendars[0].content).toMatchObject({ contributors: [FIXTURE_CONTRIBUTOR], sequence: 0 });
    expect(report.events[0].content).toMatchObject({
      uid: 'legacy-series',
      sequence: 2,
      calendar_uris: [options.uriMap[calendarUri]],
      created: '2026-09-08T09:00:00.123456Z',
    });
    expect(JSON.stringify(source)).toBe(snapshot);
    expect(prepareLegacyMigration(source, options)).toEqual(report);
  });

  it('retains an explicitly UTC end with a zoned start', () => {
    const report = prepareLegacyMigration(
      [{ uri: eventUri, data: { ...legacy, duration: undefined, dtend: '2026-10-01T19:00:00Z' } }],
      options,
    );
    expect(report.events[0].errors).toEqual([]);
    expect(report.events[0].content).toMatchObject({ dtend: { type: 'utc', value: '2026-10-01T19:00:00Z' } });
  });

  it('merges exception identities into one social series and preserves source links', () => {
    const report = prepareLegacyMigration(
      [
        { uri: eventUri, data: legacy },
        {
          uri: exceptionUri,
          data: { ...legacy, recurrence_id: '2026-10-08T18:00:00', dtstart: '2026-10-09T19:00:00', rrule: undefined },
        },
      ],
      options,
    );
    expect(report.events).toHaveLength(1);
    expect(report.events[0].errors).toEqual([]);
    const event = report.events[0].content as EventContent;
    expect(event.overrides?.[0]).toMatchObject({
      recurrence_id: { type: 'zoned', value: '2026-10-08T18:00:00', tzid: 'Europe/Zurich' },
      changes: { dtstart: { value: '2026-10-09T19:00:00' } },
    });
    expect(event.extensions?.['eventky.legacy-exception-uris']).toEqual([exceptionUri]);
  });

  it('requires review for missing mappings, duplicate masters, unowned sources and rich HTML', () => {
    expect(
      prepareLegacyMigration([{ uri: eventUri, data: legacy }], { ...options, uriMap: {} }).events[0].errors,
    ).not.toEqual([]);
    expect(
      prepareLegacyMigration(
        [
          { uri: eventUri, data: legacy },
          { uri: exceptionUri, data: legacy },
        ],
        options,
      ).events.every((entry) => entry.errors.length > 0),
    ).toBe(true);
    expect(
      prepareLegacyMigration([{ uri: eventUri.replace(FIXTURE_OWNER, FIXTURE_CONTRIBUTOR), data: legacy }], options)
        .errors,
    ).not.toEqual([]);
    expect(
      prepareLegacyMigration(
        [{ uri: eventUri, data: { ...legacy, styled_description: { format: 'html', content: '<b>Review</b>' } } }],
        options,
      ).events[0].errors,
    ).not.toEqual([]);
  });
});
