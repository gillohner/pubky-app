import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationApplication } from '@/application/notification/notification';
import { TagCacheApplication } from '@/application/tag/tag-cache';
import { TtlApplication } from '@/application/ttl/ttl';
import { NotificationController } from '@/controllers/notification/notification';
import { TagCacheController } from '@/controllers/tag/tag-cache';
import { TtlController } from '@/controllers/ttl/ttl';
import { NotificationType } from '@/models/notification/notification.types';
import { PostCountsModel } from '@/models/post/counts/postCounts';
import { PostTagsModel } from '@/models/post/tags/postTags';
import { TagModel } from '@/models/shared/tag/tag';
import { UserCountsModel } from '@/models/user/counts/userCounts';
import { UserTagsModel } from '@/models/user/tags/userTags';
import { UserTtlModel } from '@/models/user/ttl/userTtl';
import { LocalStreamPostsService } from '@/services/local/stream/posts/posts';
import { LocalStreamUsersService } from '@/services/local/stream/users/users';
import { LocalPostTagService } from '@/services/local/tag/post/tag.post';
import { LocalTagCacheService } from '@/services/local/tag/tag-cache';
import { LocalUserTagService } from '@/services/local/tag/user/tag.user';
import type { NexusTag } from '@/services/nexus/nexus.types';
import type { NexusUser } from '@/services/nexus/nexus.types';
import { NexusUserStreamService } from '@/services/nexus/stream/users/userStream';
import { NexusUserService } from '@/services/nexus/user/user';
import { useAuthStore } from '@/stores/auth/auth.store';

const user = { kind: 'user', id: 'profile', viewerId: undefined } as const;
const tags = (count: number, offset = 0): NexusTag[] =>
  Array.from({ length: count }, (_, i) => ({
    label: `tag-${offset + i}`,
    taggers: ['other'],
    taggers_count: 1,
    relationship: false,
  }));
const profile = (preview: NexusTag[], total = 40): NexusUser => ({
  details: { id: user.id, name: 'Profile', bio: '', links: null, status: null, image: null, indexed_at: 1 },
  counts: {
    tagged: 0,
    tags: total,
    unique_tags: total,
    posts: 0,
    replies: 0,
    following: 0,
    followers: 0,
    friends: 0,
    collections: 0,
    bookmarks: 0,
  },
  tags: preview,
  relationship: { following: false, followed_by: false },
});

describe('tag cache through the controller', () => {
  beforeEach(() => vi.restoreAllMocks());

  it.each([0, 20])('loads a cold public profile once and reuses its %i tags on revisit', async (count) => {
    const fetch = vi.spyOn(NexusUserService, 'tags').mockResolvedValue(tags(count));
    await Promise.all([TagCacheController.getOrFetch(user), TagCacheController.getOrFetch(user)]);
    expect((await TagCacheController.get(user))?.tags).toEqual(tags(count));
    await TagCacheController.getOrFetch(user);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ user_id: user.id, skip_tags: 0, limit_tags: 20 }));
  });

  it.each([5, 10])(
    'paginates from a %i-tag preview, deduplicates concurrent loads and stops at an empty page',
    async (count) => {
      await UserTagsModel.upsert({ id: user.id, tags: tags(count) });
      const fetch = vi.spyOn(NexusUserService, 'tags').mockResolvedValueOnce(tags(20, count)).mockResolvedValue([]);
      await Promise.all([TagCacheController.getOrFetchNext(user), TagCacheController.getOrFetchNext(user)]);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect((await TagCacheController.get(user))?.tags).toHaveLength(count + 20);
      expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ skip_tags: count, limit_tags: 20 }));
      await TagCacheController.getOrFetchNext(user);
      await TagCacheController.getOrFetchNext(user);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect((await TagCacheController.get(user))?.cache?.exhausted).toBe(true);
    },
  );

  it('keeps an expanded list during batch hydration and refreshes its entire window, including deletions', async () => {
    const fetch = vi.spyOn(NexusUserService, 'tags').mockResolvedValue(tags(20));
    await TagCacheController.getOrFetch(user);
    await LocalStreamUsersService.persistUsers([profile(tags(5))]);
    expect((await TagCacheController.get(user))?.tags).toHaveLength(20);
    const fresh = tags(20, 1); // tag-0 was deleted; tag-20 now fills the loaded window
    vi.spyOn(NexusUserStreamService, 'fetchByIds').mockResolvedValue([profile(fresh.slice(0, 5))]);
    fetch.mockResolvedValue(fresh);
    await TtlController.forceRefreshUsersByIds({ userIds: [user.id] });
    expect((await TagCacheController.get(user))?.tags).toEqual(fresh);
  });

  it('preserves optimistic additions and removals when a delayed batch response arrives', async () => {
    await LocalStreamUsersService.persistUsers([profile([{ ...tags(1)[0], taggers: ['viewer'], relationship: true }])]);
    await UserCountsModel.upsert({ id: 'viewer', ...profile([]).counts });
    await LocalUserTagService.delete({ taggedId: user.id, taggerId: 'viewer', label: 'tag-0' });
    await LocalUserTagService.create({ taggedId: user.id, taggerId: 'viewer', label: 'new' });
    await LocalStreamUsersService.persistUsers([profile([{ ...tags(1)[0], taggers: ['viewer'], relationship: true }])]);
    expect((await TagCacheController.get(user))?.tags.map((t) => t.label)).toEqual(['new']);
    expect((await TagCacheController.get(user))?.cache?.cursor).toBe(1);
  });

  it('preserves total post tag counts when a local mutation edits a partial preview', async () => {
    const id = 'author:post';
    await PostTagsModel.upsert({ id, tags: tags(5) });
    await PostCountsModel.upsert({ id, tags: 60, unique_tags: 30, replies: 0, reposts: 0 });
    await UserCountsModel.upsert({ id: 'viewer', ...profile([]).counts });
    await LocalPostTagService.create({ taggedId: id, taggerId: 'viewer', label: 'new' });
    expect(await PostCountsModel.findById(id)).toMatchObject({ tags: 61, unique_tags: 31 });
    await LocalPostTagService.delete({ taggedId: id, taggerId: 'viewer', label: 'new' });
    expect(await PostCountsModel.findById(id)).toMatchObject({ tags: 60, unique_tags: 30 });
  });

  it('retries an expired expanded tag window even when the surrounding profile has just refreshed', async () => {
    const fetch = vi.spyOn(NexusUserService, 'tags').mockResolvedValue(tags(20));
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    await TagCacheController.getOrFetch(user);
    vi.spyOn(Date, 'now').mockReturnValue(10000);
    await UserTtlModel.upsert({ id: user.id, lastUpdatedAt: Date.now() });
    fetch.mockResolvedValue(tags(20, 1));
    expect(await TtlController.findStaleUsersByIds({ userIds: [user.id], ttlMs: 5000 })).toEqual([user.id]);
  });

  it('refreshes a cached profile once for duplicate tag notifications', async () => {
    await LocalStreamUsersService.persistUsers([profile(tags(5))]);
    const fetch = vi.spyOn(NexusUserService, 'tags').mockResolvedValue(tags(6));
    vi.spyOn(NexusUserStreamService, 'fetchByIds').mockResolvedValue([profile(tags(5))]);
    const notification = {
      timestamp: Date.now(),
      body: { type: NotificationType.TagProfile, tagged_by: user.id, tag_label: 'tag-5' },
    };
    await NotificationApplication.fetchMissingEntities({
      notifications: [notification, notification],
      viewerId: user.id,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await TagCacheController.get(user))?.tags).toHaveLength(6);
  });

  it('does not cache a response from a session that ended while it was loading', async () => {
    const original = useAuthStore.getState().currentUserPubky;
    let resolve!: (value: NexusTag[]) => void;
    const response = new Promise<NexusTag[]>((done) => {
      resolve = done;
    });
    const fetch = vi.spyOn(NexusUserService, 'tags').mockReturnValue(response);
    const request = TagCacheController.getOrFetch(user);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    useAuthStore.setState({ currentUserPubky: 'another-viewer' });
    resolve(tags(20));
    await request;
    expect(await TagCacheController.get(user)).toBeNull();
    useAuthStore.setState({ currentUserPubky: original });
  });

  it('loads missing server tags even when the viewer created a tag locally first', async () => {
    await UserCountsModel.upsert({ id: 'viewer', ...profile([]).counts });
    await LocalUserTagService.create({ taggedId: user.id, taggerId: 'viewer', label: 'new' });
    vi.spyOn(NexusUserService, 'tags').mockResolvedValue(tags(5));
    await TagCacheController.getOrFetch({ ...user, viewerId: 'viewer' });
    expect((await TagCacheController.get(user))?.tags.map((tag) => tag.label)).toEqual([
      ...tags(5).map((tag) => tag.label),
      'new',
    ]);
  });
  it('keeps newer tags when an older TTL batch finishes last', async () => {
    await LocalStreamUsersService.persistUsers([profile(tags(5))]);
    let resolve!: (value: NexusUser[]) => void;
    const batch = vi.spyOn(NexusUserStreamService, 'fetchByIds').mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const pending = TtlController.forceRefreshUsersByIds({ userIds: [user.id] });
    await vi.waitFor(() => expect(batch).toHaveBeenCalled());
    const fresh = tags(5, 10);
    vi.spyOn(NexusUserService, 'tags').mockResolvedValue(fresh);
    await TagCacheApplication.forceRefresh(user);
    resolve([profile(tags(5))]);
    await pending;
    expect((await TagCacheController.get(user))?.tags).toEqual(fresh);
  });

  it('refreshes again when a notification invalidates an in-flight tag refresh', async () => {
    await UserTagsModel.upsert({ id: user.id, tags: tags(20) });
    let resolve!: (value: NexusTag[]) => void;
    const fetch = vi
      .spyOn(NexusUserService, 'tags')
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      )
      .mockResolvedValue(tags(20, 1));
    const pending = TagCacheApplication.forceRefresh({ ...user, viewerId: user.id });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    vi.spyOn(NexusUserStreamService, 'fetchByIds').mockResolvedValue([profile(tags(5))]);
    const invalidate = vi.spyOn(LocalTagCacheService, 'invalidate');
    const notification = NotificationApplication.fetchMissingEntities({
      notifications: [
        { timestamp: Date.now(), body: { type: NotificationType.TagProfile, tagged_by: user.id, tag_label: 'tag-20' } },
      ],
      viewerId: user.id,
    });
    await vi.waitFor(async () => expect((await TagCacheController.get(user))?.cache?.fetchedAt).toBe(0));
    expect(invalidate).toHaveBeenCalled();
    resolve(tags(20));
    await Promise.all([pending, notification]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await TagCacheController.get(user))?.tags).toEqual(tags(20, 1));
  });

  it.each(['hydration', 'tags'])('ignores notification %s that completes after account replacement', async (phase) => {
    const original = useAuthStore.getState().currentUserPubky;
    useAuthStore.setState({ currentUserPubky: user.id });
    const notification = {
      timestamp: Date.now(),
      body: { type: NotificationType.TagProfile, tagged_by: user.id, tag_label: 'new' },
    };
    vi.spyOn(NexusUserService, 'notifications').mockResolvedValue([notification]);
    let resolveBatch!: (value: NexusUser[]) => void;
    let resolveTags!: (value: NexusTag[]) => void;
    const batch = vi.spyOn(NexusUserStreamService, 'fetchByIds').mockImplementation(() =>
      phase === 'hydration'
        ? new Promise((done) => {
            resolveBatch = done;
          })
        : Promise.resolve([profile(tags(5))]),
    );
    const fetch = vi.spyOn(NexusUserService, 'tags').mockImplementation(() =>
      phase === 'tags'
        ? new Promise((done) => {
            resolveTags = done;
          })
        : Promise.resolve(tags(6)),
    );
    try {
      const pending = NotificationController.fetchNotifications({ userId: user.id });
      await vi.waitFor(() => expect(phase === 'hydration' ? batch : fetch).toHaveBeenCalled());
      const before = (await TagCacheController.get(user))?.tags ?? null;
      useAuthStore.setState({ currentUserPubky: 'another-viewer' });
      if (phase === 'hydration') resolveBatch([profile(tags(5))]);
      else resolveTags(tags(6));
      await pending;
      expect((await TagCacheController.get(user))?.tags ?? null).toEqual(before);
    } finally {
      useAuthStore.setState({ currentUserPubky: original });
    }
  });
  it('revalidates a viewerless preview before using authenticated relationships', async () => {
    await LocalStreamUsersService.persistUsers([profile(tags(1), 1)]);
    const mine = [{ ...tags(1)[0], taggers: ['viewer'], relationship: true }];
    const fetch = vi.spyOn(NexusUserService, 'tags').mockResolvedValue(mine);
    await TagCacheController.getOrFetch({ ...user, viewerId: 'viewer' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await TagCacheController.get(user))?.tags[0].relationship).toBe(true);
  });

  it('reuses an authenticated batch preview without a per-entity request', async () => {
    vi.spyOn(NexusUserStreamService, 'fetchByIds').mockResolvedValue([profile(tags(5))]);
    await TtlController.forceRefreshUsersByIds({ userIds: [user.id], viewerId: 'viewer' });
    const fetch = vi.spyOn(NexusUserService, 'tags').mockResolvedValue(tags(5));
    await TagCacheController.getOrFetch({ ...user, viewerId: 'viewer' });
    expect((await TagCacheController.get(user))?.cache?.viewerId).toBe('viewer');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the server offset of a legacy preview through a local addition', async () => {
    await UserTagsModel.upsert({ id: user.id, tags: tags(5) });
    await UserCountsModel.upsert({ id: user.id, ...profile([]).counts });
    await UserCountsModel.upsert({ id: 'viewer', ...profile([]).counts });
    await LocalUserTagService.create({ taggedId: user.id, taggerId: 'viewer', label: 'new' });
    const fetch = vi.spyOn(NexusUserService, 'tags').mockResolvedValue(tags(20, 5));
    await TagCacheController.getOrFetchNext(user);
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ skip_tags: 5 }));
    expect((await TagCacheController.get(user))?.tags).toHaveLength(26);
  });

  it('keeps optimistic counts through a stale batch and a subsequent removal', async () => {
    await LocalStreamUsersService.persistUsers([profile(tags(1), 1)]);
    await UserCountsModel.upsert({ id: 'viewer', ...profile([]).counts });
    await LocalUserTagService.create({ taggedId: user.id, taggerId: 'viewer', label: 'new' });
    vi.spyOn(NexusUserStreamService, 'fetchByIds').mockResolvedValue([profile(tags(1), 1)]);
    await TtlController.forceRefreshUsersByIds({ userIds: [user.id], viewerId: 'viewer' });
    expect(await UserCountsModel.table.get(user.id)).toMatchObject({ tags: 2, unique_tags: 2 });
    await LocalUserTagService.delete({ taggedId: user.id, taggerId: 'viewer', label: 'new' });
    expect(await UserCountsModel.table.get(user.id)).toMatchObject({ tags: 1, unique_tags: 1 });
  });

  it('does not reject successful TTL hydration when one expanded tag endpoint fails', async () => {
    await UserTagsModel.upsert({ id: user.id, tags: tags(20) });
    vi.spyOn(NexusUserStreamService, 'fetchByIds').mockResolvedValue([profile(tags(5))]);
    vi.spyOn(NexusUserService, 'tags').mockRejectedValue(new Error('offline'));
    await expect(TtlApplication.forceRefreshUsersByIds({ userIds: [user.id] })).resolves.toEqual([user.id]);
    expect((await TagCacheController.get(user))?.tags).toHaveLength(20);
  });

  it('uses complete forced hydration for a tag notification without another GET', async () => {
    await LocalStreamUsersService.persistUsers([profile(tags(1), 1)]);
    vi.spyOn(NexusUserStreamService, 'fetchByIds').mockResolvedValue([profile(tags(2), 2)]);
    const fetch = vi.spyOn(NexusUserService, 'tags').mockResolvedValue(tags(2));
    await NotificationApplication.fetchMissingEntities({
      notifications: [
        { timestamp: Date.now(), body: { type: NotificationType.TagProfile, tagged_by: user.id, tag_label: 'tag-1' } },
      ],
      viewerId: user.id,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect((await TagCacheController.get(user))?.tags).toEqual(tags(2));
  });

  it('does not double a protected tag when a viewerless preview already includes the local tagger', async () => {
    await LocalStreamUsersService.persistUsers([profile([], 0)]);
    await UserCountsModel.upsert({ id: 'viewer', ...profile([]).counts });
    await LocalUserTagService.create({ taggedId: user.id, taggerId: 'viewer', label: 'new' });
    await LocalStreamUsersService.persistUsers([
      profile([{ label: 'new', taggers: ['viewer'], taggers_count: 1, relationship: false }], 1),
    ]);
    expect((await TagCacheController.get(user))?.tags[0]).toMatchObject({ taggers_count: 1, relationship: true });
  });

  it("does not apply another viewer's local relationship to an explicit page refresh", async () => {
    await LocalStreamUsersService.persistUsers([profile([], 0)]);
    await UserCountsModel.upsert({ id: 'viewer', ...profile([]).counts });
    await LocalUserTagService.create({ taggedId: user.id, taggerId: 'viewer', label: 'new' });
    const remote = [{ label: 'new', taggers: ['viewer'], taggers_count: 1, relationship: false }];
    vi.spyOn(NexusUserService, 'tags').mockResolvedValue(remote);
    await TagCacheController.getOrFetch({ ...user, viewerId: 'other-viewer' });
    expect((await TagCacheController.get(user))?.tags).toEqual(remote);
  });
  it.each(['post', 'user'] as const)(
    'keeps %s counts and pagination when a partial preview cannot acknowledge a local label',
    async (kind) => {
      const id = kind === 'post' ? 'author:post' : user.id;
      const entity = { kind, id };
      const persist = async (preview: NexusTag[], total: number) => {
        if (kind === 'post') {
          await LocalStreamPostsService.persistPosts({
            posts: [
              {
                details: {
                  id: 'post',
                  author: 'author',
                  content: '',
                  indexed_at: 1,
                  kind: 'note',
                  uri: '',
                  attachments: null,
                },
                counts: { tags: total, unique_tags: total, replies: 0, reposts: 0 },
                tags: preview.map((tag) => new TagModel(tag)),
                relationships: { replied: null, reposted: null, mentioned: [] },
                bookmark: null,
              },
            ],
            tagGuard: { viewerId: 'viewer' },
          });
        } else await LocalStreamUsersService.persistUsers([profile(preview, total)], { viewerId: 'viewer' });
      };
      await persist(tags(5), 6);
      await UserCountsModel.upsert({ id: 'viewer', ...profile([]).counts });
      const local = kind === 'post' ? LocalPostTagService : LocalUserTagService;
      await local.create({ taggedId: id, taggerId: 'viewer', label: 'new' });
      await persist(tags(5), 6); // sixth remote label is still beyond this preview
      const counts = kind === 'post' ? await PostCountsModel.table.get(id) : await UserCountsModel.table.get(id);
      const record = await TagCacheController.get(entity);
      expect(counts).toMatchObject({ tags: 7, unique_tags: 7 });
      expect(record?.tags.length).toBe(6);
      expect(record?.cache?.cursor).toBe(5);
      expect(record?.cache?.exhausted).toBe(false);
      await local.delete({ taggedId: id, taggerId: 'viewer', label: 'new' });
      const after = kind === 'post' ? await PostCountsModel.table.get(id) : await UserCountsModel.table.get(id);
      expect(after).toMatchObject({ tags: 6, unique_tags: 6 });
    },
  );

  it('keeps pagination available when a stale profile grows during a local tag edit', async () => {
    await LocalStreamUsersService.persistUsers([profile(tags(1, 99), 1)], { viewerId: 'viewer' });
    await UserCountsModel.upsert({ id: 'viewer', ...profile([]).counts });
    await LocalUserTagService.create({ taggedId: user.id, taggerId: 'viewer', label: 'tag-99' });

    await LocalStreamUsersService.persistUsers([profile(tags(5), 40)], { viewerId: 'viewer' });
    const counts = await UserCountsModel.table.get(user.id);
    const record = await TagCacheController.get(user);
    expect(counts).toMatchObject({ tags: 40, unique_tags: 40 });
    expect(record?.cache).toMatchObject({ cursor: 5, exhausted: false });
    expect(record!.tags.length).toBeLessThan(counts!.unique_tags);

    const fetch = vi.spyOn(NexusUserService, 'tags').mockResolvedValue(tags(20, 5));
    await TagCacheController.getOrFetchNext({ ...user, viewerId: 'viewer' });
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ skip_tags: 5, limit_tags: 20 }));
  });

  it('only retries the failed expanded window after a mixed TTL batch', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000000);
    const healthy = { ...profile(tags(5), 5), details: { ...profile([]).details, id: 'healthy' } };
    await UserTagsModel.upsert({ id: user.id, tags: tags(20) });
    vi.spyOn(NexusUserStreamService, 'fetchByIds').mockResolvedValue([profile(tags(5)), healthy]);
    vi.spyOn(NexusUserService, 'tags').mockRejectedValue(new Error('offline'));
    await TtlController.forceRefreshUsersByIds({ userIds: [user.id, 'healthy'] });
    expect(await TtlController.findStaleUsersByIds({ userIds: [user.id, 'healthy'], ttlMs: 1000 })).toEqual([user.id]);
    expect((await TagCacheController.get(user))?.tags).toHaveLength(20);
  });

  it('falls back to tags when a notification batch omits its target', async () => {
    await LocalStreamUsersService.persistUsers([profile(tags(1), 1)], { viewerId: user.id });
    vi.spyOn(NexusUserStreamService, 'fetchByIds').mockResolvedValue([]);
    const fetch = vi.spyOn(NexusUserService, 'tags').mockResolvedValue(tags(2));
    await NotificationApplication.fetchMissingEntities({
      notifications: [
        { timestamp: Date.now(), body: { type: NotificationType.TagProfile, tagged_by: user.id, tag_label: 'tag-1' } },
      ],
      viewerId: user.id,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await TagCacheController.get(user))?.tags).toEqual(tags(2));
  });

  it('rejects hydration started before a notification invalidates a missing tag record', async () => {
    let resolveOld!: (value: NexusUser[]) => void;
    let resolveNew!: (value: NexusUser[]) => void;
    const batch = vi
      .spyOn(NexusUserStreamService, 'fetchByIds')
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveNew = resolve;
        }),
      );
    const fetch = vi.spyOn(NexusUserService, 'tags').mockResolvedValue(tags(2));
    const old = TtlController.forceRefreshUsersByIds({ userIds: [user.id], viewerId: user.id });
    await vi.waitFor(() => expect(batch).toHaveBeenCalledTimes(1));
    const notification = NotificationApplication.fetchMissingEntities({
      notifications: [
        { timestamp: Date.now(), body: { type: NotificationType.TagProfile, tagged_by: user.id, tag_label: 'tag-1' } },
      ],
      viewerId: user.id,
    });
    await vi.waitFor(() => expect(batch).toHaveBeenCalledTimes(2));
    resolveOld([profile(tags(1), 1)]);
    await old;
    resolveNew([profile(tags(2), 2)]);
    await notification;
    expect((await TagCacheController.get(user))?.tags).toEqual(tags(2));
    expect(fetch).not.toHaveBeenCalled();
  });
});
