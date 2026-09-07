import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserCountsModel } from '@/models/user/counts/userCounts';
import { UserTagsModel } from '@/models/user/tags/userTags';
import type { NexusTag } from '@/services/nexus/nexus.types';
import { NexusUserService } from '@/services/nexus/user/user';
import { useTagged } from './useTagged';

const tags = (count: number, offset = 0): NexusTag[] =>
  Array.from({ length: count }, (_, i) => ({
    label: `tag-${offset + i}`,
    taggers: [],
    taggers_count: 1,
    relationship: false,
  }));
describe('useTagged - Integration', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('renders a cached preview, loads more from its server offset, and reuses the expanded list on revisit', async () => {
    await UserTagsModel.upsert({ id: 'profile', tags: tags(5) });
    await UserCountsModel.upsert({
      id: 'profile',
      tagged: 0,
      tags: 30,
      unique_tags: 30,
      posts: 0,
      replies: 0,
      following: 0,
      followers: 0,
      friends: 0,
      collections: 0,
      bookmarks: 0,
    });
    const fetch = vi.spyOn(NexusUserService, 'tags').mockResolvedValue(tags(20, 5));
    const first = renderHook(() => useTagged('profile'));
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    expect(first.result.current.tags).toHaveLength(5);
    expect(first.result.current.hasMore).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    await act(() => first.result.current.loadMore());
    await waitFor(() => expect(first.result.current.tags).toHaveLength(25));
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ skip_tags: 5, limit_tags: 20 }));
    first.unmount();
    const second = renderHook(() => useTagged('profile'));
    await waitFor(() => expect(second.result.current.tags).toHaveLength(25));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not show the previous profile tags while switching profiles', async () => {
    await UserTagsModel.upsert({ id: 'profile', tags: tags(1) });
    vi.spyOn(NexusUserService, 'tags').mockResolvedValue([]);
    const { result, rerender } = renderHook((id) => useTagged(id, { enableStats: false }), {
      initialProps: 'profile',
    });
    await waitFor(() => expect(result.current.tags).toHaveLength(1));

    rerender('other-profile');
    expect(result.current.tags).toEqual([]);
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.tags).toEqual([]);
  });
});
