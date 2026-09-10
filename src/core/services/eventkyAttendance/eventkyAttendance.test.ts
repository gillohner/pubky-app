import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NexusPostStreamService } from '@/services/nexus/stream/posts/postStream';
import { EventkyAttendanceService } from './eventkyAttendance';

vi.mock('@/services/nexus/stream/posts/postStream', () => ({
  NexusPostStreamService: { fetch: vi.fn(), fetchByIds: vi.fn() },
}));
beforeEach(() => vi.clearAllMocks());
describe('attendance discovery completeness', () => {
  it('does not label missing indexed records complete', async () => {
    vi.mocked(NexusPostStreamService.fetch).mockResolvedValue({ post_keys: ['author:id'], last_post_score: null });
    vi.mocked(NexusPostStreamService.fetchByIds).mockResolvedValue([]);
    expect((await EventkyAttendanceService.fetch('author:event')).complete).toBe(false);
  });
  it('returns complete for an exhausted empty stream', async () => {
    vi.mocked(NexusPostStreamService.fetch).mockResolvedValue({ post_keys: [], last_post_score: null });
    expect(await EventkyAttendanceService.fetch('author:event')).toEqual({ complete: true, sources: [] });
    expect(NexusPostStreamService.fetch).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ limit: 50 }) }),
    );
    expect(NexusPostStreamService.fetch).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.not.objectContaining({ kind: expect.anything() }) }),
    );
  });
  it('reports duplicate-page nonprogress as incomplete instead of looping forever', async () => {
    const ids = Array.from({ length: 50 }, (_, index) => `author:${index}`);
    vi.mocked(NexusPostStreamService.fetch).mockResolvedValue({ post_keys: ids, last_post_score: null });
    vi.mocked(NexusPostStreamService.fetchByIds).mockResolvedValue(ids.map((id) => ({ details: { id } })) as never);
    expect((await EventkyAttendanceService.fetch('author:event')).complete).toBe(false);
    expect(NexusPostStreamService.fetch).toHaveBeenCalledTimes(2);
  });
});

function hydrated(id: string, kind = 'attendance') {
  const [author, postId] = id.split(':');
  return {
    details: { author, id: postId, uri: `pubky://${author}/pub/pubky.app/posts/${postId}`, kind, content: kind },
  };
}
it('scans past a full attendance-only page to preserve later discussion', async () => {
  const statuses = Array.from({ length: 50 }, (_, index) => `author:${index}`);
  vi.mocked(NexusPostStreamService.fetch)
    .mockResolvedValueOnce({ post_keys: statuses, last_post_score: null })
    .mockResolvedValueOnce({ post_keys: ['author:comment'], last_post_score: null });
  vi.mocked(NexusPostStreamService.fetchByIds).mockImplementation(
    async ({ post_ids }) =>
      post_ids.map((id) => hydrated(id, id.endsWith('comment') ? 'short' : 'attendance')) as never,
  );
  const result = await EventkyAttendanceService.fetchReplies('author:event');
  expect(result.complete).toBe(true);
  expect(result.sources.filter((source) => source.kind !== 'attendance').map((source) => source.id)).toEqual([
    'comment',
  ]);
  expect(NexusPostStreamService.fetch).toHaveBeenLastCalledWith(
    expect.objectContaining({ params: expect.objectContaining({ skip: 50 }) }),
  );
});
it('returns raw continuation at the work cap and never invents complete counts', async () => {
  vi.mocked(NexusPostStreamService.fetch).mockImplementation(async ({ params }) => ({
    post_keys: Array.from({ length: 50 }, (_, index) => `author:${Number(params.skip) + index}`),
    last_post_score: null,
  }));
  vi.mocked(NexusPostStreamService.fetchByIds).mockImplementation(
    async ({ post_ids }) => post_ids.map((id) => hydrated(id)) as never,
  );
  const result = await EventkyAttendanceService.fetchReplies('author:event');
  expect(result).toMatchObject({ complete: false, nextSkip: 1000 });
  expect(result.sources).toHaveLength(1000);
});
it('deduplicates hydrated identities and exposes missing records as partial', async () => {
  vi.mocked(NexusPostStreamService.fetch).mockResolvedValue({
    post_keys: ['author:a', 'author:b'],
    last_post_score: null,
  });
  vi.mocked(NexusPostStreamService.fetchByIds).mockResolvedValue([hydrated('author:a'), hydrated('author:a')] as never);
  const result = await EventkyAttendanceService.fetchReplies('author:event');
  expect(result.complete).toBe(false);
  expect(result.sources).toHaveLength(1);
});
