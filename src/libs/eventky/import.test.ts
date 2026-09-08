import { EVENT_FIXTURE } from '@eventky/fixtures';
import type { EventContent } from '@eventky/types';
import { describe, expect, it } from 'vitest';
import { importFingerprint, replaceImportedEvent } from './import';

describe('import snapshot semantics', () => {
  it('replaces duration with an explicit end and clears a removed Markdown description', () => {
    const previous: EventContent = {
      ...EVENT_FIXTURE,
      styled_description: { format: 'markdown', content: 'Old **markdown**' },
    };
    const next: EventContent = {
      ...EVENT_FIXTURE,
      duration: undefined,
      dtend: { type: 'zoned', value: '2026-10-01T19:00:00', tzid: 'Europe/Zurich' },
      description: 'New plain text',
    };
    const result = replaceImportedEvent(previous, next, '2026-09-09T12:00:00Z');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.duration).toBeUndefined();
    expect(result.data.styled_description).toBeUndefined();
    expect(result.data.description).toBe('New plain text');
    expect(result.data).toMatchObject({ uid: previous.uid, created: previous.created, sequence: 1 });
  });

  it('clears removed recurrence and end fields rather than inheriting the old schedule', () => {
    const next: EventContent = {
      ...EVENT_FIXTURE,
      duration: undefined,
      rrule: undefined,
      exdate: undefined,
      overrides: undefined,
    };
    const result = replaceImportedEvent(EVENT_FIXTURE, next, '2026-09-09T12:00:00Z');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toMatchObject({ duration: undefined, rrule: undefined });
  });

  it('ignores generated fallback timestamps when identifying a repeated import', () => {
    expect(importFingerprint(EVENT_FIXTURE)).toBe(
      importFingerprint({
        ...EVENT_FIXTURE,
        created: '2026-09-10T12:00:00Z',
        last_modified: '2026-09-10T12:00:00Z',
        dtstamp: '2026-09-10T12:00:00Z',
      }),
    );
  });
});
