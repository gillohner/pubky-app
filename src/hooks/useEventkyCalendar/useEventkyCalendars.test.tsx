import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { PostController } from '@/controllers/post/post';
import { StreamPostsController } from '@/controllers/stream/posts/posts';
import { eventkyCalendarFixture as CALENDAR_FIXTURE } from '@/test/fixtures/eventky';
import { useEventkyCalendars } from './useEventkyCalendars';

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
});
it('discovers named calendar posts and resumes from the raw stream cursor', async () => {
  vi.mocked(StreamPostsController.getOrFetchStreamSlice)
    .mockResolvedValueOnce({ nextPageIds: [], nextCursor: undefined, reachedEnd: true })
    .mockResolvedValueOnce({
      nextPageIds: ['author:first'],
      nextCursor: 42,
      lastRawPostId: 'author:hidden',
      reachedEnd: false,
    })
    .mockResolvedValueOnce({ nextPageIds: ['author:second'], nextCursor: undefined, reachedEnd: true });
  vi.mocked(PostController.getDetails).mockImplementation(
    async ({ compositeId }) =>
      ({ id: compositeId, kind: 'calendar', content: JSON.stringify(CALENDAR_FIXTURE), is_blurred: false }) as never,
  );
  const { result } = renderHook(() => useEventkyCalendars());
  await waitFor(() => expect(result.current.calendars).toHaveLength(1));
  expect(result.current.calendars[0]).toMatchObject({
    name: CALENDAR_FIXTURE.name,
    uri: 'pubky://author/pub/pubky.app/posts/first',
  });
  act(() => result.current.loadMore());
  await waitFor(() => expect(result.current.calendars).toHaveLength(2));
  expect(StreamPostsController.getOrFetchStreamSlice).toHaveBeenLastCalledWith(
    expect.objectContaining({ streamTail: 42, lastPostId: 'author:hidden' }),
  );
  expect(result.current.hasMore).toBe(false);
});
it('does not offer blurred or unsupported calendar content', async () => {
  vi.mocked(StreamPostsController.getOrFetchStreamSlice).mockResolvedValue({
    nextPageIds: ['blurred', 'invalid'],
    nextCursor: undefined,
    reachedEnd: true,
  });
  vi.mocked(PostController.getDetails).mockImplementation(
    async ({ compositeId }) =>
      ({
        id: compositeId,
        kind: 'calendar',
        content: compositeId === 'invalid' ? '{}' : JSON.stringify(CALENDAR_FIXTURE),
        is_blurred: compositeId === 'blurred',
      }) as never,
  );
  const { result } = renderHook(() => useEventkyCalendars());
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.calendars).toEqual([]);
});

it('refreshes a cached calendar policy before exposing contributor membership', async () => {
  const contributor = 'y'.repeat(52);
  let content = { ...CALENDAR_FIXTURE, contributors: [] as string[] };
  vi.mocked(StreamPostsController.getOrFetchStreamSlice).mockResolvedValue({
    nextPageIds: ['author:first'],
    nextCursor: undefined,
    reachedEnd: true,
  });
  vi.mocked(PostController.fetch).mockImplementation(async () => {
    content = { ...CALENDAR_FIXTURE, contributors: [contributor] };
    return {} as never;
  });
  vi.mocked(PostController.getDetails).mockImplementation(
    async () =>
      ({
        id: 'author:first',
        kind: 'calendar',
        content: JSON.stringify(content),
        is_blurred: false,
      }) as never,
  );
  const { result } = renderHook(() => useEventkyCalendars());
  await waitFor(() => expect(result.current.calendars).toHaveLength(1));
  expect(result.current.calendars[0].calendar.contributors).toEqual([contributor]);
});

it('refreshes a newly published calendar before reading cached discovery', async () => {
  let refreshed = false;
  vi.mocked(StreamPostsController.mergeUnreadStreamWithPostStream).mockImplementation(async () => {
    refreshed = true;
    return [] as never;
  });
  vi.mocked(StreamPostsController.getOrFetchStreamSlice).mockImplementation(async (params) => ({
    nextPageIds: params.streamHead || refreshed ? ['author:new'] : [],
    nextCursor: undefined,
    reachedEnd: true,
  }));
  vi.mocked(PostController.getDetails).mockResolvedValue({
    kind: 'calendar',
    content: JSON.stringify(CALENDAR_FIXTURE),
    is_blurred: false,
  } as never);
  const { result } = renderHook(() => useEventkyCalendars());
  await waitFor(() => expect(result.current.calendars).toHaveLength(1));
  expect(result.current.calendars[0].id).toBe('author:new');
  expect(StreamPostsController.getOrFetchStreamSlice).toHaveBeenNthCalledWith(1, {
    streamId: 'timeline:all:calendar',
    streamHead: 123,
    limit: 20,
  });
});
