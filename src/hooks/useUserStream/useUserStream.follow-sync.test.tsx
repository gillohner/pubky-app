import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { UserStreamApplication } from '@/application/stream/users/users';
import { clearDatabase } from '@/database/franky/franky.helpers';
import { UserStreamTypes } from '@/models/stream/user/userStream.types';
import { UserDetailsModel } from '@/models/user/details/userDetails';
import { UserRelationshipsModel } from '@/models/user/relationships/userRelationships';
import { LocalFollowSyncService } from '@/services/local/follow/followSync';
import { followSyncGuard } from '@/services/local/follow/followSyncGuard';
import type { NexusUser } from '@/services/nexus/nexus.types';
import { NexusUserStreamService } from '@/services/nexus/stream/users/userStream';
import { useAuthStore } from '@/stores/auth/auth.store';
import { canonicalPubky, mockSession } from '@/test-utils/pubky';
import { useUserStream } from './useUserStream';

afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.getState().reset();
});

it('finishes loading recommendations when a guest response repopulates details after sign-in clears the database', async () => {
  useAuthStore.getState().reset();
  const viewer = canonicalPubky(100);
  const ids = Array.from({ length: 10 }, (_, i) => canonicalPubky(i));
  const users: NexusUser[] = ids.map((id) => ({
    details: { id, name: id, bio: '', links: null, status: null, image: null, indexed_at: 0 },
    counts: {
      tagged: 0,
      tags: 0,
      unique_tags: 0,
      posts: 0,
      replies: 0,
      following: 0,
      followers: 0,
      friends: 0,
      bookmarks: 0,
      collections: 0,
    },
    relationship: { following: false, followed_by: false },
    tags: [],
  }));
  let completeGuest!: (users: NexusUser[]) => void;
  const fetch = vi
    .spyOn(NexusUserStreamService, 'fetchByIds')
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeGuest = resolve;
        }),
    )
    .mockResolvedValue(users);
  const guestRequest = UserStreamApplication.fetchMissingUsersFromNexus({ cacheMissUserIds: ids });
  await clearDatabase();
  completeGuest(users);
  await guestRequest;
  expect(await UserDetailsModel.table.count()).toBe(10);
  expect(await UserRelationshipsModel.table.count()).toBe(0);
  useAuthStore.getState().init({ currentUserPubky: viewer, session: mockSession(), hasProfile: true });
  await LocalFollowSyncService.apply({
    viewerId: viewer,
    following: [],
    version: await followSyncGuard.capture(viewer),
    signal: new AbortController().signal,
  });
  vi.spyOn(NexusUserStreamService, 'fetch').mockResolvedValue(ids);
  const { result } = renderHook(() =>
    useUserStream({
      streamId: UserStreamTypes.RECOMMENDED,
      limit: 3,
      bufferSize: 10,
      refillThreshold: 6,
      includeRelationships: true,
      excludeFollowing: true,
    }),
  );
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.users).toHaveLength(3);
  expect(await UserRelationshipsModel.table.count()).toBe(10);
  expect(fetch).toHaveBeenLastCalledWith({ user_ids: ids, viewer_id: viewer });
  expect(fetch).toHaveBeenCalledTimes(2);
});
