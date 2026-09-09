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
