import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { PostController } from '@/controllers/post/post';
import { StreamPostsController } from '@/controllers/stream/posts/posts';
import { eventkyEventFixture } from '@/test/fixtures/eventky';
import { useEventkyEvents } from './useEventkyEvents';

vi.mock('@/controllers/post/post', () => ({ PostController: { getDetails: vi.fn(), fetch: vi.fn() } }));
vi.mock('@/controllers/stream/posts/posts', () => ({
  StreamPostsController: {
    getOrFetchStreamSlice: vi.fn(),
    getStreamHead: vi.fn(),
    prepareStreamForInitialLoad: vi.fn(),
    mergeUnreadStreamWithPostStream: vi.fn(),
  },
}));
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (select: (value: { currentUserPubky: null }) => unknown) => select({ currentUserPubky: null }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(StreamPostsController.getStreamHead).mockResolvedValue(123);
  vi.mocked(PostController.fetch).mockResolvedValue({} as never);
  vi.mocked(PostController.getDetails).mockImplementation(
    async ({ compositeId }) =>
      ({ id: compositeId, kind: 'event', content: JSON.stringify(eventkyEventFixture), is_blurred: false }) as never,
  );
});

it('refreshes newly published events before reading the moderated cached stream and retains raw pagination', async () => {
  let refreshed = false;
  vi.mocked(StreamPostsController.mergeUnreadStreamWithPostStream).mockImplementation(async () => {
    refreshed = true;
    return [] as never;
  });
  vi.mocked(StreamPostsController.getOrFetchStreamSlice).mockImplementation(async (params) => {
    if (params.streamHead) return { nextPageIds: ['guest:new'], nextCursor: 88, reachedEnd: true };
    if (params.lastPostId) return { nextPageIds: ['older:event'], nextCursor: undefined, reachedEnd: true };
    return {
      nextPageIds: refreshed ? ['guest:new', 'owner:old'] : ['owner:old'],
      nextCursor: 42,
      lastRawPostId: 'muted:last',
      reachedEnd: false,
    };
  });
  const { result } = renderHook(() => useEventkyEvents());
  await waitFor(() => expect(result.current.events).toHaveLength(2));
  expect(result.current.events[0].id).toBe('guest:new');
  expect(StreamPostsController.getOrFetchStreamSlice).toHaveBeenNthCalledWith(1, {
    streamId: 'timeline:all:event',
    streamHead: 123,
    limit: 20,
  });
  act(() => result.current.loadMore());
  await waitFor(() => expect(result.current.events).toHaveLength(3));
  expect(StreamPostsController.getOrFetchStreamSlice).toHaveBeenLastCalledWith(
    expect.objectContaining({ streamTail: 42, lastPostId: 'muted:last' }),
  );
  expect(StreamPostsController.getStreamHead).toHaveBeenCalledTimes(1);
});

it('reads current membership after hydration and hides deleted, blurred and unsupported events', async () => {
  let content = { ...eventkyEventFixture, calendar_uris: [] as string[] };
  vi.mocked(StreamPostsController.getOrFetchStreamSlice).mockResolvedValue({
    nextPageIds: ['member', 'deleted', 'blurred', 'invalid'],
    nextCursor: undefined,
    reachedEnd: true,
  });
  vi.mocked(PostController.fetch).mockImplementation(async ({ compositeId }) => {
    content = {
      ...eventkyEventFixture,
      calendar_uris: ['pubky://' + 'y'.repeat(52) + '/pub/pubky.app/posts/0035P2T1EFT30'],
    };
    return compositeId === 'deleted' ? (null as never) : ({} as never);
  });
  vi.mocked(PostController.getDetails).mockImplementation(
    async ({ compositeId }) =>
      ({
        kind: 'event',
        content: compositeId === 'invalid' ? '{}' : JSON.stringify(content),
        is_blurred: compositeId === 'blurred',
      }) as never,
  );
  const { result } = renderHook(() => useEventkyEvents());
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.events).toHaveLength(1);
  expect(result.current.events[0].event.calendar_uris).toHaveLength(1);
});

it('reports refresh failure without offering stale choices', async () => {
  vi.mocked(StreamPostsController.getOrFetchStreamSlice).mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => useEventkyEvents());
  await waitFor(() => expect(result.current.error).toBe('Events could not be loaded. Try again.'));
  expect(result.current.events).toEqual([]);
});
