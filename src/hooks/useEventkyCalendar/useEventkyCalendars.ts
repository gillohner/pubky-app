'use client';

import { useEffect, useRef, useState } from 'react';
import { type CalendarContent, parseEventkyContent } from '@eventky/contract';
import { PostController } from '@/controllers/post/post';
import { FORCE_FETCH_NEW_POSTS } from '@/controllers/stream/posts/post.constants';
import { StreamPostsController } from '@/controllers/stream/posts/posts';
import { useAuthStore } from '@/stores/auth/auth.store';

export interface DiscoveredCalendar {
  id: string;
  uri: string;
  name: string;
  calendar: CalendarContent;
}

/** Discover native calendar posts through the same moderated, paginated stream as the feed. */
export function useEventkyCalendars() {
  const viewerId = useAuthStore((state) => state.currentUserPubky);
  const [calendars, setCalendars] = useState<DiscoveredCalendar[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const cursor = useRef<{ streamTail?: number; lastPostId?: string }>({});
  const generation = useRef(0);

  useEffect(() => {
    cursor.current = {};
    setCalendars([]);
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
          const streamId = 'timeline:all:calendar' as const;
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
          streamId: 'timeline:all:calendar',
          limit: 20,
          ...cursor.current,
        });
        const options = await Promise.all(
          result.nextPageIds.map(async (id) => {
            // Calendar membership is editable policy: refresh it before offering a publish destination.
            const refreshed = await PostController.fetch({ compositeId: id, viewerId: viewerId ?? undefined });
            if (!refreshed) return null;
            const post = await PostController.getDetails({ compositeId: id });
            if (!post || post.is_blurred) return null;
            const parsed = parseEventkyContent(post.kind, post.content);
            if (parsed.status !== 'supported' || parsed.kind !== 'calendar') return null;
            return {
              id,
              uri: `pubky://${id.replace(':', '/pub/pubky.app/posts/')}`,
              name: parsed.value.name,
              calendar: parsed.value,
            };
          }),
        );
        if (!active || currentGeneration !== generation.current) return;
        cursor.current = {
          streamTail: result.nextCursor,
          lastPostId: result.lastRawPostId ?? result.nextPageIds.at(-1),
        };
        setCalendars((previous) => [
          ...new Map(
            [...previous, ...options.filter((option) => option !== null)].map((option) => [option.uri, option]),
          ).values(),
        ]);
        setHasMore(!result.reachedEnd && result.nextCursor !== undefined);
      } catch {
        if (active) setError('Calendars could not be loaded. Try again.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [viewerId, page]);

  return {
    calendars,
    isLoading,
    error,
    hasMore,
    loadMore: () => {
      if (!isLoading) setPage((value) => value + 1);
    },
  };
}
