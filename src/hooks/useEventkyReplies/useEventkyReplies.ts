'use client';
import { useEffect, useRef, useState } from 'react';
import type { AttendanceSource } from '@eventky/attendance';
import { useLiveQuery } from 'dexie-react-hooks';
import { getNexusUrl } from '@/config/nexus';
import { EventkyAttendanceController } from '@/controllers/eventkyAttendance/eventkyAttendance';
import { PostController } from '@/controllers/post/post';
import { usePostCounts } from '@/hooks/usePostCounts/usePostCounts';
import { isPostDeleted } from '@/libs/utils/utils';
import type { EventkyReplyBatch } from '@/services/eventkyAttendance/eventkyAttendance';
import { useAuthStore } from '@/stores/auth/auth.store';
import {
  EMPTY_PENDING_EVENTKY_REPLIES,
  eventkyReplyContext,
  useEventkyReplyWritesStore,
} from '@/stores/eventkyReplyWrites/eventkyReplyWrites.store';

const EMPTY: EventkyReplyBatch = { sources: [], posts: [], complete: false, nextSkip: null };

/** Shared read boundary for roster and discussion. Native local replies remain immediately visible. */
export function useEventkyReplies(eventId: string | null | undefined) {
  const viewer = useAuthStore((state) => state.currentUserPubky);
  const context = eventkyReplyContext(getNexusUrl(), viewer, eventId ?? '');
  const pendingIds = useEventkyReplyWritesStore((state) => state.pending[context] ?? EMPTY_PENDING_EVENTKY_REPLIES);
  const [snapshot, setSnapshot] = useState<{ id: string; batch: EventkyReplyBatch }>();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const generation = useRef(0);
  const busy = useRef(false);
  const { postCounts } = usePostCounts(eventId);
  const batch = snapshot && snapshot.id === context ? snapshot.batch : EMPTY;
  const localIds = [...new Set([...pendingIds, ...batch.sources.map((source) => `${source.author}:${source.id}`)])];
  const localKey = JSON.stringify([context, localIds]);
  const local = useLiveQuery(
    async () => {
      if (!eventId) return { key: localKey, sources: [] };
      const details = await PostController.getDetailsByIds({ compositeIds: localIds });
      const sources = details.flatMap((post) => {
        if (!post) return [];
        const [author, id] = post.id.split(':');
        return [{ ...post, id, author } satisfies AttendanceSource];
      });
      return { key: localKey, sources };
    },
    [localKey],
    { key: '', sources: [] as AttendanceSource[] },
  );

  useEffect(() => {
    const current = ++generation.current;
    busy.current = false;
    if (!eventId) return;
    setLoading(true);
    setFailed(false);
    void EventkyAttendanceController.fetchReplies(eventId)
      .then((result) => {
        if (generation.current === current) setSnapshot({ id: context, batch: result });
      })
      .catch(() => {
        if (generation.current === current) setFailed(true);
      })
      .finally(() => {
        if (generation.current === current) setLoading(false);
      });
    return () => {
      // This is a request generation counter, not a rendered DOM ref: invalidate outstanding work on cleanup.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
    };
  }, [eventId, context, postCounts?.replies, version]);

  useEffect(() => {
    if (!eventId) return;
    const refresh = () => setVersion((value) => value + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [eventId]);

  async function loadMore() {
    if (!eventId || batch.nextSkip === null || busy.current || loading) return;
    const current = generation.current;
    busy.current = true;
    setLoading(true);
    setFailed(false);
    try {
      const next = await EventkyAttendanceController.fetchReplies(eventId, batch.nextSkip);
      if (generation.current !== current) return;
      setSnapshot({ id: context, batch: { ...next, sources: [...batch.sources, ...next.sources] } });
    } catch {
      if (generation.current === current) setFailed(true);
    } finally {
      if (generation.current === current) {
        busy.current = false;
        setLoading(false);
      }
    }
  }
  const merged = new Map(batch.sources.map((source) => [source.uri, source]));
  if (local.key === localKey) {
    for (const source of local.sources) {
      // Only explicitly tracked native creates may override indexed content.
      if (pendingIds.includes(`${source.author}:${source.id}`)) merged.set(source.uri, source);
      if (isPostDeleted(source.content)) merged.delete(source.uri);
    }
  }
  const sources = [...merged.values()]
    .filter((source) => !isPostDeleted(source.content))
    .sort((a, b) => a.id.localeCompare(b.id) || a.author.localeCompare(b.author));
  return {
    sources,
    complete: batch.complete && !loading && !failed,
    loading: loading || (!!eventId && snapshot?.id !== context && !failed),
    failed,
    hasMore: batch.nextSkip !== null,
    loadMore,
    refresh: () => setVersion((value) => value + 1),
  };
}
