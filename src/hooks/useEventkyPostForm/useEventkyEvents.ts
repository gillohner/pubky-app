'use client';

import { useEffect, useRef, useState } from 'react';
import { type EventContent, parseEventkyContent } from '@eventky/contract';
import { PostController } from '@/controllers/post/post';
import { FORCE_FETCH_NEW_POSTS } from '@/controllers/stream/posts/post.constants';
import { StreamPostsController } from '@/controllers/stream/posts/posts';
import { useAuthStore } from '@/stores/auth/auth.store';

export interface DiscoveredEvent {
  id: string;
  uri: string;
  name: string;
  event: EventContent;
}

/** Discover native event posts through the same moderated, paginated stream as the feed. */
export function useEventkyEvents() {
  const viewerId = useAuthStore((state) => state.currentUserPubky);
  const [events, setEvents] = useState<DiscoveredEvent[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const cursor = useRef<{ streamTail?: number; lastPostId?: string }>({});
  const generation = useRef(0);

  useEffect(() => {
    cursor.current = {};
    setEvents([]);
    setPage(0);
    generation.current++;
  }, [viewerId]);

  useEffect(() => {
    let active = true;
    const currentGeneration = generation.current;
    setLoading(true);
    setError(undefined);
    void (async () => {
      try {
        if (!cursor.current.lastPostId && cursor.current.streamTail === undefined) {
          const streamId = 'timeline:all:event' as const;
          // Refresh new publications before reading the ordinary moderated, paginated cache.
          await StreamPostsController.prepareStreamForInitialLoad({ streamId });
          const streamHead = await StreamPostsController.getStreamHead({ streamId });
          await StreamPostsController.getOrFetchStreamSlice({
            streamId,
            streamHead: streamHead || FORCE_FETCH_NEW_POSTS,
            limit: 20,
          });
          await StreamPostsController.mergeUnreadStreamWithPostStream({ streamId });
        }
        const result = await StreamPostsController.getOrFetchStreamSlice({
          streamId: 'timeline:all:event',
          limit: 20,
          ...cursor.current,
        });
        const options = await Promise.all(
          result.nextPageIds.map(async (id) => {
            const refreshed = await PostController.fetch({ compositeId: id, viewerId: viewerId ?? undefined });
            if (!refreshed) return null;
            const post = await PostController.getDetails({ compositeId: id });
            if (!post || post.is_blurred) return null;
            const parsed = parseEventkyContent(post.kind, post.content);
            if (parsed.status !== 'supported' || parsed.kind !== 'event') return null;
            return {
              id,
              uri: `pubky://${id.replace(':', '/pub/pubky.app/posts/')}`,
              name: parsed.value.summary,
              event: parsed.value,
            };
          }),
        );
        if (!active || currentGeneration !== generation.current) return;
        cursor.current = {
          streamTail: result.nextCursor,
          lastPostId: result.lastRawPostId ?? result.nextPageIds.at(-1),
        };
        setEvents((previous) => [
          ...new Map(
            [...previous, ...options.filter((option) => option !== null)].map((option) => [option.uri, option]),
          ).values(),
        ]);
        setHasMore(!result.reachedEnd && result.nextCursor !== undefined);
      } catch {
        if (active) setError('Events could not be loaded. Try again.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [viewerId, page]);

  return {
    events,
    isLoading,
    error,
    hasMore,
    loadMore: () => {
      if (!isLoading) setPage((value) => value + 1);
    },
  };
}
