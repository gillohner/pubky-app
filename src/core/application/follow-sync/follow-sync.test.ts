import { followUriBuilder } from 'pubky-app-specs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserStreamApplication } from '@/application/stream/users/users';
import { UserApplication } from '@/application/user/user';
import { HttpMethod } from '@/libs/http/http.types';
import { UserStreamModel } from '@/models/stream/user/userStream';
import { UserStreamTypes } from '@/models/stream/user/userStream.types';
import { UserConnectionsModel } from '@/models/user/connections/userConnections';
import { UserCountsModel } from '@/models/user/counts/userCounts';
import { UserRelationshipsModel } from '@/models/user/relationships/userRelationships';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { LocalFollowService } from '@/services/local/follow/follow';
import { LocalFollowSyncService } from '@/services/local/follow/followSync';
import { FollowSyncGuard, followSyncGuard } from '@/services/local/follow/followSyncGuard';
import { LocalProfileService } from '@/services/local/profile/profile';
import { LocalStreamUsersService } from '@/services/local/stream/users/users';
import { LocalUserService } from '@/services/local/user/user';
import type { NexusUser, NexusUserCounts } from '@/services/nexus/nexus.types';
import { NexusUserStreamService } from '@/services/nexus/stream/users/userStream';
import { canonicalPubky, PUBKY_52_STAGING_FIXTURE as viewer } from '@/test-utils/pubky';
import { FollowSyncApplication } from './follow-sync';

const [a, b, c, d] = [1, 2, 3, 4].map(canonicalPubky);
const counts: NexusUserCounts = {
  tagged: 0,
  tags: 0,
  unique_tags: 0,
  posts: 0,
  replies: 0,
  following: 99,
  followers: 0,
  friends: 0,
  bookmarks: 0,
  collections: 0,
};
const user = (id: string, following: boolean): NexusUser => ({
  details: { id, name: id, bio: '', links: null, status: null, image: null, indexed_at: 0 },
  counts,
  tags: [],
  relationship: { following, followed_by: true },
});
const signal = () => new AbortController().signal;
const snapshot = async (following: string[]) =>
  LocalFollowSyncService.apply({
    viewerId: viewer,
    following,
    signal: signal(),
    version: await followSyncGuard.capture(viewer),
  });
const page = (skip: number, limit = 2) =>
  UserStreamApplication.getOrFetchStreamSlice({ viewerId: viewer, streamId: `${viewer}:following`, skip, limit });

afterEach(() => vi.restoreAllMocks());

describe('homeserver follow synchronization', () => {
  it('does not write a mutation cancelled while waiting for reconciliation', async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const held = followSyncGuard.tryApply(viewer, async () => {
      entered.resolve();
      await release.promise;
      return true;
    });
    await entered.promise;
    const create = vi.spyOn(LocalFollowService, 'create');
    const request = vi.spyOn(HomeserverService, 'request');
    const cancellation = new AbortController();
    const commit = UserApplication.commitFollow({
      follower: viewer,
      followee: a,
      eventType: HttpMethod.PUT,
      followUrl: followUriBuilder(viewer, a),
      followJson: {},
      signal: cancellation.signal,
    });
    cancellation.abort();
    release.resolve();
    await held;
    await commit;
    expect(create).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(await UserConnectionsModel.findById(viewer)).toBeNull();
  });

  it.each([{ following: [a] }, { following: [] }])(
    'rejects an older window response after snapshot $following',
    async ({ following }) => {
      await snapshot([]);
      const older = await new FollowSyncGuard().capture(viewer);
      const newer = await new FollowSyncGuard().capture(viewer);
      expect(
        await LocalFollowSyncService.apply({ viewerId: viewer, version: newer, following, signal: signal() }),
      ).toBe(true);
      expect(
        await LocalFollowSyncService.apply({ viewerId: viewer, version: older, following: [b], signal: signal() }),
      ).toBe(false);
      expect(await LocalFollowSyncService.readFollowing(viewer)).toEqual(following);
    },
  );

  it('protects a pending mutation in a separate window and rejects its older snapshot', async () => {
    const otherWindow = new FollowSyncGuard();
    const version = await followSyncGuard.capture(viewer);
    await otherWindow.runMutation(viewer, async () => {
      await LocalFollowService.create({ follower: viewer, followee: a });
      expect(await followSyncGuard.capture(viewer)).toBeNull();
      expect(await LocalFollowSyncService.apply({ viewerId: viewer, following: [], signal: signal(), version })).toBe(
        false,
      );
    });
    expect(await LocalFollowSyncService.apply({ viewerId: viewer, following: [], signal: signal(), version })).toBe(
      false,
    );
    expect(await UserRelationshipsModel.findById(a)).toMatchObject({ following: true });
    // Released locks do not leave persisted pending markers behind.
    expect(await snapshot([a])).toBe(true);
  });

  it('rebuilds missing authority before applying a live event after another window clears it', async () => {
    await snapshot([a]);
    await UserConnectionsModel.deleteById(viewer);
    vi.spyOn(HomeserverService, 'listAll').mockResolvedValue([followUriBuilder(viewer, b)]);
    const exists = vi.spyOn(HomeserverService, 'exists').mockResolvedValue(true);
    expect(await FollowSyncApplication.refreshRelationships(viewer, [b], signal())).toBe(true);
    expect(await LocalFollowSyncService.readFollowing(viewer)).toEqual([b]);
    expect(exists).not.toHaveBeenCalled();
    expect(await FollowSyncApplication.refreshRelationships(viewer, [b], signal())).toBe(true);
    expect(exists).toHaveBeenCalledTimes(1);
  });

  it('does not scan or rewrite unchanged relationship data during a periodic snapshot', async () => {
    await snapshot([a]);
    const scan = vi.spyOn(UserRelationshipsModel.table, 'toArray');
    const update = vi.spyOn(UserConnectionsModel, 'upsert');
    expect(await snapshot([a])).toBe(true);
    expect(scan).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('hydrates viewer-relative data even when all recommended profile details are cached', async () => {
    await LocalStreamUsersService.persistUsers([user(a, false)]);
    await LocalStreamUsersService.upsert({ streamId: UserStreamTypes.RECOMMENDED, stream: [a] });
    const fetch = vi.spyOn(NexusUserStreamService, 'fetchByIds').mockResolvedValue([user(a, false)]);
    const result = await UserStreamApplication.getOrFetchStreamSlice({
      streamId: UserStreamTypes.RECOMMENDED,
      viewerId: viewer,
      skip: 0,
      limit: 1,
    });
    expect(result.cacheMissUserIds).toEqual([a]);
    await UserStreamApplication.getOrFetchUsers({ userIds: [a], viewerId: viewer });
    expect(fetch).toHaveBeenCalledWith({ user_ids: [a], viewer_id: viewer });
    expect(await UserRelationshipsModel.findById(a)).not.toBeNull();
  });

  it('accepts only canonical follow resources, not nested files or another account’s resources', async () => {
    vi.spyOn(HomeserverService, 'listAll').mockResolvedValue([
      followUriBuilder(viewer, a),
      followUriBuilder(viewer, '0'.repeat(52)),
      followUriBuilder(viewer, b).replace('/follows/', '/follows/archive/'),
      followUriBuilder(viewer, c).replace('/follows/', '/other/'),
      followUriBuilder(a, d),
    ]);
    await FollowSyncApplication.refreshFollowing(viewer, signal());
    expect(await LocalFollowSyncService.readFollowing(viewer)).toEqual([a]);
  });

  it('repairs both directions of stale following flags and protects them from later Nexus responses', async () => {
    await LocalStreamUsersService.persistUsers([user(a, false), user(b, true), user(viewer, false)], viewer);
    vi.spyOn(HomeserverService, 'listAll').mockResolvedValue([followUriBuilder(viewer, a)]);

    expect(await FollowSyncApplication.refreshFollowing(viewer, signal())).toBe(true);
    await LocalStreamUsersService.persistUsers([user(a, false), user(b, true), user(viewer, false)], viewer);

    expect(await UserRelationshipsModel.findById(a)).toMatchObject({ following: true, followed_by: true });
    expect(await UserRelationshipsModel.findById(b)).toMatchObject({ following: false, followed_by: true });
    expect(await UserCountsModel.findById(viewer)).toMatchObject({ following: 1 });
  });

  it('protects following counts on both standalone profile update paths', async () => {
    await snapshot([a, b]);
    await LocalProfileService.upsertCounts(viewer, counts);
    expect(await UserCountsModel.findById(viewer)).toMatchObject({ following: 2 });
    await LocalUserService.upsertCounts({ userId: viewer }, counts);
    expect(await UserCountsModel.findById(viewer)).toMatchObject({ following: 2 });
  });

  it('protects the count when a viewerless response arrives after session restoration', async () => {
    await snapshot([a]);
    await LocalStreamUsersService.persistUsers([user(viewer, false)]);
    expect(await UserCountsModel.findById(viewer)).toMatchObject({ following: 1 });
  });

  it('treats an empty homeserver list as authoritative', async () => {
    await LocalStreamUsersService.persistUsers([user(a, true)], viewer);
    await snapshot([]);
    await LocalStreamUsersService.persistUsers([user(a, true)], viewer);
    expect(await LocalFollowSyncService.readFollowing(viewer)).toEqual([]);
    expect(await UserRelationshipsModel.findById(a)).toMatchObject({ following: false });
  });

  it('reads current resource state for replayed events and applies duplicate events idempotently', async () => {
    await snapshot([a]);
    await LocalProfileService.upsertCounts(viewer, counts);
    const exists = vi
      .spyOn(HomeserverService, 'exists')
      .mockImplementation(async (uri) => uri === followUriBuilder(viewer, b));
    await FollowSyncApplication.refreshRelationships(viewer, [a, b, b], signal());
    await FollowSyncApplication.refreshRelationships(viewer, [a, b], signal());
    expect(exists).toHaveBeenCalledTimes(4);
    expect(await LocalFollowSyncService.readFollowing(viewer)).toEqual([b]);
    expect(await UserCountsModel.findById(viewer)).toMatchObject({ following: 1 });
    expect(await UserRelationshipsModel.findById(a)).toMatchObject({ following: false });
    expect(await UserRelationshipsModel.findById(b)).toMatchObject({ following: true });
  });

  it('does not rewrite the account list for an already applied live event', async () => {
    await snapshot([a]);
    const upsert = vi.spyOn(UserConnectionsModel, 'upsert');
    vi.spyOn(HomeserverService, 'exists').mockResolvedValue(true);
    await FollowSyncApplication.refreshRelationships(viewer, [a], signal());
    expect(upsert).not.toHaveBeenCalled();
  });

  it('does not replace valid state when a homeserver read fails', async () => {
    await snapshot([a]);
    vi.spyOn(HomeserverService, 'exists').mockRejectedValue(new Error('offline'));
    await expect(FollowSyncApplication.refreshRelationships(viewer, [a], signal())).rejects.toThrow('offline');
    expect(await LocalFollowSyncService.readFollowing(viewer)).toEqual([a]);
  });

  it('does not write a response arriving after logout or an account switch', async () => {
    let complete!: (uris: string[]) => void;
    vi.spyOn(HomeserverService, 'listAll').mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const controller = new AbortController();
    const pending = FollowSyncApplication.refreshFollowing(viewer, controller.signal);
    await vi.waitFor(() => expect(HomeserverService.listAll).toHaveBeenCalled());
    controller.abort();
    complete([followUriBuilder(viewer, a)]);
    expect(await pending).toBe(false);
    expect(await LocalFollowSyncService.readFollowing(viewer)).toBeNull();
    expect(await UserRelationshipsModel.findById(a)).toBeNull();
  });

  it('rejects a snapshot that raced even a completed local follow', async () => {
    let complete!: (uris: string[]) => void;
    vi.spyOn(HomeserverService, 'listAll').mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const pending = FollowSyncApplication.refreshFollowing(viewer, signal());
    await vi.waitFor(() => expect(HomeserverService.listAll).toHaveBeenCalled());
    await followSyncGuard.runMutation(viewer, () => LocalFollowService.create({ follower: viewer, followee: a }));
    complete([]);
    expect(await pending).toBe(false);
    expect(await UserRelationshipsModel.findById(a)).toMatchObject({ following: true });
  });

  it('protects optimistic follow and unfollow from Nexus even before the first snapshot', async () => {
    await LocalFollowService.create({ follower: viewer, followee: a });
    await LocalStreamUsersService.persistUsers([user(a, false)], viewer);
    expect(await UserRelationshipsModel.findById(a)).toMatchObject({ following: true });
    await LocalFollowService.delete({ follower: viewer, followee: a });
    await LocalStreamUsersService.persistUsers([user(a, true)], viewer);
    expect(await UserRelationshipsModel.findById(a)).toMatchObject({ following: false });
  });

  it('defers IO while a local mutation is pending', async () => {
    const list = vi.spyOn(HomeserverService, 'listAll');
    const exists = vi.spyOn(HomeserverService, 'exists');
    await followSyncGuard.runMutation(viewer, async () => {
      expect(await FollowSyncApplication.refreshFollowing(viewer, signal())).toBe(false);
      expect(await FollowSyncApplication.refreshRelationships(viewer, [a], signal())).toBe(false);
    });
    expect(list).not.toHaveBeenCalled();
    expect(exists).not.toHaveBeenCalled();
  });

  it('limits parallel homeserver reads to four', async () => {
    await snapshot([]);
    let active = 0;
    let maximum = 0;
    vi.spyOn(HomeserverService, 'exists').mockImplementation(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return true;
    });
    await FollowSyncApplication.refreshRelationships(
      viewer,
      Array.from({ length: 20 }, (_, i) => canonicalPubky(i + 1)),
      signal(),
    );
    expect(maximum).toBe(4);
  });
});

describe('authoritative following pagination', () => {
  it('resolves visible anchors against concurrent removals even with a longer shared cache', async () => {
    await snapshot([a, b, c, d]);
    await page(0, 4);
    await snapshot([b, c, d]);
    const next = await UserStreamApplication.getOrFetchStreamSlice({
      streamId: `${viewer}:following`,
      viewerId: viewer,
      skip: 2,
      limit: 1,
      anchorIds: [a, b],
    });
    expect(next.nextPageIds).toEqual([c]);
    await snapshot([c, d]);
    const afterAllVisibleRemoved = await UserStreamApplication.getOrFetchStreamSlice({
      streamId: `${viewer}:following`,
      viewerId: viewer,
      skip: 2,
      limit: 1,
      anchorIds: [a, b],
    });
    expect(afterAllVisibleRemoved.nextPageIds).toEqual([c]);
  });
  it('does not rewind a larger list when another consumer requests a smaller prefix', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => canonicalPubky(i + 1));
    await snapshot(ids);
    await page(0, 20);
    await page(20, 20);
    // For example, opening the account hover card while its Following page is still mounted.
    await page(0, 10);
    expect((await UserStreamModel.findById(`${viewer}:following`))?.stream).toHaveLength(40);
    expect((await page(40, 20)).nextPageIds).toEqual(ids.slice(40, 60));
  });

  it('does not rewrite an unchanged authoritative list or previously loaded page', async () => {
    await snapshot([a, b, c, d]);
    await page(0);
    const updateConnections = vi.spyOn(UserConnectionsModel, 'update');
    const upsertStream = vi.spyOn(UserStreamModel, 'upsert');
    await page(0);
    expect(updateConnections).not.toHaveBeenCalled();
    expect(upsertStream).not.toHaveBeenCalled();
  });

  it('keeps the previously loaded Nexus prefix without skipping directory entries', async () => {
    await UserStreamModel.upsert(`${viewer}:following`, [b, d]);
    await snapshot([a, b, c, d]);
    expect((await page(2)).nextPageIds).toEqual([a, c]);
    expect((await UserStreamModel.findById(`${viewer}:following`))?.stream).toEqual([b, d, a, c]);
  });

  it('does not skip a page after a displayed user is unfollowed', async () => {
    await snapshot([a, b, c, d]);
    await page(0);
    await snapshot([b, c, d]);
    const next = await page(2);
    expect(next).toMatchObject({ nextPageIds: [c, d], skip: 3, isExhausted: true });
  });

  it('keeps a locally prepended follow consistent with later pages', async () => {
    await snapshot([a, b, c, d]);
    await page(0);
    const x = canonicalPubky(5);
    await LocalFollowService.create({ follower: viewer, followee: x });
    const next = await page(3);
    expect(next.nextPageIds).toEqual([c, d]);
    expect(await LocalFollowSyncService.readFollowing(viewer)).toEqual([x, a, b, c, d]);
  });

  it('loads large account lists one page at a time and does not call Nexus for membership', async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => canonicalPubky(i + 1));
    const fetch = vi.spyOn(NexusUserStreamService, 'fetch');
    await snapshot(ids);
    expect(await UserStreamModel.findById(`${viewer}:following`)).toBeNull();
    const first = await page(0, 20);
    expect(first.nextPageIds).toEqual(ids.slice(0, 20));
    expect(first.isExhausted).toBe(false);
    expect((await UserStreamModel.findById(`${viewer}:following`))?.stream).toHaveLength(20);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the authoritative list when it becomes available during a Nexus request', async () => {
    let complete!: (ids: string[]) => void;
    const fetch = vi.spyOn(NexusUserStreamService, 'fetch').mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const pending = page(0);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await snapshot([a]);
    complete([b]);
    expect((await pending).nextPageIds).toEqual([a]);
    expect((await UserStreamModel.findById(`${viewer}:following`))?.stream).toEqual([a]);
  });
});
