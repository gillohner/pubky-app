import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NEXUS_USERS_PER_PAGE } from '@/config/nexus';
import { UserController } from '@/controllers/user/user';
import { LocalFollowService } from '@/services/local/follow/follow';
import { LocalFollowSyncService } from '@/services/local/follow/followSync';
import { followSyncGuard } from '@/services/local/follow/followSyncGuard';
import type { NexusUser } from '@/services/nexus/nexus.types';
import { NexusUserStreamService } from '@/services/nexus/stream/users/userStream';
import { useAuthStore } from '@/stores/auth/auth.store';
import { mockSession, PUBKY_52_STAGING_FIXTURE as viewer } from '@/test-utils/pubky';
import { CONNECTION_TYPE, useProfileConnections } from './useProfileConnections';

const ids = Array.from({ length: 50 }, (_, i) => String(i).padStart(52, 'a'));
const user = (id: string): NexusUser => ({
  details: { id, name: `User ${id}`, bio: '', links: null, status: null, image: null, indexed_at: 0 },
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
});
const snapshot = (following: string[]) =>
  LocalFollowSyncService.apply({
    viewerId: viewer,
    following,
    signal: new AbortController().signal,
    version: followSyncGuard.capture(),
  });

beforeEach(() => {
  useAuthStore.getState().init({ session: mockSession(), currentUserPubky: viewer, hasProfile: true });
  vi.spyOn(NexusUserStreamService, 'fetch').mockResolvedValue([]);
  vi.spyOn(NexusUserStreamService, 'fetchByIds').mockImplementation(async ({ user_ids }) => user_ids.map(user));
  vi.spyOn(UserController, 'getManyTagsOrFetch').mockResolvedValue(new Map());
});

afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.getState().reset();
});

describe('mounted own Following list with homeserver updates', () => {
  it('keeps row order when another mounted consumer loads its next page', async () => {
    await snapshot(ids.slice(0, NEXUS_USERS_PER_PAGE * 2));
    const first = renderHook(() => useProfileConnections(CONNECTION_TYPE.FOLLOWING));
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    const second = renderHook(() => useProfileConnections(CONNECTION_TYPE.FOLLOWING));
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));
    await act(async () => {
      await second.result.current.loadMore();
    });
    await waitFor(() => expect(first.result.current.connections).toHaveLength(NEXUS_USERS_PER_PAGE * 2));
    expect(first.result.current.connections.map((row) => row.id)).toEqual(ids.slice(0, NEXUS_USERS_PER_PAGE * 2));
  });

  it('retains an unfollowed middle row when a new local follow is prepended', async () => {
    await snapshot(ids.slice(0, 3));
    const { result } = renderHook(() => useProfileConnections(CONNECTION_TYPE.FOLLOWING));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await LocalFollowService.delete({ follower: viewer, followee: ids[1] });
    });
    await act(async () => {
      await LocalFollowService.create({ follower: viewer, followee: ids[3] });
    });
    await waitFor(() =>
      expect(result.current.connections.map((row) => row.id)).toEqual([ids[3], ids[0], ids[1], ids[2]]),
    );
    expect(result.current.connections[2].isFollowing).toBe(false);
  });

  it('keeps later pages below existing rows while their profile data loads slowly', async () => {
    await snapshot(ids.slice(0, NEXUS_USERS_PER_PAGE * 2));
    const { result } = renderHook(() => useProfileConnections(CONNECTION_TYPE.FOLLOWING));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const firstPage = ids.slice(0, NEXUS_USERS_PER_PAGE);
    expect(result.current.connections.map((row) => row.id)).toEqual(firstPage);
    let complete!: (users: NexusUser[]) => void;
    vi.mocked(NexusUserStreamService.fetchByIds).mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.loadMore();
    });
    await waitFor(() => expect(NexusUserStreamService.fetchByIds).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.isLoadingMore).toBe(true));
    // Let the real Dexie subscription observe the expanded cached prefix before hydration finishes.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(result.current.connections.map((row) => row.id)).toEqual(firstPage);
    await act(async () => {
      complete(ids.slice(NEXUS_USERS_PER_PAGE, NEXUS_USERS_PER_PAGE * 2).map(user));
      await pending;
    });
    await waitFor(() =>
      expect(result.current.connections.map((row) => row.id)).toEqual(ids.slice(0, NEXUS_USERS_PER_PAGE * 2)),
    );
  });

  it('shows a remote follow on an exhausted empty list and protects its button from stale profile data', async () => {
    await snapshot([]);
    const { result } = renderHook(() => useProfileConnections(CONNECTION_TYPE.FOLLOWING));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasMore).toBe(false);
    await act(async () => {
      await snapshot([ids[0]]);
    });
    await waitFor(() => expect(result.current.connections).toHaveLength(1));
    await waitFor(() =>
      expect(result.current.connections[0]).toMatchObject({ id: ids[0], name: `User ${ids[0]}`, isFollowing: true }),
    );
  });

  it('preserves a visible unfollowed row and adds its replacement even when the total does not grow', async () => {
    await snapshot([ids[0]]);
    const { result } = renderHook(() => useProfileConnections(CONNECTION_TYPE.FOLLOWING));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await LocalFollowService.delete({ follower: viewer, followee: ids[0] });
    });
    await waitFor(() => expect(result.current.connections[0].isFollowing).toBe(false));
    await act(async () => {
      await snapshot([ids[1]]);
    });
    await waitFor(() => expect(result.current.connections).toHaveLength(2));
    expect(result.current.connections.find((row) => row.id === ids[0])?.isFollowing).toBe(false);
    await waitFor(() => expect(result.current.connections.find((row) => row.id === ids[1])?.isFollowing).toBe(true));
  });

  it('loads a large burst one page at a time, then accepts another follow after pagination is exhausted', async () => {
    const total = NEXUS_USERS_PER_PAGE * 2 + 5;
    await snapshot([]);
    const { result } = renderHook(() => useProfileConnections(CONNECTION_TYPE.FOLLOWING));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await snapshot(ids.slice(0, total));
    });
    await waitFor(() => expect(result.current.connections).toHaveLength(NEXUS_USERS_PER_PAGE));
    expect(result.current.hasMore).toBe(true);
    expect(NexusUserStreamService.fetchByIds).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.loadMore();
    });
    await waitFor(() => expect(result.current.connections).toHaveLength(NEXUS_USERS_PER_PAGE * 2));
    await act(async () => {
      await result.current.loadMore();
    });
    await waitFor(() => expect(result.current.connections).toHaveLength(total));
    expect(result.current.hasMore).toBe(false);
    await act(async () => {
      await snapshot(ids.slice(0, total + 1));
    });
    await waitFor(() => expect(result.current.connections).toHaveLength(total + 1));
    expect(new Set(result.current.connections.map((row) => row.id)).size).toBe(total + 1);
    expect(NexusUserStreamService.fetchByIds).toHaveBeenCalledTimes(4);
  });
});
