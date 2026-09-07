import { TagCacheApplication, type TagRequest } from '@/application/tag/tag-cache';
import { captureViewerSession } from '@/controllers/tag/tag-cache.utils';
import type { TagEntity } from '@/services/local/tag/tag-cache';

export class TagCacheController {
  static get(entity: TagEntity) {
    return TagCacheApplication.get(entity);
  }

  static getOrFetch(request: TagRequest) {
    return TagCacheApplication.getOrFetch({ ...request, isCurrent: captureViewerSession() });
  }

  static getOrFetchNext(request: TagRequest) {
    return TagCacheApplication.fetchNext({ ...request, isCurrent: captureViewerSession() });
  }
}
