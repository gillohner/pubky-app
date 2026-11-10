'use client';
import { useEventkyReplies } from '@/hooks/useEventkyReplies/useEventkyReplies';
import { useMutedUsers } from '@/hooks/useMutedUsers/useMutedUsers';

/** Discussion counts refer only to resolved non-status replies, never Nexus's combined reply count. */
export function useEventkyDiscussion(eventId: string | null | undefined) {
  const replies = useEventkyReplies(eventId);
  const { mutedUserIdSet } = useMutedUsers();
  const ids = new Set<string>();
  for (const source of replies.sources) {
    if (source.kind !== 'attendance' && !mutedUserIdSet.has(source.author)) ids.add(`${source.author}:${source.id}`);
  }
  return { ...replies, replyIds: [...ids] };
}
