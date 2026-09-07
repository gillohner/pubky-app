import { DB_NAME } from '@/config/database';
import { db } from '@/database/franky/franky';
import type { Pubky } from '@/models/models.types';
import { UserConnectionsModel } from '@/models/user/connections/userConnections';

export type FollowSyncVersion = string | undefined | null;

/** Web Locks release automatically when a window closes; revisions survive across windows. */
export class FollowSyncGuard {
  private lockName(viewerId: Pubky) {
    return `${DB_NAME}:follow-mutation:${viewerId}`;
  }

  private async advance(viewerId: Pubky): Promise<void> {
    await db.transaction('rw', UserConnectionsModel.table, async () => {
      const connections = await UserConnectionsModel.findById(viewerId);
      await UserConnectionsModel.upsert({
        id: viewerId,
        following: [],
        followers: [],
        ...connections,
        followingRevision: crypto.randomUUID(),
      });
    });
  }

  async capture(viewerId: Pubky): Promise<FollowSyncVersion> {
    return navigator.locks.request(this.lockName(viewerId), { ifAvailable: true }, async (lock) =>
      lock ? (await UserConnectionsModel.findById(viewerId))?.followingRevision : null,
    );
  }

  async isCurrent(viewerId: Pubky, version: FollowSyncVersion): Promise<boolean> {
    return version !== null && (await UserConnectionsModel.findById(viewerId))?.followingRevision === version;
  }

  async runMutation<T>(viewerId: Pubky, work: () => Promise<T>, signal?: AbortSignal): Promise<T | undefined> {
    // Mutations can proceed together. Only the short reconciliation write is exclusive.
    return navigator.locks.request(this.lockName(viewerId), { mode: 'shared' }, async () => {
      if (signal?.aborted) return;
      await this.advance(viewerId);
      if (signal?.aborted) return;
      return work();
    });
  }

  async tryApply(viewerId: Pubky, work: () => Promise<boolean>): Promise<boolean> {
    return navigator.locks.request(this.lockName(viewerId), { ifAvailable: true }, (lock) => (lock ? work() : false));
  }
}

export const followSyncGuard = new FollowSyncGuard();
