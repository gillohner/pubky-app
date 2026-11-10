// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createCalendarContent,
  createEventContent,
  getEventkyPlainText,
  hashPostContent,
  isCalendarMember,
  MAX_SOCIAL_TEXT_BYTES,
  parseEventkyContent,
  serializeEventkyContent,
  summarizeEventkyContent,
  updateCalendarContent,
  updateEventContent,
  withSocialText,
} from './contract';
import {
  CALENDAR_FIXTURE,
  EVENT_FIXTURE,
  FIXTURE_CALENDAR_URI,
  FIXTURE_CONTRIBUTOR,
  FIXTURE_EVENT_URI,
} from './fixtures';
import { eventContentSchema } from './schema';

describe('versioned normal-post content', () => {
  it('matches the projection exact kind/content hash and rejects ambiguous delimiters', async () => {
    const source = JSON.stringify(EVENT_FIXTURE);
    expect(await hashPostContent('event', source)).toEqual({
      ok: true,
      value: createHash('sha256').update(`event\0${source}`).digest('hex'),
    });
    expect((await hashPostContent('event\0', source)).ok).toBe(false);
  });
  it('round-trips the event and calendar without losing inert extensions', () => {
    for (const value of [EVENT_FIXTURE, CALENDAR_FIXTURE]) {
      const source = { ...value, extensions: { 'example.org/venue': { accessibility: ['step-free'] } } };
      const serialized = serializeEventkyContent(source);
      expect(serialized.ok).toBe(true);
      if (!serialized.ok) return;
      const parsed = parseEventkyContent(value.schema === 'eventky.event' ? 'event' : 'calendar', serialized.value);
      expect(parsed.status).toBe('supported');
      if (parsed.status === 'supported') expect(parsed.value).toEqual(withSocialText(source));
    }
  });

  it.each(['Event', 'EVENT', 'app.example/event', 'new-kind'])('preserves unsupported exact kind %s', (kind) => {
    expect(parseEventkyContent(kind, JSON.stringify(EVENT_FIXTURE))).toEqual({ status: 'unsupported-kind' });
  });

  it('distinguishes a future version, invalid known content, and a mismatched schema', () => {
    expect(parseEventkyContent('event', JSON.stringify({ ...EVENT_FIXTURE, schema_version: 2 }))).toEqual({
      status: 'unsupported-version',
    });
    for (const content of ['bad JSON', 'null', '[]', '{"schema":"eventky.event"}', JSON.stringify(CALENDAR_FIXTURE)]) {
      expect(parseEventkyContent('event', content).status).toBe('invalid');
    }
  });

  it('never renders opaque JSON as human-readable summary text', () => {
    const content = JSON.stringify(EVENT_FIXTURE);
    expect(summarizeEventkyContent('event', content)).toContain('Pubky builders meetup');
    expect(getEventkyPlainText('event', content)).toContain('ordinary comments');
    expect(summarizeEventkyContent('event', '{"secret":"raw"}')).not.toContain('secret');
  });

  it('rejects UTF-8 size overflow and excessive extension nesting', () => {
    expect(eventContentSchema.safeParse({ ...EVENT_FIXTURE, description: '🙂'.repeat(16385) }).success).toBe(false);
    let nested: unknown = 'value';
    for (let i = 0; i < 12; i++) nested = { nested };
    expect(eventContentSchema.safeParse({ ...EVENT_FIXTURE, extensions: { nested } }).success).toBe(false);
    expect(parseEventkyContent('event', ' '.repeat(512 * 1024 + 1)).status).toBe('invalid');
  });

  it.each([
    { dtstart: { type: 'date', value: '2026-02-30' } },
    { dtstart: { type: 'utc', value: '2026-10-01T18:00:60Z' } },
    { dtstart: { type: 'zoned', value: '2026-10-01T18:00:00+02:00', tzid: 'Europe/Zurich' } },
    { duration: 'P1M' },
    { duration: 'P1Y' },
    { duration: 'PT0S' },
    { dtend: { type: 'zoned', value: '2026-10-01T19:00:00', tzid: 'Europe/Zurich' } },
    { rrule: 'FREQ=WEEKLY;COUNT=3;UNTIL=20261101T000000Z' },
    { rrule: 'FREQ=WEEKLY;BYDAY=NO' },
    { rrule: 'FREQ=WEEKLY;BYDAY=1MO' },
    { rrule: 'FREQ=WEEKLY;COUNT=3;COUNT=4' },
    { rrule: 'FREQ=WEEKLY;UNTIL=20260230T180000Z' },
  ])('rejects malformed temporal data %#', (patch) =>
    expect(eventContentSchema.safeParse({ ...EVENT_FIXTURE, ...patch }).success).toBe(false),
  );

  it('orders different start/end zones by actual instant', () => {
    const event = {
      ...EVENT_FIXTURE,
      duration: undefined,
      dtstart: { type: 'zoned', value: '2026-10-01T20:00:00', tzid: 'Europe/Zurich' },
      dtend: { type: 'zoned', value: '2026-10-01T15:00:00', tzid: 'America/New_York' },
    };
    expect(eventContentSchema.safeParse(event).success).toBe(true);
  });

  it('rejects duplicate occurrence identities and authority-changing patches', () => {
    const override = { recurrence_id: EVENT_FIXTURE.dtstart, changes: { status: 'CANCELLED' } };
    expect(eventContentSchema.safeParse({ ...EVENT_FIXTURE, overrides: [override, override] }).success).toBe(false);
    expect(
      eventContentSchema.safeParse({ ...EVENT_FIXTURE, overrides: [{ ...override, changes: { calendar_uris: [] } }] })
        .success,
    ).toBe(false);
  });

  it('builds and edits with stable identity and declared UTC metadata', () => {
    const context = { uid: 'test-uid', now: '2026-09-08T10:00:00Z' };
    expect(createEventContent({ summary: 'New event', dtstart: EVENT_FIXTURE.dtstart }, context).ok).toBe(true);
    expect(createCalendarContent({ name: 'New calendar', timezone: 'UTC' }, context).ok).toBe(true);
    const updated = updateEventContent(
      EVENT_FIXTURE,
      { uid: 'spoof', created: context.now, summary: 'Edited' },
      context.now,
    );
    expect(updated.ok).toBe(true);
    if (updated.ok)
      expect(updated.value).toMatchObject({
        uid: EVENT_FIXTURE.uid,
        created: EVENT_FIXTURE.created,
        summary: 'Edited',
        sequence: 1,
        dtstamp: context.now,
      });
    const calendar = updateCalendarContent(CALENDAR_FIXTURE, { name: 'Edited calendar', uid: 'spoof' }, context.now);
    expect(calendar.ok).toBe(true);
    if (calendar.ok)
      expect(calendar.value).toMatchObject({ uid: CALENDAR_FIXTURE.uid, sequence: 1, last_modified: context.now });
  });

  it('uses authenticated source authors, contributor revocation, and exclusions for membership', () => {
    expect(isCalendarMember(FIXTURE_CALENDAR_URI, CALENDAR_FIXTURE, FIXTURE_EVENT_URI, EVENT_FIXTURE)).toBe(true);
    expect(
      isCalendarMember(FIXTURE_CALENDAR_URI, { ...CALENDAR_FIXTURE, contributors: [] }, FIXTURE_EVENT_URI, {
        ...EVENT_FIXTURE,
        organizer: { pubky_identity: FIXTURE_CONTRIBUTOR },
      }),
    ).toBe(false);
    expect(
      isCalendarMember(
        FIXTURE_CALENDAR_URI,
        { ...CALENDAR_FIXTURE, excluded_event_uris: [FIXTURE_EVENT_URI] },
        FIXTURE_EVENT_URI,
        EVENT_FIXTURE,
      ),
    ).toBe(false);
    expect(
      isCalendarMember(FIXTURE_CALENDAR_URI, CALENDAR_FIXTURE, FIXTURE_EVENT_URI, {
        ...EVENT_FIXTURE,
        calendar_uris: [],
      }),
    ).toBe(false);
  });

  it('bounds explicitly opted-in social text by UTF-8 bytes and preserves it on network reads', () => {
    const source = { ...EVENT_FIXTURE, social: { version: 1, text: '🙂'.repeat(MAX_SOCIAL_TEXT_BYTES / 4) } };
    expect(parseEventkyContent('event', JSON.stringify(source)).status).toBe('supported');
    expect(
      parseEventkyContent(
        'event',
        JSON.stringify({ ...source, social: { version: 1, text: source.social.text + 'x' } }),
      ).status,
    ).toBe('invalid');
    const parsed = parseEventkyContent('event', JSON.stringify(source));
    if (parsed.status === 'supported') expect(parsed.value.social?.text).toBe(source.social.text);
  });

  it('recomputes authoring social text from human fields, excluding metadata references', () => {
    const value = {
      ...EVENT_FIXTURE,
      social: { version: 1 as const, text: 'stale metadata' },
      organizer: { uri: 'mailto:metadata@example.org' },
    };
    const serialized = serializeEventkyContent(value);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    const raw = JSON.parse(serialized.value);
    expect(raw.social.text).toBe(`${EVENT_FIXTURE.summary}\n\n${EVENT_FIXTURE.description}`);
    expect(raw.social.text).not.toContain('metadata');
    expect(raw.social.text).not.toContain(FIXTURE_CALENDAR_URI);
  });
});
