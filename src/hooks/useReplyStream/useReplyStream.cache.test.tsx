import { renderHook, waitFor } from '@testing-library/react';
import { liveQuery } from 'dexie';
import { beforeEach, expect, it, vi } from 'vitest';
import { StreamPostsController } from '@/controllers/stream/posts/posts';
import { usePostCounts } from '@/hooks/usePostCounts/usePostCounts';
import { usePostDetails } from '@/hooks/usePostDetails/usePostDetails';
import { usePostTags } from '@/hooks/usePostTags/usePostTags';
import { PostCountsModel } from '@/models/post/counts/postCounts';
import { PostDetailsModel } from '@/models/post/details/postDetails';
import { PostTagsModel } from '@/models/post/tags/postTags';
import { TagModel } from '@/models/shared/tag/tag';
import { buildPostReplyStreamId } from '@/models/stream/post/postStream.types';
import type { NexusPost } from '@/services/nexus/nexus.types';
import { NexusPostService } from '@/services/nexus/post/post';
import { NexusPostStreamService } from '@/services/nexus/stream/posts/postStream';
import { StreamOrder } from '@/services/nexus/stream/posts/postStream.types';
import { NexusUserStreamService } from '@/services/nexus/stream/users/userStream';

beforeEach(() => vi.restoreAllMocks());

it('publishes cold reply IDs after grouped hydration, so mounting replies needs no individual requests', async () => {
  const parent = 'author:parent';
  const streamId = buildPostReplyStreamId(parent);
  const reply: NexusPost = {
    details: {
      id: 'reply',
      author: 'author',
      content: 'A reply',
      indexed_at: 1000,
      kind: 'short',
      attachments: null,
      uri: 'pubky://author/pub/pubky.app/posts/reply',
    },
    counts: { replies: 0, tags: 1, unique_tags: 1, reposts: 0 },
    tags: [new TagModel({ label: 'example', taggers: [], taggers_count: 1, relationship: false })],
    relationships: { replied: 'pubky://author/pub/pubky.app/posts/parent', reposted: null, mentioned: [] },
    bookmark: null,
  };
  vi.spyOn(NexusPostStreamService, 'fetch').mockResolvedValue({ post_keys: ['author:reply'], last_post_score: null });
  vi.spyOn(NexusUserStreamService, 'fetchByIds').mockResolvedValue([]);
  let resolve!: (posts: NexusPost[]) => void;
  const batch = vi.spyOn(NexusPostStreamService, 'fetchByIds').mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const tagFetch = vi.spyOn(NexusPostService, 'getPostTags').mockResolvedValue(reply.tags);
  const incomplete: string[] = [];
  const observer = liveQuery(async () => {
    const stream = await StreamPostsController.getLocalStream({ streamId });
    for (const id of stream?.stream ?? []) {
      const ready = await Promise.all([
        PostDetailsModel.findById(id),
        PostCountsModel.findById(id),
        PostTagsModel.findById(id),
      ]);
      if (ready.some((record) => !record)) incomplete.push(id);
    }
  }).subscribe();
  try {
    const request = StreamPostsController.getOrFetchStreamSlice({
      streamId,
      streamTail: 0,
      limit: 3,
      order: StreamOrder.ASCENDING,
    });
    await vi.waitFor(() => expect(batch).toHaveBeenCalledTimes(1));
    const prematurelyPublished = (await StreamPostsController.getLocalStream({ streamId }))?.stream ?? [];
    resolve([reply]);
    await request;
    expect(prematurelyPublished).toEqual([]);
    expect(incomplete).toEqual([]);
    const hooks = renderHook(() => ({
      details: usePostDetails('author:reply'),
      counts: usePostCounts('author:reply'),
      tags: usePostTags('author:reply'),
    }));
    await waitFor(() => expect(hooks.result.current.tags.tags).toHaveLength(1));
    await waitFor(() => expect(hooks.result.current.details.isLoading).toBe(false));
    expect(hooks.result.current.counts.postCounts?.tags).toBe(1);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(tagFetch).not.toHaveBeenCalled();
    hooks.unmount();
  } finally {
    observer.unsubscribe();
  }
});
