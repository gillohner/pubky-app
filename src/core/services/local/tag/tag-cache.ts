import type { Table } from 'dexie';
import { db } from '@/database/franky/franky';
import { DatabaseErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { PostCountsModel } from '@/models/post/counts/postCounts';
import { PostTagsModel } from '@/models/post/tags/postTags';
import type { NexusModelTuple } from '@/models/shared/base/tuple/baseTuple.type';
import type { TagCollectionModelSchema } from '@/models/shared/tag/tag.schema';
import { getTagCursor } from '@/models/shared/tag/tag.utils';
import { UserCountsModel } from '@/models/user/counts/userCounts';
import { UserTagsModel } from '@/models/user/tags/userTags';
import { reconcileTagCounts, reconcileTagWindow } from '@/pipes/tag/tag-cache';
import type { NexusPostCounts, NexusTag, NexusUserCounts } from '@/services/nexus/nexus.types';

export type TagPreviewGuard = {
  revisions?: Map<string, number | null>;
  isCurrent?: () => boolean;
  viewerId?: string | null;
};

export type TagEntity = { kind: 'post' | 'user'; id: string };

/** Shared persistence for tag previews and paginated lists. */
export class LocalTagCacheService {
  private static table({ kind }: TagEntity) {
    return kind === 'post' ? PostTagsModel.table : UserTagsModel.table;
  }

  static async read(entity: TagEntity): Promise<TagCollectionModelSchema<string> | null> {
    const model = entity.kind === 'post' ? PostTagsModel : UserTagsModel;
    return model.findById(entity.id);
  }

  static async findStale(kind: TagEntity['kind'], ids: string[], ttlMs: number) {
    const model = kind === 'post' ? PostTagsModel : UserTagsModel;
    const records = await model.findByIdsPreserveOrder(ids);
    const now = Date.now();
    return ids.filter((_, index) => {
      const cache = records[index]?.cache;
      return cache !== undefined && now - cache.fetchedAt > ttlMs && (cache.retryAt ?? 0) <= now;
    });
  }

  static async captureRevisions(kind: TagEntity['kind'], ids: string[]): Promise<Map<string, number | null>> {
    const model = kind === 'post' ? PostTagsModel : UserTagsModel;
    const records = await model.findByIdsPreserveOrder(ids);
    return new Map(ids.map((id, index) => [id, records[index] ? (records[index].cache?.revision ?? 0) : null]));
  }

  static async invalidate(entity: TagEntity, isCurrent?: () => boolean) {
    const table = this.table(entity);
    await this.write(table.name, () =>
      db.transaction('rw', table, async () => {
        const existing = await table.get(entity.id);
        if (isCurrent && !isCurrent()) return;
        await table.put({
          id: entity.id,
          tags: [],
          ...existing,
          cache: {
            ...existing?.cache,
            ...(!existing ? { initialized: false } : {}),
            cursor: getTagCursor(existing),
            exhausted: false,
            fetchedAt: 0,
            retryAt: undefined,
            revision: (existing?.cache?.revision ?? 0) + 1,
          },
        });
      }),
    );
  }

  /** Retain the loaded window and defer only its failed background request. */
  static async deferRefresh(
    entity: TagEntity,
    options: { revision: number | null; retryAt: number; isCurrent?: () => boolean },
  ) {
    const table = this.table(entity);
    await this.write(table.name, () =>
      db.transaction('rw', table, async () => {
        const existing = await table.get(entity.id);
        if (options.isCurrent && !options.isCurrent()) return;
        if (!existing || (existing.cache?.revision ?? 0) !== options.revision) return;
        await table.put({
          ...existing,
          cache: {
            ...existing.cache,
            cursor: getTagCursor(existing),
            exhausted: existing.cache?.exhausted ?? false,
            fetchedAt: 0,
            revision: existing.cache?.revision ?? 0,
            retryAt: options.retryAt,
          },
        });
      }),
    );
  }

  static async savePreviews(
    kind: TagEntity['kind'],
    entries: NexusModelTuple<NexusTag[]>[],
    guard: TagPreviewGuard = {},
    counts: NexusModelTuple<NexusPostCounts | NexusUserCounts>[] = [],
  ) {
    const table = this.table({ kind, id: '' });
    const countsTable: Table<(NexusPostCounts | NexusUserCounts) & { id: string }> =
      kind === 'post' ? PostCountsModel.table : UserCountsModel.table;
    const incomingCounts = new Map(counts);
    await this.write(table.name, () =>
      db.transaction('rw', table, countsTable, async () => {
        for (const [id, tags] of entries) {
          const existing = await table.get(id);
          if (guard.isCurrent && !guard.isCurrent()) return;
          const revision = existing ? (existing.cache?.revision ?? 0) : null;
          const superseded = !!guard.revisions && revision !== (guard.revisions.get(id) ?? null);
          const totals = incomingCounts.get(id);
          if (totals) {
            const previousCounts = await countsTable.get(id);
            const tagCounts =
              superseded && previousCounts
                ? { tags: previousCounts.tags, unique_tags: previousCounts.unique_tags }
                : reconcileTagCounts(totals, tags, existing, previousCounts, guard.viewerId ?? undefined, Date.now());
            if (guard.isCurrent && !guard.isCurrent()) return;
            await countsTable.put({ ...totals, ...tagCounts, id });
          }
          const foreignPreview =
            (guard.viewerId == null && existing?.cache?.viewerId != null) ||
            Object.values(existing?.mutations ?? {}).some(
              (mutation) => mutation.expiresAt > Date.now() && mutation.viewerId !== guard.viewerId,
            );
          if (superseded || foreignPreview) continue;
          // A preview cannot establish which labels disappeared from an expanded list.
          // Keep that window until its full refresh succeeds (including when offline).
          if (getTagCursor(existing) > tags.length) continue;
          await table.put({
            id,
            ...reconcileTagWindow(tags, existing, Date.now(), guard.viewerId ?? undefined),
            cache: {
              cursor: tags.length,
              exhausted: totals !== undefined && totals.unique_tags <= tags.length,
              fetchedAt: Date.now(),
              viewerId: guard.viewerId ?? null,
              revision: (existing?.cache?.revision ?? 0) + 1,
            },
          });
        }
      }),
    );
  }

  static async savePage(
    entity: TagEntity,
    tags: TagCollectionModelSchema<string>['tags'],
    options: {
      skip: number;
      limit: number;
      revision: number | null;
      viewerId?: string;
      isCurrent?: () => boolean;
    },
  ) {
    const table = this.table(entity);
    return this.write(table.name, () =>
      db.transaction('rw', table, async () => {
        const existing = await table.get(entity.id);
        // A newer batch/page won the race. Never overwrite it with an older response.
        if (options.isCurrent && !options.isCurrent()) return false;
        const revision = existing ? (existing.cache?.revision ?? 0) : null;
        if (
          revision !== options.revision &&
          !(options.revision === null && existing?.cache?.initialized === false && existing.cache.revision === 0)
        )
          return false;
        const merged = new Map(
          (options.skip ? (existing?.tags ?? []) : []).map((tag) => [tag.label.toLowerCase(), tag]),
        );
        for (const tag of tags) merged.set(tag.label.toLowerCase(), tag);
        await table.put({
          id: entity.id,
          ...reconcileTagWindow([...merged.values()], existing, Date.now(), options.viewerId),
          cache: {
            cursor: options.skip + tags.length,
            exhausted: tags.length < options.limit,
            fetchedAt: options.skip ? (existing?.cache?.fetchedAt ?? Date.now()) : Date.now(),
            viewerId: options.viewerId ?? null,
            revision: (existing?.cache?.revision ?? 0) + 1,
          },
        });
        return true;
      }),
    );
  }
  private static async write<T>(table: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (cause) {
      throw Err.database(DatabaseErrorCode.WRITE_FAILED, 'Failed to persist tag cache', {
        service: ErrorService.Local,
        operation: 'persistTagCache',
        context: { table },
        cause,
      });
    }
  }
}
