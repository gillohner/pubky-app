import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnrichedPostDetails } from '@/application/moderation/moderation.types';
import { PostController } from '@/controllers/post/post';
import { eventkySourceHash } from '@/libs/eventky/sourceHash';
import {
  EMPTY_EVENTKY_PREFERENCES,
  EVENTKY_PREFERENCES_KEY,
  eventkyPreferenceScope,
  useEventkyCalendarStore,
} from '@/stores/eventkyCalendar/eventkyCalendar.store';
import { eventkyEventFixture } from '@/test/fixtures/eventky';
import { projectedOccurrenceFixture, projectionPostId, projectionPostUri } from '@/test/fixtures/eventkyProjection';
import { runEventkyReminderTick } from './useEventkyReminders';

vi.mock('@/controllers/post/post', () => ({ PostController: { fetch: vi.fn(), getDetails: vi.fn() } }));
vi.mock('@/libs/eventky/sourceHash', () => ({ eventkySourceHash: vi.fn() }));
const now = Date.parse('2026-10-25T17:15:00Z');
const account = 'y'.repeat(52);
const scope = eventkyPreferenceScope(account, 'https://nexus.example');
const post: EnrichedPostDetails = {
  id: projectionPostId,
  uri: projectionPostUri,
  content: JSON.stringify(eventkyEventFixture),
  kind: 'event',
  attachments: null,
  indexed_at: 1,
  is_blurred: false,
  is_moderated: false,
};
const notify = vi.fn();
const options = () => ({ scope, account, now, muted: new Set<string>(), isActive: () => true, notify });
function enable(occurrenceKey?: string) {
  useEventkyCalendarStore.getState().updateScope(scope, () => ({
    ...EMPTY_EVENTKY_PREFERENCES,
    reminders: [{ postUri: projectionPostUri, occurrenceKey, minutesBefore: 15, enabledAt: now - 60000 }],
  }));
}
beforeEach(() => {
  vi.clearAllMocks();
  useEventkyCalendarStore.setState({ scopes: {} });
  vi.mocked(PostController.fetch).mockResolvedValue(post);
  vi.mocked(PostController.getDetails).mockResolvedValue(post);
  vi.mocked(eventkySourceHash).mockImplementation(async (_kind, content) => content);
});

describe('local reminder delivery', () => {
  it('never activates from published alarm metadata alone', async () => {
    await runEventkyReminderTick(options());
    expect(PostController.fetch).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('honors an opt-out persisted by another tab before reading the source', async () => {
    enable();
    localStorage.setItem(
      EVENTKY_PREFERENCES_KEY,
      JSON.stringify({
        state: { scopes: { [scope]: { ...EMPTY_EVENTKY_PREFERENCES, reminders: [] } } },
        version: 0,
      }),
    );
    await runEventkyReminderTick(options());
    expect(PostController.fetch).not.toHaveBeenCalled();
    expect(useEventkyCalendarStore.getState().scopes[scope].reminders).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });
  it('delivers once per original occurrence and due time, despite repeated ticks and cosmetic source edits', async () => {
    enable();
    await runEventkyReminderTick(options());
    await runEventkyReminderTick(options());
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('Pubky community meetup', projectionPostId, expect.any(String));
    const renamed = {
      ...post,
      content: JSON.stringify({ ...eventkyEventFixture, summary: 'Renamed event' }),
    };
    vi.mocked(PostController.getDetails).mockResolvedValue(renamed);
    vi.mocked(PostController.fetch).mockResolvedValue(renamed);
    await runEventkyReminderTick(options());
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it.each(['cancelled', 'blurred', 'muted', 'future', 'changed-source', 'scope-ended'] as const)(
    'skips %s occurrences',
    async (reason) => {
      enable();
      const args = options();
      if (reason === 'cancelled')
        vi.mocked(PostController.getDetails).mockResolvedValue({
          ...post,
          content: JSON.stringify({ ...eventkyEventFixture, status: 'CANCELLED' }),
        });
      if (reason === 'blurred') vi.mocked(PostController.getDetails).mockResolvedValue({ ...post, is_blurred: true });
      if (reason === 'muted') args.muted.add(account);
      if (reason === 'future') args.now -= 60000;
      if (reason === 'changed-source')
        vi.mocked(PostController.getDetails)
          .mockResolvedValueOnce(post)
          .mockResolvedValue({
            ...post,
            content: JSON.stringify({ ...eventkyEventFixture, summary: 'Changed while reading' }),
          });
      if (reason === 'scope-ended') {
        let calls = 0;
        args.isActive = () => ++calls < 2;
      }
      await runEventkyReminderTick(args);
      expect(notify).not.toHaveBeenCalled();
    },
  );
  it('removes deleted-source reminders but preserves preferences after temporary fetch failures', async () => {
    enable();
    vi.mocked(PostController.fetch).mockRejectedValueOnce(new TypeError('offline'));
    await runEventkyReminderTick(options());
    expect(useEventkyCalendarStore.getState().scopes[scope].reminders).toHaveLength(1);
    vi.mocked(PostController.fetch).mockResolvedValueOnce({ ...post, content: '[DELETED]' });
    await runEventkyReminderTick(options());
    expect(useEventkyCalendarStore.getState().scopes[scope].reminders).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });
  it('retains a newly authored reminder until Nexus indexes its source', async () => {
    enable();
    vi.mocked(PostController.fetch).mockResolvedValueOnce(null);
    await runEventkyReminderTick(options());
    expect(useEventkyCalendarStore.getState().scopes[scope].reminders).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();
    await runEventkyReminderTick(options());
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it('does not notify from an indexed revision older than an observed local cancellation', async () => {
    enable();
    const cancelled = {
      ...post,
      content: JSON.stringify({
        ...eventkyEventFixture,
        sequence: 1,
        last_modified: '2026-10-25T17:14:00Z',
        status: 'CANCELLED',
      }),
    };
    vi.mocked(PostController.getDetails).mockResolvedValueOnce(cancelled).mockResolvedValue(post);
    await runEventkyReminderTick(options());
    await runEventkyReminderTick(options());
    expect(notify).not.toHaveBeenCalled();
    expect(useEventkyCalendarStore.getState().scopes[scope].reminders[0].observedSequence).toBe(1);
  });

  it('tracks a moved instance by its original recurrence identity', async () => {
    enable(projectedOccurrenceFixture.occurrence_key);
    const moved = {
      ...eventkyEventFixture,
      rrule: 'FREQ=WEEKLY;COUNT=2',
      overrides: [
        {
          recurrence_id: eventkyEventFixture.dtstart,
          changes: {
            summary: 'Moved meetup',
            dtstart: { type: 'zoned', value: '2026-10-26T18:30:00', tzid: 'Europe/Zurich' },
            dtend: { type: 'zoned', value: '2026-10-26T20:30:00', tzid: 'Europe/Zurich' },
          },
        },
      ],
    };
    vi.mocked(PostController.getDetails).mockResolvedValue({ ...post, content: JSON.stringify(moved) });
    vi.mocked(PostController.fetch).mockResolvedValue({ ...post, content: JSON.stringify(moved) });
    await runEventkyReminderTick({ ...options(), now: Date.parse('2026-10-26T17:15:00Z') });
    expect(notify).toHaveBeenCalledWith('Moved meetup', projectionPostId, expect.any(String));
    expect(JSON.parse(notify.mock.calls[0][2])[1]).toBe(projectedOccurrenceFixture.occurrence_key);
  });
  it('releases a failed delivery claim so the next tick can retry', async () => {
    enable();
    notify.mockImplementationOnce(() => {
      throw new TypeError('notification failed');
    });
    await runEventkyReminderTick(options());
    expect(useEventkyCalendarStore.getState().scopes[scope].delivered).toEqual({});
    await runEventkyReminderTick(options());
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
