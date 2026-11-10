import { useEffect, useState } from 'react';
import type { OccurrencePage, OccurrenceQuery } from '@eventky-api/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnrichedPostDetails } from '@/application/moderation/moderation.types';
import { EventkyController } from '@/controllers/eventky/eventky';
import { PostController } from '@/controllers/post/post';
import { eventkySourceHash } from '@/libs/eventky/sourceHash';
import { eventkyEventFixture } from '@/test/fixtures/eventky';
import {
  occurrencePageFixture,
  projectedOccurrenceFixture,
  projectionHash,
  projectionPostId,
  projectionPostUri,
} from '@/test/fixtures/eventkyProjection';
import { useEventkyCalendar } from './useEventkyCalendar';

const state = vi.hoisted(() => ({
  viewer: null as string | null,
  muted: new Set<string>(),
  mutedLoading: false,
  blur: true,
  localRevision: 0,
}));
vi.mock('@/controllers/eventky/eventky', () => ({ EventkyController: { fetchOccurrences: vi.fn() } }));
vi.mock('@/controllers/post/post', () => ({
  PostController: { getOrFetch: vi.fn(), fetch: vi.fn(), getDetails: vi.fn() },
}));
vi.mock('@/libs/eventky/sourceHash', () => ({ eventkySourceHash: vi.fn() }));
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (value: { currentUserPubky: string | null }) => unknown) =>
    selector({ currentUserPubky: state.viewer }),
}));
vi.mock('@/stores/settings/settings.store', () => ({
  useSettingsStore: (selector: (value: { privacy: { blurCensored: boolean } }) => unknown) =>
    selector({ privacy: { blurCensored: state.blur } }),
}));
vi.mock('@/hooks/useMutedUsers/useMutedUsers', () => ({
  useMutedUsers: () => ({ mutedUserIdSet: state.muted, isLoading: state.mutedLoading }),
}));
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: <T,>(querier: () => Promise<T>, dependencies: unknown[]) => useExecutedLiveQuery(querier, dependencies),
}));

/** Execute the local query, retaining its previous emission while a replacement is pending, like Dexie. */
function useExecutedLiveQuery<T>(querier: () => Promise<T>, dependencies: unknown[]) {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    let active = true;
    void querier().then((next) => {
      if (active) setValue(next);
    });
    return () => {
      active = false;
    };
    // The revision simulates Dexie's notification when a locally read row changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, state.localRevision]);
  return value;
}

const query: OccurrenceQuery = { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z', timezone: 'UTC' };
const sourceContent = JSON.stringify(eventkyEventFixture);
const post: EnrichedPostDetails = {
  id: projectionPostId,
  uri: projectionPostUri,
  kind: 'event',
  content: sourceContent,
  indexed_at: 1,
  attachments: null,
  is_blurred: false,
  is_moderated: false,
};
const fetchOccurrences = vi.mocked(EventkyController.fetchOccurrences);
const getDetails = vi.mocked(PostController.getDetails);

beforeEach(() => {
  vi.clearAllMocks();
  state.viewer = null;
  state.muted = new Set();
  state.mutedLoading = false;
  state.blur = true;
  state.localRevision = 0;
  fetchOccurrences.mockResolvedValue({ ok: true, value: occurrencePageFixture() });
  vi.mocked(PostController.getOrFetch).mockResolvedValue(post);
  vi.mocked(PostController.fetch).mockResolvedValue(post);
  getDetails.mockResolvedValue(post);
  vi.mocked(eventkySourceHash).mockResolvedValue(projectionHash);
});

describe('useEventkyCalendar', () => {
  it('hydrates one native post for multiple occurrences and retains original social identity', async () => {
    const page = occurrencePageFixture([
      projectedOccurrenceFixture,
      { ...projectedOccurrenceFixture, occurrence_key: 'second' },
    ]);
    fetchOccurrences.mockResolvedValue({ ok: true, value: page });
    const { result } = renderHook(() => useEventkyCalendar(query));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(PostController.getOrFetch).toHaveBeenCalledTimes(1);
    expect(result.current.items.map((item) => item.projection.post_id)).toEqual([projectionPostId, projectionPostId]);
    expect(result.current.items[0].sourceContent).toBe(sourceContent);
    expect(result.current.incomplete).toBe(false);
    expect(PostController.fetch).not.toHaveBeenCalled();
  });

  it('uses the original recurrence identity for a moved occurrence and preserves explicit clearing', async () => {
    const source = {
      ...eventkyEventFixture,
      rrule: 'FREQ=WEEKLY;COUNT=3',
      locations: [{ id: 'office', kind: 'PHYSICAL', label: 'Old office' }],
      overrides: [
        {
          recurrence_id: eventkyEventFixture.dtstart,
          changes: {
            summary: 'Moved meetup',
            description: null,
            locations: null,
            transp: 'TRANSPARENT',
            alarms: null,
            dtstart: { type: 'zoned', value: '2026-10-26T18:30:00', tzid: 'Europe/Zurich' },
          },
        },
      ],
    };
    getDetails.mockResolvedValue({ ...post, content: JSON.stringify(source) });
    const projection = {
      ...projectedOccurrenceFixture,
      start: { type: 'zoned' as const, value: '2026-10-26T18:30:00', tzid: 'Europe/Zurich' },
      end: { type: 'zoned' as const, value: '2026-10-26T20:30:00', tzid: 'Europe/Zurich' },
    };
    fetchOccurrences.mockResolvedValue({ ok: true, value: occurrencePageFixture([projection]) });
    const { result } = renderHook(() => useEventkyCalendar(query));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0].event).toMatchObject({
      summary: 'Moved meetup',
      dtstart: projection.start,
      description: undefined,
      locations: undefined,
      transp: 'TRANSPARENT',
      alarms: undefined,
    });
    expect(result.current.items[0].projection.occurrence_key).toBe(projectedOccurrenceFixture.occurrence_key);
  });

  it.each(['missing', 'malformed', 'hash-mismatch', 'wrong-uri'] as const)(
    'does not report an empty complete calendar for a %s source',
    async (failure) => {
      if (failure === 'missing') getDetails.mockResolvedValue(null);
      if (failure === 'malformed') getDetails.mockResolvedValue({ ...post, content: '{invalid' });
      if (failure === 'hash-mismatch') vi.mocked(eventkySourceHash).mockResolvedValue('b'.repeat(64));
      if (failure === 'wrong-uri')
        fetchOccurrences.mockResolvedValue({
          ok: true,
          value: occurrencePageFixture([
            { ...projectedOccurrenceFixture, post_uri: projectionPostUri.replace(/1$/, '2') },
          ]),
        });
      const { result } = renderHook(() => useEventkyCalendar(query));
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.items).toEqual([]);
      expect(result.current.incomplete).toBe(true);
      if (failure === 'hash-mismatch') {
        expect(result.current.stale).toBe(true);
        expect(PostController.fetch).toHaveBeenCalledWith({ compositeId: projectionPostId, viewerId: undefined });
      }
    },
  );

  it('hides previous items synchronously when mute filters change, even before the local query settles', async () => {
    const { result, rerender } = renderHook(() => useEventkyCalendar(query));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    state.muted = new Set(['y'.repeat(52)]);
    rerender();
    expect(result.current.items).toEqual([]);
    await waitFor(() => expect(result.current.hidden).toBe(1));
    expect(result.current.incomplete).toBe(false);
  });

  it('waits for muted-user state and excludes blurred content before returning titles', async () => {
    state.mutedLoading = true;
    const { result, rerender } = renderHook(() => useEventkyCalendar(query));
    await waitFor(() => expect(getDetails).toHaveBeenCalled());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.items).toEqual([]);
    state.mutedLoading = false;
    getDetails.mockResolvedValue({ ...post, is_blurred: true });
    state.localRevision++;
    rerender();
    await waitFor(() => expect(result.current.hidden).toBe(1));
    expect(result.current.items).toEqual([]);
  });

  it('drops old-range results immediately and ignores late completion after switching ranges', async () => {
    const { result, rerender } = renderHook(({ from }) => useEventkyCalendar({ ...query, from }), {
      initialProps: { from: query.from },
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    let finish: ((page: { ok: true; value: OccurrencePage }) => void) | undefined;
    fetchOccurrences.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    rerender({ from: '2026-11-01T00:00:00Z' });
    expect(result.current.items).toEqual([]);
    fetchOccurrences.mockResolvedValue({ ok: true, value: occurrencePageFixture([]) });
    rerender({ from: '2026-12-01T00:00:00Z' });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      finish?.({ ok: true, value: occurrencePageFixture() });
    });
    expect(result.current.items).toEqual([]);
  });

  it('retries a stale cursor once, then exposes a recoverable error without looping', async () => {
    fetchOccurrences.mockResolvedValue({ ok: false, code: 'STALE_CURSOR', message: 'stale' });
    const { result } = renderHook(() => useEventkyCalendar(query));
    await waitFor(() => expect(result.current.error).toBe('Calendar results are unavailable. Try refreshing.'));
    expect(fetchOccurrences).toHaveBeenCalledTimes(2);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.items).toEqual([]);
  });

  it('responds to local source edits by hiding stale projected occurrences', async () => {
    const { result, rerender } = renderHook(() => useEventkyCalendar(query));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    vi.mocked(eventkySourceHash).mockResolvedValue('b'.repeat(64));
    state.localRevision++;
    rerender();
    await waitFor(() => expect(result.current.stale).toBe(true));
    expect(result.current.items).toEqual([]);
    expect(result.current.incomplete).toBe(true);
  });

  it('polls only while visible, refreshes on return, and releases listeners on unmount', async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const { unmount } = renderHook(() => useEventkyCalendar(query));
    await act(async () => {});
    expect(fetchOccurrences).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(15000);
    });
    expect(fetchOccurrences).toHaveBeenCalledTimes(2);
    visibility.mockReturnValue('hidden');
    await act(async () => {
      vi.advanceTimersByTime(30000);
    });
    expect(fetchOccurrences).toHaveBeenCalledTimes(2);
    visibility.mockReturnValue('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(fetchOccurrences).toHaveBeenCalledTimes(3);
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(15000);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(fetchOccurrences).toHaveBeenCalledTimes(3);
    expect(fetchOccurrences.mock.calls[2][1]?.aborted).toBe(true);
    visibility.mockRestore();
    vi.useRealTimers();
  });

  it('does not query when disabled and refreshes explicitly when enabled', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useEventkyCalendar(enabled ? query : null), {
      initialProps: { enabled: false },
    });
    expect(fetchOccurrences).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.refresh());
    await waitFor(() => expect(fetchOccurrences).toHaveBeenCalledTimes(2));
  });
});
