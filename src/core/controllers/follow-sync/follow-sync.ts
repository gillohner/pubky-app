import { FollowSyncApplication } from '@/application/follow-sync/follow-sync';
import type { Pubky } from '@/models/models.types';

/** System entry points. The coordinator cancels its account-scoped signal on logout/account changes. */
export class FollowSyncController {
  static getFollowingCount(viewerId: Pubky) {
    return FollowSyncApplication.getFollowingCount(viewerId);
  }

  static getStatus(viewerId: Pubky) {
    return FollowSyncApplication.getStatus(viewerId);
  }

  static fetchCursor(viewerId: Pubky) {
    return FollowSyncApplication.fetchCursor(viewerId);
  }

  static subscribeFollowing(viewerId: Pubky, cursor: string) {
    return FollowSyncApplication.subscribe(viewerId, cursor);
  }

  static refreshFollowing(viewerId: Pubky, signal: AbortSignal) {
    return FollowSyncApplication.refreshFollowing(viewerId, signal);
  }

  static refreshRelationships(viewerId: Pubky, userIds: Pubky[], signal: AbortSignal) {
    return FollowSyncApplication.refreshRelationships(viewerId, userIds, signal);
  }
}
