import { CALENDAR_FIXTURE, EVENT_FIXTURE } from '@eventky/fixtures';
import type { EventContent } from '@eventky/types';
import { describe, expect, it } from 'vitest';
import { buildEventkyFormContent, getEventkyFormDefaults } from './useEventkyPostForm.utils';

const identity = { uid: 'new-uid', now: '2026-09-09T10:00:00Z' };
function edited(source: EventContent) {
  const form = getEventkyFormDefaults('event', source);
  const result = buildEventkyFormContent('event', { ...form, title: 'Changed title' }, identity, source, form);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.issues.join(', '));
  return JSON.parse(result.value) as EventContent;
}

describe('native event form serialization', () => {
  it('preserves existing transparent wire semantics without an availability control', () => {
    const source: EventContent = { ...EVENT_FIXTURE, transp: 'TRANSPARENT' };
    expect(edited(source).transp).toBe('TRANSPARENT');
  });

  it('edits the title without resetting identity, revision history, recurrence exceptions or duration', () => {
    const source: EventContent = {
      ...EVENT_FIXTURE,
      sequence: 7,
      exdate: [{ type: 'zoned', value: '2026-10-08T18:00:00', tzid: 'Europe/Zurich' }],
      overrides: [
        {
          recurrence_id: { type: 'zoned', value: '2026-10-15T18:00:00', tzid: 'Europe/Zurich' },
          changes: { summary: 'Special meeting' },
        },
      ],
      extensions: { 'X-EXAMPLE': { value: 'retained' } },
    };
    const result = edited(source);
    expect(result).toMatchObject({
      summary: 'Changed title',
      uid: source.uid,
      created: source.created,
      sequence: 8,
      dtstamp: identity.now,
      last_modified: identity.now,
      exdate: source.exdate,
      overrides: source.overrides,
      extensions: source.extensions,
      duration: 'PT2H',
    });
    expect(result.dtend).toBeUndefined();
  });

  it('preserves a UTC instant and an end in a different timezone on content-only edits', () => {
    const source: EventContent = {
      ...EVENT_FIXTURE,
      rrule: undefined,
      duration: undefined,
      dtstart: { type: 'utc', value: '2026-10-01T16:00:37Z' },
      dtend: { type: 'zoned', value: '2026-10-01T20:00:42', tzid: 'Europe/Zurich' },
    };
    const result = edited(source);
    expect(result.dtstart).toEqual(source.dtstart);
    expect(result.dtend).toEqual(source.dtend);
  });

  it('does not invent an end or styled description when editing an imported instantaneous event', () => {
    const source = { ...EVENT_FIXTURE, duration: undefined, rrule: undefined, styled_description: undefined };
    const result = edited(source);
    expect(result.dtend).toBeUndefined();
    expect(result.duration).toBeUndefined();
    expect(result.styled_description).toBeUndefined();
  });

  it('displays the last occupied all-day date and serializes its exclusive RFC end', () => {
    const form = {
      ...getEventkyFormDefaults('event'),
      title: 'Conference',
      allDay: true,
      startDate: '2026-10-01',
      endDate: '2026-10-03',
    };
    const result = buildEventkyFormContent('event', form, identity);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = JSON.parse(result.value);
    expect(value.dtstart).toEqual({ type: 'date', value: '2026-10-01' });
    expect(value.dtend).toEqual({ type: 'date', value: '2026-10-04' });
    expect(getEventkyFormDefaults('event', value).endDate).toBe('2026-10-03');
  });

  it('allows a user to explicitly change UTC to a named timezone', () => {
    const source: EventContent = {
      ...EVENT_FIXTURE,
      rrule: undefined,
      dtstart: { type: 'utc', value: '2026-10-01T16:00:00Z' },
    };
    const form = getEventkyFormDefaults('event', source);
    const result = buildEventkyFormContent(
      'event',
      { ...form, timeMode: 'zoned', timezone: 'Europe/Zurich' },
      identity,
      source,
      form,
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(JSON.parse(result.value).dtstart).toEqual({
        type: 'zoned',
        value: '2026-10-01T16:00:00',
        tzid: 'Europe/Zurich',
      });
  });

  it('rejects an end before the start and unsupported link schemes', () => {
    const form = {
      ...getEventkyFormDefaults('event'),
      title: 'Invalid',
      timeMode: 'utc' as const,
      startDate: '2026-10-01',
      endDate: '2026-10-01',
      startTime: '18:00',
      endTime: '17:00',
    };
    expect(buildEventkyFormContent('event', form, identity).ok).toBe(false);
    expect(
      buildEventkyFormContent('event', { ...form, endTime: '19:00', onlineUrl: 'javascript:alert(1)' }, identity).ok,
    ).toBe(false);
  });

  it('preserves calendar owner policies and creation history when changing its name', () => {
    const source = {
      ...CALENDAR_FIXTURE,
      sequence: 4,
      excluded_event_uris: EVENT_FIXTURE.calendar_uris,
      extensions: { 'X-DEMO': 'retained' },
    };
    const result = buildEventkyFormContent(
      'calendar',
      { ...getEventkyFormDefaults('calendar', source), title: 'New name' },
      identity,
      source,
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(JSON.parse(result.value)).toMatchObject({
        name: 'New name',
        uid: source.uid,
        created: source.created,
        sequence: 5,
        excluded_event_uris: source.excluded_event_uris,
        extensions: source.extensions,
      });
  });
});
