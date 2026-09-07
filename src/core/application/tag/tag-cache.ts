import { LocalTagCacheService, type TagEntity } from '@/services/local/tag/tag-cache';
import type { NexusTag } from '@/services/nexus/nexus.types';
import { NexusPostService } from '@/services/nexus/post/post';
import { NexusUserService } from '@/services/nexus/user/user';

export type TagRequest = TagEntity & { viewerId?: string; isCurrent?: () => boolean };

/** Owns loading policy; hooks only observe IndexedDB and request missing pages. */
export class TagCacheApplication {
  private static pending = new Map<
    string,
    { task: Promise<void>; mode: 'missing' | 'next' | 'refresh'; isCurrent?: () => boolean }
  >();

  static get(entity: TagEntity) {
    return LocalTagCacheService.read(entity);
  }

  static async getOrFetch(request: TagRequest): Promise<void> {
    return this.run(request, 'missing');
  }

  static async fetchNext(request: TagRequest): Promise<void> {
    return this.run(request, 'next');
  }

  static forceRefresh(request: TagRequest): Promise<void> {
    return this.run(request, 'refresh');
  }

  static async refreshExpanded(request: TagRequest, previewSize: number) {
    const cached = await this.get(request);
    if ((cached?.cache?.cursor ?? cached?.tags.length ?? 0) > previewSize) await this.forceRefresh(request);
  }

  private static run(request: TagRequest, mode: 'missing' | 'next' | 'refresh'): Promise<void> {
    const key = `${request.kind}:${request.id}:${request.viewerId ?? ''}`;
    const existing = this.pending.get(key);
    if (existing && (!existing.isCurrent || existing.isCurrent())) {
      if (mode === 'refresh' && existing.mode !== 'refresh') {
        return existing.task.catch(() => {}).then(() => this.run(request, mode));
      }
      return existing.task;
    }
    const task = this.load(request, mode).finally(() => {
      if (this.pending.get(key)?.task === task) this.pending.delete(key);
    });
    this.pending.set(key, { task, mode, isCurrent: request.isCurrent });
    return task;
  }

  private static async load(request: TagRequest, mode: 'missing' | 'next' | 'refresh', attempt = 0): Promise<void> {
    const existing = await this.get(request);
    if (request.isCurrent && !request.isCurrent()) return;
    const viewerChanged =
      existing?.cache?.viewerId !== undefined && existing.cache.viewerId !== (request.viewerId ?? null);
    if (viewerChanged) mode = 'refresh';
    if (
      existing &&
      existing.cache?.initialized !== false &&
      (mode === 'missing' || (mode === 'next' && existing.cache?.exhausted))
    )
      return;
    const cursor = existing?.cache?.cursor ?? existing?.tags.length ?? 0;
    const skip = mode === 'next' ? cursor : 0;
    const pageSize = request.kind === 'post' ? 3 : 20;
    const limit = mode === 'refresh' ? Math.max(pageSize, cursor) : pageSize;
    const tags: NexusTag[] = [];
    // Nexus limits each request to 100 tags. Refresh the loaded prefix atomically.
    while (tags.length < limit) {
      const size = Math.min(100, limit - tags.length);
      if (request.isCurrent && !request.isCurrent()) return;
      const page = await this.fetchPage(request, skip + tags.length, size, mode === 'refresh');
      tags.push(...page);
      if (page.length < size) break;
    }
    if (request.isCurrent && !request.isCurrent()) return;
    const saved = await LocalTagCacheService.savePage(request, tags, {
      skip,
      limit,
      revision: existing ? (existing.cache?.revision ?? 0) : null,
      viewerId: request.viewerId,
      isCurrent: request.isCurrent,
    });
    if (!saved && mode === 'refresh' && (!request.isCurrent || request.isCurrent())) {
      // Notifications can invalidate a running refresh; all joined callers share its retry.
      if (attempt < 2) await this.load(request, mode, attempt + 1);
      else await LocalTagCacheService.invalidate(request, request.isCurrent);
    }
  }

  private static async fetchPage(request: TagRequest, skip: number, limit: number, force: boolean) {
    return request.kind === 'post'
      ? await NexusPostService.getPostTags({
          compositeId: request.id,
          viewerId: request.viewerId,
          skip,
          limit,
          ...(force ? { force: true } : {}),
        })
      : await NexusUserService.tags({
          user_id: request.id,
          viewer_id: request.viewerId,
          skip_tags: skip,
          limit_tags: limit,
          ...(force ? { force: true } : {}),
        });
  }
}
