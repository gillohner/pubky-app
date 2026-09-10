import type { AttendanceSource } from '@eventky/attendance';
import { getNexusUrl } from '@/config/nexus';
import type { NexusPostWithAttachmentMetadata } from '@/services/nexus/nexus.types';
import { NexusPostStreamService } from '@/services/nexus/stream/posts/postStream';
import { StreamOrder, StreamSource } from '@/services/nexus/stream/posts/postStream.types';

export interface EventkyReplyBatch {
  sources: AttendanceSource[];
  posts: NexusPostWithAttachmentMetadata[];
  complete: boolean;
  nextSkip: number | null;
}

export class EventkyAttendanceService {
  // Collapse concurrent attendance/discussion/count reads, without retaining stale responses.
  private static pending = new Map<string, Promise<EventkyReplyBatch>>();

  static fetchReplies(eventId: string, skip = 0, viewerId?: string | null): Promise<EventkyReplyBatch> {
    const key = JSON.stringify([getNexusUrl(), viewerId ?? null, eventId, skip]);
    const pending = this.pending.get(key);
    if (pending) return pending;
    const request = this.readReplies(eventId, skip, viewerId).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }

  /** Scan through status-only pages; the cursor always counts raw replies, not visible comments. */
  private static async readReplies(
    eventId: string,
    initialSkip: number,
    viewerId?: string | null,
  ): Promise<EventkyReplyBatch> {
    const [author_id, post_id] = eventId.split(':');
    const sources: AttendanceSource[] = [];
    const hydrated: NexusPostWithAttachmentMetadata[] = [];
    const seen = new Set<string>();
    let missing = false;
    for (let skip = initialSkip; skip < initialSkip + 1000; skip += 50) {
      const page = await NexusPostStreamService.fetch({
        invokeEndpoint: StreamSource.REPLIES,
        params: { limit: 50, skip, order: StreamOrder.ASCENDING },
        extraParams: { author_id, post_id },
      });
      const ids = [...new Set(page.post_keys)].filter((id) => !seen.has(id));
      ids.forEach((id) => seen.add(id));
      if (ids.length) {
        const posts = await NexusPostStreamService.fetchByIds({
          post_ids: ids,
          ...(viewerId ? { viewer_id: viewerId } : {}),
        });
        const valid = new Map(
          posts
            .filter((post) => ids.includes(`${post.details.author}:${post.details.id}`))
            .map((post) => [`${post.details.author}:${post.details.id}`, post]),
        );
        hydrated.push(...valid.values());
        sources.push(...[...valid.values()].map((post) => post.details));
        missing ||= valid.size !== ids.length;
      }
      if (page.post_keys.length < 50) return { sources, posts: hydrated, complete: !missing, nextSkip: null };
      if (!ids.length) return { sources, posts: hydrated, complete: false, nextSkip: null };
    }
    return { sources, posts: hydrated, complete: false, nextSkip: missing ? null : initialSkip + 1000 };
  }

  static async fetch(eventId: string) {
    const { sources, complete } = await this.fetchReplies(eventId);
    return { sources: sources.filter((source) => source.kind === 'attendance'), complete };
  }
}
