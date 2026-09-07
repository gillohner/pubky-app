import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostCountsModel } from '@/models/post/counts/postCounts';
import { PostTagsModel } from '@/models/post/tags/postTags';
import type { NexusTag } from '@/services/nexus/nexus.types';
import { NexusPostService } from '@/services/nexus/post/post';
import { usePostTags } from './usePostTags';

const tags = (count: number, offset = 0): NexusTag[] =>
  Array.from({ length: count }, (_, i) => ({
    label: `tag-${offset + i}`,
    taggers: [],
    taggers_count: 1,
    relationship: false,
  }));
describe('usePostTags - Integration', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('keeps three visible tags without mount requests, paginates by server offset and stops at the end', async () => {
    await PostTagsModel.upsert({ id: 'author:post', tags: tags(3) });
    await PostCountsModel.upsert({ id: 'author:post', tags: 20, unique_tags: 20, replies: 0, reposts: 0 });
    const fetch = vi.spyOn(NexusPostService, 'getPostTags').mockResolvedValueOnce(tags(3, 3)).mockResolvedValueOnce([]);
    const first = renderHook(() => usePostTags('author:post'));
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    expect(first.result.current.tags).toHaveLength(3);
    expect(fetch).not.toHaveBeenCalled();
    await act(() => Promise.all([first.result.current.loadMore(), first.result.current.loadMore()]));
    await waitFor(() => expect(first.result.current.tags).toHaveLength(6));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 3, limit: 3 }));
    await act(() => first.result.current.loadMore());
    await waitFor(() => expect(first.result.current.hasMore).toBe(false));
    expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 6, limit: 3 }));
    first.unmount();
    const second = renderHook(() => usePostTags('author:post'));
    await waitFor(() => expect(second.result.current.tags).toHaveLength(6));
    expect(second.result.current.hasMore).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
