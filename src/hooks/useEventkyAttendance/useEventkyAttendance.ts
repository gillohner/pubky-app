'use client';
import { useEffect, useRef, useState } from 'react';
import { type AttendanceSource, type AttendanceStatus, resolveAttendance } from '@eventky/attendance';
import { occurrenceKey } from '@eventky/temporal';
import type { CalendarTime } from '@eventky/types';
import { PostController } from '@/controllers/post/post';
import type { TPreparedPostCreate } from '@/controllers/post/post.types';
import { useEventkyReplies } from '@/hooks/useEventkyReplies/useEventkyReplies';
import { toast } from '@/molecules/Toaster/toast';
import { useAuthStore } from '@/stores/auth/auth.store';

export function useEventkyAttendance(eventId: string, eventUid: string, recurrenceId?: CalendarTime) {
  const author = useAuthStore((state) => state.currentUserPubky);
  const replies = useEventkyReplies(eventId);
  const { loading, failed } = replies;
  const [optimistic, setOptimistic] = useState<AttendanceSource[]>([]);
  const [busy, setBusy] = useState(false);
  const context = JSON.stringify([author, eventId, eventUid, recurrenceId ? occurrenceKey(recurrenceId) : null]);
  const currentContext = useRef<string | null>(context);
  useEffect(() => {
    currentContext.current = context;
    return () => {
      currentContext.current = null;
    };
  }, [context]);
  const [pendingState, setPendingState] = useState<{ context: string; status: AttendanceStatus }>();
  const pendingStatus = pendingState?.context === context ? pendingState.status : undefined;
  const pending = useRef(
    new Map<
      string,
      {
        author: string;
        status: AttendanceStatus;
        prepared: TPreparedPostCreate;
        source: AttendanceSource;
      }
    >(),
  );
  const lock = useRef(false);
  const [eventAuthor, postId] = eventId.split(':');
  const eventUri = `pubky://${eventAuthor}/pub/pubky.app/posts/${postId}`;
  useEffect(() => {
    setOptimistic((previous) => {
      const remaining = previous.filter(
        (source) =>
          !replies.sources.some((indexed) => indexed.uri === source.uri && indexed.content === source.content),
      );
      return remaining.length === previous.length ? previous : remaining;
    });
  }, [replies.sources]);
  const resolved = resolveAttendance([...replies.sources, ...optimistic], eventUri, eventUid, recurrenceId);
  const status = author ? resolved.get(author)?.response.partstat : undefined;
  const counts = { ACCEPTED: 0, TENTATIVE: 0, DECLINED: 0 };
  for (const item of resolved.values()) counts[item.response.partstat]++;
  async function respond(next: AttendanceStatus): Promise<boolean> {
    if (!author || loading || lock.current) return false;
    let draft = pending.current.get(context);
    if (draft && draft.status !== next) {
      toast({ title: 'Retry your previous response first', variant: 'info' });
      return false;
    }
    lock.current = true;
    setBusy(true);
    try {
      if (!draft) {
        const id = PostController.createPostId(author);
        const content = JSON.stringify({
          schema: 'eventky.attendance',
          schema_version: 1,
          event_uid: eventUid,
          partstat: next,
          dtstamp: new Date().toISOString(),
          ...(recurrenceId ? { recurrence_id: recurrenceId } : {}),
        });
        const prepared = await PostController.prepareCreate({
          authorId: author,
          postId: id,
          customKind: 'attendance',
          content,
          parentPostId: eventId,
        });
        draft = {
          author,
          status: next,
          prepared,
          source: {
            id,
            author,
            uri: `pubky://${author}/pub/pubky.app/posts/${id}`,
            parent: eventUri,
            kind: 'attendance',
            content,
          },
        };
        pending.current.set(context, draft);
      }
      if (currentContext.current !== context) return false;
      if (useAuthStore.getState().currentUserPubky !== author) return false;
      await PostController.commitPreparedCreate(draft.prepared);
      const source = draft.source;
      pending.current.delete(context);
      if (currentContext.current !== context) return true;
      setOptimistic((previous) => [...previous.filter((item) => item.uri !== source.uri), source]);
      setPendingState(undefined);
      toast({ title: 'Response saved' });
      return true;
    } catch {
      if (currentContext.current === context && draft) setPendingState({ context, status: draft.status });
      toast({ title: 'Could not save your response', description: 'Try the same response again.', variant: 'error' });
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return {
    pendingStatus,
    status,
    counts,
    busy,
    loading,
    failed,
    complete: replies.complete,
    attendees: [...resolved.entries()].map(([author, item]) => ({ author, status: item.response.partstat })),
    hasMore: replies.hasMore,
    loadMore: replies.loadMore,
    refresh: replies.refresh,
    signedIn: !!author,
    respond,
  };
}
