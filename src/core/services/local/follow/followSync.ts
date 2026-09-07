import { db } from '@/database/franky/franky';
import { ErrorService } from '@/libs/error/error.types';
import { toAppError } from '@/libs/error/error.utils';
import type { Pubky } from '@/models/models.types';
import { UserStreamModel } from '@/models/stream/user/userStream';
import type { UserStreamId } from '@/models/stream/user/userStream.types';
import { UserConnectionsModel } from '@/models/user/connections/userConnections';
import { UserCountsModel } from '@/models/user/counts/userCounts';
import { UserRelationshipsModel } from '@/models/user/relationships/userRelationships';
import { postStreamDirtyRegistry } from '@/services/local/stream/posts/postStreamDirtyRegistry';
import type { NexusUserCounts } from '@/services/nexus/nexus.types';
import { followSyncGuard } from './followSyncGuard';

export type FollowSyncUpdate = {
  viewerId: Pubky;
  version: number;
  signal: AbortSignal;
} & ({ following: Pubky[]; changes?: never } | { changes: Map<Pubky, boolean>; following?: never });

/** Stores the account's authoritative following set without adding a second database/cache. */
export class LocalFollowSyncService {
  static async getStatus(viewerId: Pubky) {
    const following = await this.readFollowing(viewerId);
    if (!following) return null;
    const cached = await UserStreamModel.findById(`${viewerId}:following`);
    return { total: following.length, loaded: cached?.stream.length ?? 0 };
  }

  static async getFollowingSlice(
    viewerId: Pubky,
    skip: number,
    limit: number,
    nexusPage?: { ids: Pubky[]; replaceCache: boolean },
  ) {
    try {
      return await db.transaction('rw', [UserConnectionsModel.table, UserStreamModel.table], async () => {
        const streamId = `${viewerId}:following` as UserStreamId;
        const cached = await UserStreamModel.findById(streamId);
        const authoritative = await this.readFollowing(viewerId);
        if (!authoritative) {
          if (!nexusPage) return null;
          const stream = nexusPage.replaceCache
            ? nexusPage.ids
            : [...new Set([...(cached?.stream ?? []), ...nexusPage.ids])];
          await UserStreamModel.upsert(streamId, stream);
          return {
            nextPageIds: nexusPage.ids,
            skip: skip + nexusPage.ids.length,
            isExhausted: nexusPage.ids.length < limit,
          };
        }
        // Local follows prepend to the displayed stream. Keep that prefix before paginating the remainder.
        const set = new Set(authoritative);
        const prefix = (cached?.stream ?? []).filter((id) => set.has(id));
        const orderChanged = prefix.some((id, index) => id !== authoritative[index]);
        const following = orderChanged ? [...new Set([...prefix, ...authoritative])] : authoritative;
        if (orderChanged) await UserConnectionsModel.update(viewerId, { following });
        const offset = cached ? Math.min(skip, prefix.length) : skip;
        const nextPageIds = following.slice(offset, offset + limit);
        // A smaller consumer must not rewind the shared cache used by an already paginated list.
        const stream = following.slice(0, Math.max(prefix.length, offset + limit));
        if (
          !cached ||
          cached.stream.length !== stream.length ||
          stream.some((id, index) => id !== cached.stream[index])
        ) {
          await UserStreamModel.upsert(streamId, stream);
        }
        return {
          nextPageIds,
          skip: offset + nextPageIds.length,
          isExhausted: offset + nextPageIds.length >= following.length,
        };
      });
    } catch (error) {
      throw toAppError(error, ErrorService.Local, 'getFollowingSlice');
    }
  }

  static async upsertCounts(userId: Pubky, counts: NexusUserCounts): Promise<void> {
    try {
      await db.transaction('rw', [UserConnectionsModel.table, UserCountsModel.table], async () => {
        const following = await this.readFollowing(userId);
        await UserCountsModel.upsert({ id: userId, ...counts, ...(following ? { following: following.length } : {}) });
      });
    } catch (error) {
      throw toAppError(error, ErrorService.Local, 'upsertFollowingCounts');
    }
  }

  static async readFollowing(viewerId: Pubky): Promise<Pubky[] | null> {
    const record = await UserConnectionsModel.findById(viewerId);
    return record?.followingSyncedAt !== undefined ? record.following : null;
  }

  static async apply(update: FollowSyncUpdate): Promise<boolean> {
    const { viewerId, version, signal } = update;
    try {
      return await db.transaction(
        'rw',
        [UserConnectionsModel.table, UserRelationshipsModel.table, UserCountsModel.table, UserStreamModel.table],
        async () => {
          if (signal.aborted || !followSyncGuard.canApply(viewerId, version)) return false;
          const connections = await UserConnectionsModel.findById(viewerId);
          const streamId = `${viewerId}:following` as UserStreamId;
          const cached = await UserStreamModel.findById(streamId);
          if (update.changes && connections?.followingSyncedAt === undefined) return false;

          const snapshot = update.following ? new Set(update.following) : null;
          const priorOrder =
            connections?.followingSyncedAt !== undefined ? connections.following : (cached?.stream ?? []);
          const following = snapshot
            ? new Set([...priorOrder.filter((id) => snapshot.has(id)), ...snapshot])
            : new Set(connections?.following ?? []);
          for (const [id, value] of update.changes ?? []) {
            if (value) following.add(id);
            else following.delete(id);
          }

          // Full reconciliation only on startup/recovery; live events touch their bounded batch of users.
          const relationships = update.following
            ? await UserRelationshipsModel.table.toArray()
            : await UserRelationshipsModel.findByIds([...update.changes.keys()]);
          const byId = new Map(relationships.map((row) => [row.id, row]));
          const affected = new Set(update.following ? [...byId.keys(), ...following] : update.changes.keys());
          const changed = [...affected].filter((id) => byId.get(id)?.following !== following.has(id));
          if (signal.aborted || !followSyncGuard.canApply(viewerId, version)) return false;
          if (
            update.changes &&
            !changed.length &&
            following.size === connections?.following.length &&
            connections.following.every((id) => following.has(id))
          )
            return true;

          await UserConnectionsModel.upsert({
            id: viewerId,
            followers: connections?.followers ?? [],
            following: [...following],
            followingSyncedAt: Date.now(),
          });
          if (changed.length) {
            await UserRelationshipsModel.bulkSave(
              changed.map((id) => [
                id,
                { following: following.has(id), followed_by: byId.get(id)?.followed_by ?? false },
              ]),
            );
          }
          await UserCountsModel.update(viewerId, { following: following.size });

          // Keep the loaded portion of the list consistent without mounting every followed user.
          if (cached) {
            const stream = cached.stream.filter((id) => following.has(id));
            if (stream.join(',') !== cached.stream.join(',')) await UserStreamModel.upsert(streamId, stream);
          }
          // Friends are derived from both directions; rebuild this cache on its next load.
          if (changed.some((id) => byId.get(id)?.followed_by)) {
            await UserStreamModel.deleteById(`${viewerId}:friends`);
            postStreamDirtyRegistry.markDirty('friends');
          }
          if (changed.length) postStreamDirtyRegistry.markDirty('follow_graph');
          return true;
        },
      );
    } catch (error) {
      throw toAppError(error, ErrorService.Local, 'reconcileFollowing');
    }
  }
}
