import type { AttendanceSource } from '@eventky/attendance';
import { NexusPostStreamService } from '@/services/nexus/stream/posts/postStream';
import { StreamOrder, StreamSource } from '@/services/nexus/stream/posts/postStream.types';

export class EventkyAttendanceService {
  /** Nexus reply streams reject kind filters, so filter hydrated records locally. Bounded indexed discovery. The explicit completeness flag prevents capped counts appearing authoritative. */
  static async fetch(eventId: string) {
    const [author_id, post_id] = eventId.split(':');
    const sources: AttendanceSource[] = [];
    const seen = new Set<string>();
    for (let skip = 0; skip < 1000; skip += 50) {
      const page = await NexusPostStreamService.fetch({
        invokeEndpoint: StreamSource.REPLIES,
        params: { limit: 50, skip, order: StreamOrder.DESCENDING },
        extraParams: { author_id, post_id },
      });
      const ids = page.post_keys.filter((id) => !seen.has(id));
      ids.forEach((id) => seen.add(id));
      if (ids.length) {
        const posts = await NexusPostStreamService.fetchByIds({ post_ids: ids });
        sources.push(...posts.filter((post) => post.details.kind === 'attendance').map((post) => post.details));
        if (posts.length !== ids.length) return { sources, complete: false };
      }
      if (page.post_keys.length < 50) return { sources, complete: true };
      if (!ids.length) break;
    }
    return { sources, complete: false };
  }
}
