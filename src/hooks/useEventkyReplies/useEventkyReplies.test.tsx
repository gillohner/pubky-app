import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { eventkyReplyContext, useEventkyReplyWritesStore } from '@/stores/eventkyReplyWrites/eventkyReplyWrites.store';
import { useEventkyReplies } from './useEventkyReplies';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  local: vi.fn(),
  auth: { currentUserPubky: 'author' },
  backend: 'nexus-a',
}));
vi.mock('@/controllers/eventkyAttendance/eventkyAttendance', () => ({
  EventkyAttendanceController: { fetchReplies: mocks.fetch },
}));
vi.mock('@/controllers/post/post', () => ({ PostController: { getDetailsByIds: mocks.local } }));
vi.mock('@/config/nexus', () => ({ getNexusUrl: () => mocks.backend }));
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (select: (state: typeof mocks.auth) => unknown) => select(mocks.auth),
}));
vi.mock('@/hooks/usePostCounts/usePostCounts', () => ({ usePostCounts: () => ({ postCounts: { replies: 1 } }) }));
vi.mock('dexie-react-hooks', async () => {
  const React = await import('react');
  return {
    useLiveQuery: (query: () => Promise<unknown>, deps: unknown[], initial: unknown) => {
      const [data, setData] = React.useState(initial);
      React.useEffect(() => {
        let active = true;
        void query().then((result) => {
          if (active) setData(result);
        });
        return () => {
          active = false;
        };
      // Mirror Dexie's explicit dependency contract; query identity changes on every render.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, deps);
      return data;
    },
  };
});
const source = {
  id: 'reply',
  author: 'author',
  kind: 'short',
  content: 'fresh comment',
  uri: 'pubky://author/pub/pubky.app/posts/reply',
};
const batch = (sources = [source], complete = true, nextSkip: number | null = null) => ({
  sources,
  posts: [],
  complete,
  nextSkip,
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.backend = 'nexus-a';
  mocks.auth.currentUserPubky = 'author';
  useEventkyReplyWritesStore.setState({ pending: {}, expected: {} });
  mocks.fetch.mockResolvedValue(batch());
  mocks.local.mockResolvedValue([]);
});
it('indexed kind/content wins over stale ordinary local cache', async () => {
  mocks.local.mockResolvedValue([{ ...source, id: 'author:reply', kind: 'attendance', content: 'stale status' }]);
  const { result } = renderHook(() => useEventkyReplies('owner:event'));
  await waitFor(() => expect(result.current.complete).toBe(true));
  expect(result.current.sources).toEqual([source]);
});
it('adds explicitly pending native comments immediately without requiring indexed discovery', async () => {
  const context = eventkyReplyContext('nexus-a', 'author', 'owner:event');
  useEventkyReplyWritesStore.getState().add(context, 'author:reply', 'prepared');
  mocks.fetch.mockResolvedValue(batch([]));
  mocks.local.mockResolvedValue([{ ...source, id: 'author:reply' }]);
  const { result } = renderHook(() => useEventkyReplies('owner:event'));
  await waitFor(() => expect(result.current.sources).toHaveLength(1));
  expect(result.current.sources[0].content).toBe('fresh comment');
});
it('local tombstones suppress fetched records without allowing stale cache edits to override them', async () => {
  mocks.local.mockResolvedValue([{ ...source, id: 'author:reply', content: '[DELETED]' }]);
  const { result } = renderHook(() => useEventkyReplies('owner:event'));
  await waitFor(() => expect(result.current.complete).toBe(true));
  await waitFor(() => expect(result.current.sources).toEqual([]));
});
it('does not leak previous event results or pending replies into a changed account/backend', async () => {
  let finish!: (value: ReturnType<typeof batch>) => void;
  mocks.fetch
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockResolvedValue(batch([]));
  const { result, rerender } = renderHook(({ id }) => useEventkyReplies(id), { initialProps: { id: 'owner:first' } });
  mocks.backend = 'nexus-b';
  mocks.auth.currentUserPubky = 'another';
  rerender({ id: 'owner:second' });
  await waitFor(() => expect(result.current.complete).toBe(true));
  await act(async () => finish(batch()));
  expect(result.current.sources).toEqual([]);
});
it('continues using the raw reply cursor and deduplicates overlapping hydrated pages', async () => {
  mocks.fetch
    .mockResolvedValueOnce(batch([source], false, 1000))
    .mockResolvedValueOnce(batch([source, { ...source, id: 'later', uri: source.uri + 'later' }]));
  const { result } = renderHook(() => useEventkyReplies('owner:event'));
  await waitFor(() => expect(result.current.hasMore).toBe(true));
  await act(async () => result.current.loadMore());
  expect(mocks.fetch).toHaveBeenLastCalledWith('owner:event', 1000);
  expect(result.current.sources).toHaveLength(2);
  expect(result.current.complete).toBe(true);
});
