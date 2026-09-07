import { afterEach, expect, it, vi } from 'vitest';
import { followSyncGuard } from '@/services/local/follow/followSyncGuard';
import { canonicalPubky } from '@/test-utils/pubky';
import { HomeserverFollowService } from './follow';
import { HomeserverService } from './homeserver';

afterEach(() => vi.restoreAllMocks());

it('forwards a free slot when its first waiting round is cancelled during wake-up', async () => {
  const viewer = canonicalPubky(100);
  const ids = Array.from({ length: 6 }, (_, index) => canonicalPubky(index + 101));
  const pending: ((value: boolean) => void)[] = [];
  vi.spyOn(HomeserverService, 'exists').mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  const old = new AbortController();
  const cancelled = new AbortController();
  const latest = new AbortController();
  const rounds = [HomeserverFollowService.readRelationships(viewer, ids.slice(0, 4), old.signal, async () => true)];
  await vi.waitFor(() => expect(pending).toHaveLength(4));
  rounds.push(HomeserverFollowService.readRelationships(viewer, [ids[4]], cancelled.signal, async () => true));
  rounds.push(HomeserverFollowService.readRelationships(viewer, [ids[5]], latest.signal, async () => true));
  try {
    pending[0](true);
    queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => cancelled.abort())));
    await vi.waitFor(() => expect(pending).toHaveLength(5));
    pending[4](true);
    expect(await rounds[1]).toBeNull();
    expect(await rounds[2]).toEqual(new Map([[ids[5], true]]));
  } finally {
    old.abort();
    cancelled.abort();
    latest.abort();
    pending.forEach((resolve) => resolve(true));
    await Promise.all(rounds);
  }
});

it('retains the limit across failed and cancelled rounds while other slots keep progressing', async () => {
  const viewer = canonicalPubky(1);
  const ids = Array.from({ length: 12 }, (_, index) => canonicalPubky(index + 2));
  const version = await followSyncGuard.capture(viewer);
  const old = new AbortController();
  const pending: { resolve: (value: boolean) => void; reject: (error: Error) => void }[] = [];
  let active = 0;
  let maximum = 0;
  const exists = vi.spyOn(HomeserverService, 'exists').mockImplementation(async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    try {
      return await new Promise<boolean>((resolve, reject) => pending.push({ resolve, reject }));
    } finally {
      active -= 1;
    }
  });
  const first = HomeserverFollowService.readRelationships(viewer, ids, old.signal, () =>
    followSyncGuard.isCurrent(viewer, version),
  ).catch((error) => error);
  await vi.waitFor(() => expect(pending).toHaveLength(4));
  old.abort();
  const second = HomeserverFollowService.readRelationships(viewer, ids.slice(0, 2), new AbortController().signal, () =>
    followSyncGuard.isCurrent(viewer, version),
  );
  pending[0].reject(new Error('offline'));
  await vi.waitFor(() => expect(pending).toHaveLength(5));
  pending[4].resolve(true);
  await vi.waitFor(() => expect(pending).toHaveLength(6));
  pending[5].resolve(true);
  expect((await second)?.size).toBe(2);
  // The three old probes still exist, but have not stranded the new round behind a round-wide lock.
  expect(active).toBe(3);
  for (const request of pending.slice(1, 4)) request.resolve(true);
  expect(await first).toMatchObject({ message: 'offline' });
  expect(maximum).toBe(4);
  expect(exists).toHaveBeenCalledTimes(6);
});

it('stops dispatching obsolete work after a local mutation', async () => {
  const viewer = canonicalPubky(20);
  const ids = Array.from({ length: 20 }, (_, index) => canonicalPubky(index + 21));
  const version = await followSyncGuard.capture(viewer);
  const pending: ((value: boolean) => void)[] = [];
  const exists = vi
    .spyOn(HomeserverService, 'exists')
    .mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  const work = HomeserverFollowService.readRelationships(viewer, ids, new AbortController().signal, () =>
    followSyncGuard.isCurrent(viewer, version),
  );
  await vi.waitFor(() => expect(pending).toHaveLength(4));
  await followSyncGuard.runMutation(viewer, async () => {});
  pending.forEach((resolve) => resolve(true));
  expect(await work).toBeNull();
  expect(exists).toHaveBeenCalledTimes(4);
});
