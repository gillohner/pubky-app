import { baseUriBuilder, followUriBuilder } from 'pubky-app-specs';
import { FOLLOW_SYNC_CONCURRENCY, FOLLOW_SYNC_PATH } from '@/config/follow-sync';
import { isPubkyIdentifier } from '@/libs/utils/utils';
import type { Pubky } from '@/models/models.types';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { LocalFollowSyncService } from '@/services/local/follow/followSync';
import { followSyncGuard } from '@/services/local/follow/followSyncGuard';

export class FollowSyncApplication {
  static getStatus(viewerId: Pubky) {
    return LocalFollowSyncService.getStatus(viewerId);
  }

  static fetchCursor(viewerId: Pubky): Promise<string> {
    return HomeserverService.fetchUserEventStreamCursor({ userZ32: viewerId, pathPrefix: FOLLOW_SYNC_PATH });
  }

  static subscribe(viewerId: Pubky, cursor: string) {
    return HomeserverService.subscribeUserEventStreamForPath({
      userZ32: viewerId,
      cursor,
      pathPrefix: FOLLOW_SYNC_PATH,
    });
  }

  static async refreshFollowing(viewerId: Pubky, signal: AbortSignal): Promise<boolean> {
    const version = followSyncGuard.capture();
    if (signal.aborted || !followSyncGuard.canApply(viewerId, version)) return false;
    const uris = await HomeserverService.listAll({ baseDirectory: `${baseUriBuilder(viewerId)}follows/` });
    const following = uris.map((uri) => uri.slice(uri.lastIndexOf('/') + 1)).filter(isPubkyIdentifier);
    return LocalFollowSyncService.apply({ viewerId, following, version, signal });
  }

  static async refreshRelationships(viewerId: Pubky, userIds: Pubky[], signal: AbortSignal): Promise<boolean> {
    const version = followSyncGuard.capture();
    if (signal.aborted || !followSyncGuard.canApply(viewerId, version)) return false;
    const changes = new Map<Pubky, boolean>();
    const uniqueIds = [...new Set(userIds)];
    // Bound parallel reads; a burst must not open a request for every event at once.
    for (let index = 0; index < uniqueIds.length; index += FOLLOW_SYNC_CONCURRENCY) {
      if (signal.aborted) return false;
      await Promise.all(
        uniqueIds.slice(index, index + FOLLOW_SYNC_CONCURRENCY).map(async (id) => {
          changes.set(id, await HomeserverService.exists(followUriBuilder(viewerId, id)));
        }),
      );
    }
    return LocalFollowSyncService.apply({ viewerId, changes, version, signal });
  }
}
