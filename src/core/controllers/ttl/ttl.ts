import { TtlApplication } from '@/application/ttl/ttl';
import { captureViewerSession } from '@/controllers/tag/tag-cache.utils';
import type { Pubky } from '@/models/models.types';

export class TtlController {
  private constructor() {}

  static async findStalePostsByIds(params: { postIds: string[]; ttlMs: number }): Promise<string[]> {
    return await TtlApplication.findStalePostsByIds(params);
  }

  static async findStaleUsersByIds(params: { userIds: Pubky[]; ttlMs: number }): Promise<Pubky[]> {
    return await TtlApplication.findStaleUsersByIds(params);
  }

  static async forceRefreshPostsByIds(params: {
    postIds: string[];
    viewerId?: Pubky;
    isCurrent?: () => boolean;
  }): Promise<void> {
    return await TtlApplication.forceRefreshPostsByIds({ ...params, isCurrent: captureViewerSession() });
  }

  static async forceRefreshUsersByIds(params: {
    userIds: Pubky[];
    viewerId?: Pubky;
    isCurrent?: () => boolean;
  }): Promise<void> {
    return await TtlApplication.forceRefreshUsersByIds({ ...params, isCurrent: captureViewerSession() });
  }
}
