import { baseUriBuilder } from 'pubky-app-specs';
import { FOLLOW_SYNC_PATH } from '@/config/follow-sync';
import { isCanonicalPubky } from '@/libs/utils/pubky';
import type { Pubky } from '@/models/models.types';
import { HomeserverFollowService } from '@/services/homeserver/follow';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { LocalFollowSyncService } from '@/services/local/follow/followSync';
import { followSyncGuard } from '@/services/local/follow/followSyncGuard';

export class FollowSyncApplication {
  static async getFollowingCount(viewerId: Pubky): Promise<number | null> {
    return (await LocalFollowSyncService.readFollowing(viewerId))?.length ?? null;
  }

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
    const version = await followSyncGuard.capture(viewerId);
    if (signal.aborted || version === null) return false;
    const baseDirectory = `${baseUriBuilder(viewerId)}follows/`;
    const uris = await HomeserverService.listAll({ baseDirectory, signal });
    const following = uris
      .filter((uri) => uri.startsWith(baseDirectory))
      .map((uri) => uri.slice(baseDirectory.length))
      .filter(isCanonicalPubky);
    return LocalFollowSyncService.apply({ viewerId, following, version, signal });
  }

  static async refreshRelationships(viewerId: Pubky, userIds: Pubky[], signal: AbortSignal): Promise<boolean> {
    // A different window may have cleared the shared database since the checkpoint was captured.
    if ((await LocalFollowSyncService.readFollowing(viewerId)) === null) {
      return this.refreshFollowing(viewerId, signal);
    }
    const version = await followSyncGuard.capture(viewerId);
    if (signal.aborted || version === null) return false;
    const changes = await HomeserverFollowService.readRelationships(viewerId, userIds, signal, () =>
      followSyncGuard.isCurrent(viewerId, version),
    );
    if (!changes) return false;
    return LocalFollowSyncService.apply({ viewerId, changes, version, signal });
  }
}
