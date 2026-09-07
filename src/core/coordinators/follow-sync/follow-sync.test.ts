import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FOLLOW_SYNC_PATH } from '@/config/follow-sync';
import { FollowSyncController } from '@/controllers/follow-sync/follow-sync';
import type { THomeserverUserEvent } from '@/services/homeserver/homeserver.types';
import { useAuthStore } from '@/stores/auth/auth.store';
import { mockSession, PUBKY_52_STAGING_FIXTURE as viewer } from '@/test-utils/pubky';
import { FollowSyncCoordinator } from './follow-sync';

const target = 'a'.repeat(52);
const opened: { source: ReadableStreamDefaultController<THomeserverUserEvent>; cancel: ReturnType<typeof vi.fn> }[] =
  [];
const authenticate = (id = viewer, hasProfile = true) =>
  useAuthStore.getState().init({ session: mockSession(), currentUserPubky: id, hasProfile });
const advance = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
const event = (cursor: string, id = target): THomeserverUserEvent => ({
  cursor,
  eventType: 'PUT',
  resourcePath: `${FOLLOW_SYNC_PATH}${id}`,
});
const visibility = async (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
  await advance();
};
const start = async () => {
  const coordinator = FollowSyncCoordinator.getInstance();
  coordinator.setRoute('/home');
  coordinator.start();
  await advance();
  return coordinator;
};

beforeEach(() => {
  vi.useFakeTimers();
  FollowSyncCoordinator.resetInstance();
  useAuthStore.getState().reset();
  opened.length = 0;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  vi.spyOn(FollowSyncController, 'fetchCursor').mockResolvedValue('100');
  vi.spyOn(FollowSyncController, 'refreshFollowing').mockResolvedValue(true);
  vi.spyOn(FollowSyncController, 'refreshRelationships').mockResolvedValue(true);
  vi.spyOn(FollowSyncController, 'subscribeFollowing').mockImplementation(async () => {
    const cancel = vi.fn();
    return new ReadableStream<THomeserverUserEvent>({
      start(source) {
        opened.push({ source, cancel });
      },
      cancel,
    });
  });
});

afterEach(async () => {
  FollowSyncCoordinator.resetInstance();
  await advance();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('FollowSyncCoordinator', () => {
  it('starts after session restoration and opens one connection across route changes', async () => {
    const coordinator = await start();
    expect(FollowSyncController.fetchCursor).not.toHaveBeenCalled();
    authenticate();
    await advance();
    coordinator.setRoute('/profile');
    coordinator.start();
    await advance();
    expect(FollowSyncController.subscribeFollowing).toHaveBeenCalledExactlyOnceWith(viewer, '100');
  });

  it('waits for the profile to become ready', async () => {
    authenticate(viewer, false);
    await start();
    expect(FollowSyncController.fetchCursor).not.toHaveBeenCalled();
    useAuthStore.getState().setHasProfile(true);
    await advance();
    expect(opened).toHaveLength(1);
  });

  it('captures the head before listing and subscribes only after the snapshot completes', async () => {
    let complete!: (value: boolean) => void;
    vi.mocked(FollowSyncController.refreshFollowing).mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    authenticate();
    await start();
    expect(FollowSyncController.fetchCursor).toHaveBeenCalledBefore(vi.mocked(FollowSyncController.refreshFollowing));
    expect(opened).toHaveLength(0);
    complete(true);
    await advance();
    expect(FollowSyncController.subscribeFollowing).toHaveBeenCalledWith(viewer, '100');
  });

  it('coalesces repeated targets and checkpoints the last successfully applied event', async () => {
    authenticate();
    await start();
    opened[0].source.enqueue(event('101'));
    opened[0].source.enqueue({ ...event('102'), eventType: 'DEL' });
    opened[0].source.enqueue(event('103'));
    await advance(249);
    expect(FollowSyncController.refreshRelationships).not.toHaveBeenCalled();
    await advance(1);
    expect(FollowSyncController.refreshRelationships).toHaveBeenCalledExactlyOnceWith(
      viewer,
      [target],
      expect.any(AbortSignal),
    );
    await visibility('hidden');
    expect(opened[0].cancel).toHaveBeenCalledTimes(1);
    await visibility('visible');
    expect(FollowSyncController.subscribeFollowing).toHaveBeenLastCalledWith(viewer, '103');
    expect(FollowSyncController.refreshFollowing).toHaveBeenCalledTimes(1);
  });

  it('bounds batches even when a large burst arrives without pauses', async () => {
    authenticate();
    await start();
    for (let i = 0; i < 55; i++) opened[0].source.enqueue(event(String(101 + i), String(i).padStart(52, 'a')));
    await advance(250);
    const batches = vi.mocked(FollowSyncController.refreshRelationships).mock.calls.map((call) => call[1]);
    expect(batches.map((batch) => batch.length)).toEqual([20, 20, 15]);
    expect(new Set(batches.flat()).size).toBe(55);
  });

  it('ignores other paths and malformed target paths', async () => {
    authenticate();
    await start();
    opened[0].source.enqueue({ ...event('101'), resourcePath: '/pub/pubky.app/mutes/target' });
    opened[0].source.enqueue(event('102', `${target}/extra`));
    opened[0].source.enqueue({ ...event('103'), eventType: 'OTHER' });
    await advance(250);
    expect(FollowSyncController.refreshRelationships).not.toHaveBeenCalled();
  });

  it('replays an unapplied event after a failed refresh', async () => {
    authenticate();
    vi.mocked(FollowSyncController.refreshRelationships).mockRejectedValueOnce(new Error('offline'));
    await start();
    opened[0].source.enqueue(event('101'));
    await advance(1250);
    expect(FollowSyncController.subscribeFollowing).toHaveBeenNthCalledWith(2, viewer, '100');
    opened[1].source.enqueue(event('101'));
    await advance(250);
    await visibility('hidden');
    await visibility('visible');
    expect(FollowSyncController.subscribeFollowing).toHaveBeenLastCalledWith(viewer, '101');
  });

  it('retries a batch blocked by a local click before advancing the cursor', async () => {
    authenticate();
    vi.mocked(FollowSyncController.refreshRelationships).mockResolvedValueOnce(false);
    await start();
    opened[0].source.enqueue(event('101'));
    await advance(1250);
    expect(FollowSyncController.refreshRelationships).toHaveBeenCalledTimes(2);
    await visibility('hidden');
    await visibility('visible');
    expect(FollowSyncController.subscribeFollowing).toHaveBeenLastCalledWith(viewer, '101');
  });

  it('replays a debounce batch interrupted by hiding the page', async () => {
    authenticate();
    await start();
    opened[0].source.enqueue(event('101'));
    await advance(100);
    await visibility('hidden');
    await advance(1000);
    expect(FollowSyncController.refreshRelationships).not.toHaveBeenCalled();
    await visibility('visible');
    expect(FollowSyncController.subscribeFollowing).toHaveBeenLastCalledWith(viewer, '100');
  });

  it('aborts the old account and never subscribes it after a late snapshot', async () => {
    let complete!: (value: boolean) => void;
    vi.mocked(FollowSyncController.refreshFollowing).mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    authenticate();
    await start();
    const oldSignal = vi.mocked(FollowSyncController.refreshFollowing).mock.calls[0][1];
    const other = 'b'.repeat(52);
    authenticate(other);
    await advance();
    complete(true);
    await advance();
    expect(oldSignal.aborted).toBe(true);
    expect(FollowSyncController.subscribeFollowing).toHaveBeenCalledExactlyOnceWith(other, '100');
  });

  it('stops on logout and does not reconnect after its backoff', async () => {
    authenticate();
    await start();
    opened[0].source.error(new Error('offline'));
    await advance();
    useAuthStore.getState().reset();
    await advance(60_000);
    expect(FollowSyncController.subscribeFollowing).toHaveBeenCalledTimes(1);
  });

  it('uses occasional full reconciliation when the stream is unavailable', async () => {
    authenticate();
    vi.mocked(FollowSyncController.subscribeFollowing).mockRejectedValue(new Error('SSE unavailable'));
    await start();
    await advance(599_000);
    expect(FollowSyncController.refreshFollowing).toHaveBeenCalledTimes(1);
    await advance(32_000);
    expect(FollowSyncController.refreshFollowing).toHaveBeenCalledTimes(2);
    // Exponential retry is capped; it must not become a tight request loop.
    expect(vi.mocked(FollowSyncController.subscribeFollowing).mock.calls.length).toBeLessThan(30);
  });

  it('periodically repairs state on an idle live connection and pauses that work while hidden', async () => {
    authenticate();
    await start();
    await advance(599_000);
    expect(FollowSyncController.refreshFollowing).toHaveBeenCalledTimes(1);
    await advance(1250);
    expect(FollowSyncController.refreshFollowing).toHaveBeenCalledTimes(2);
    expect(FollowSyncController.subscribeFollowing).toHaveBeenCalledTimes(1);
    await visibility('hidden');
    await advance(600_250);
    expect(FollowSyncController.refreshFollowing).toHaveBeenCalledTimes(2);
  });

  it('serializes periodic snapshots with live updates arriving during the snapshot', async () => {
    authenticate();
    await start();
    let complete!: (value: boolean) => void;
    vi.mocked(FollowSyncController.refreshFollowing).mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    await advance(600_250);
    opened[0].source.enqueue(event('101'));
    await advance(250);
    expect(FollowSyncController.refreshRelationships).not.toHaveBeenCalled();
    complete(true);
    await advance();
    expect(FollowSyncController.refreshRelationships).toHaveBeenCalledExactlyOnceWith(
      viewer,
      [target],
      expect.any(AbortSignal),
    );
    await visibility('hidden');
    await visibility('visible');
    expect(FollowSyncController.subscribeFollowing).toHaveBeenLastCalledWith(viewer, '101');
  });
});
