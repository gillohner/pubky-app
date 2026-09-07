import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { UserCountsModel } from '@/models/user/counts/userCounts';
import { LocalFollowSyncService } from '@/services/local/follow/followSync';
import { followSyncGuard } from '@/services/local/follow/followSyncGuard';
import { NexusUserService } from '@/services/nexus/user/user';
import { useAuthStore } from '@/stores/auth/auth.store';
import { canonicalPubky, mockSession } from '@/test-utils/pubky';
import { useProfileStats } from './useProfileStats';

afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.getState().reset();
});

it('shows authoritative counts without inventing a counts row for an unindexed account', async () => {
  const viewer = canonicalPubky(1);
  useAuthStore.getState().init({ currentUserPubky: viewer, session: mockSession(), hasProfile: true });
  vi.spyOn(NexusUserService, 'counts').mockRejectedValue(new Error('not indexed'));
  const snapshot = async (following: string[]) =>
    LocalFollowSyncService.apply({
      viewerId: viewer,
      following,
      signal: new AbortController().signal,
      version: await followSyncGuard.capture(viewer),
    });
  await snapshot([canonicalPubky(2), canonicalPubky(3), canonicalPubky(4)]);
  const { result, rerender } = renderHook(({ userId, enabled }) => useProfileStats(userId, { enabled }), {
    initialProps: { userId: viewer, enabled: true },
  });
  await waitFor(() => expect(result.current.stats.following).toBe(3));
  expect(await UserCountsModel.findById(viewer)).toBeNull();
  await act(async () => {
    await snapshot([]);
  });
  await waitFor(() => expect(result.current.stats.following).toBe(0));
  await act(async () => {
    await snapshot([canonicalPubky(2)]);
  });
  await waitFor(() => expect(result.current.stats.following).toBe(1));
  rerender({ userId: canonicalPubky(3), enabled: true });
  await waitFor(() => expect(result.current.stats.following).toBe(0));
  rerender({ userId: viewer, enabled: false });
  await waitFor(() => expect(result.current.stats.following).toBe(0));
});
