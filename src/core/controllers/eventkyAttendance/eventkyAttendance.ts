import { EventkyAttendanceApplication } from '@/application/eventkyAttendance/eventkyAttendance';
import { PostApplication } from '@/application/post/post';
import { getNexusUrl } from '@/config/nexus';
import { useAuthStore } from '@/stores/auth/auth.store';
import { eventkyReplyContext, useEventkyReplyWritesStore } from '@/stores/eventkyReplyWrites/eventkyReplyWrites.store';

export class EventkyAttendanceController {
  private static pending = new Map<string, ReturnType<typeof this.readReplies>>();

  static fetchReplies(eventId: string, skip = 0) {
    const viewer = useAuthStore.getState().currentUserPubky;
    const context = eventkyReplyContext(getNexusUrl(), viewer, eventId);
    const key = JSON.stringify([context, skip]);
    const previous = this.pending.get(key);
    if (previous) return previous;
    const request = this.readReplies(eventId, skip, viewer, context).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }

  private static async readReplies(eventId: string, skip: number, viewer: string | null | undefined, context: string) {
    const batch = await EventkyAttendanceApplication.fetchReplies(eventId, skip, viewer);
    const currentContext = () => eventkyReplyContext(getNexusUrl(), useAuthStore.getState().currentUserPubky, eventId);
    if (context !== currentContext()) return batch;
    const expected = useEventkyReplyWritesStore.getState().expected[context] ?? {};
    const result = await PostApplication.persistEventkyReplies(batch, viewer, expected);
    if (context === currentContext())
      useEventkyReplyWritesStore.getState().acknowledge(context, result.acknowledged, expected);
    return result;
  }

  static fetch(eventId: string) {
    return EventkyAttendanceApplication.fetch(eventId);
  }
}
