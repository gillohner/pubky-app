import { AUTH_ROUTES } from '@/app/routes';
import {
  FOLLOW_SYNC_BATCH_SIZE,
  FOLLOW_SYNC_DEBOUNCE_MS,
  FOLLOW_SYNC_MAX_RETRY_MS,
  FOLLOW_SYNC_PATH,
  FOLLOW_SYNC_RETRY_MS,
} from '@/config/follow-sync';
import { getTtlUserMs } from '@/config/sync';
import { FollowSyncController } from '@/controllers/follow-sync/follow-sync';
import { ErrorService } from '@/libs/error/error.types';
import { toAppError } from '@/libs/error/error.utils';
import { isPubkyIdentifier } from '@/libs/utils/utils';
import type { Pubky } from '@/models/models.types';
import type { THomeserverUserEvent } from '@/services/homeserver/homeserver.types';
import { useAuthStore } from '@/stores/auth/auth.store';

type FollowSyncCheckpoint = { viewerId: Pubky; cursor: string | null; lastSnapshotAt: number };

/** One resumable connection per signed-in account, paused while the page is hidden. */
export class FollowSyncCoordinator {
  private static instance: FollowSyncCoordinator | null = null;
  private started = false;
  private route = '';
  private checkpoint: FollowSyncCheckpoint | null = null;
  private abortController: AbortController | null = null;
  private reader: ReadableStreamDefaultReader<THomeserverUserEvent> | null = null;
  private unsubscribeAuth: () => void;

  private constructor() {
    this.unsubscribeAuth = useAuthStore.subscribe((state, previous) => {
      if (
        state.session !== previous.session ||
        state.hasProfile !== previous.hasProfile ||
        state.currentUserPubky !== previous.currentUserPubky
      ) {
        this.evaluate();
      }
    });
    document.addEventListener('visibilitychange', this.evaluate);
  }

  static getInstance(): FollowSyncCoordinator {
    return (this.instance ??= new FollowSyncCoordinator());
  }

  static resetInstance(): void {
    this.instance?.destroy();
    this.instance = null;
  }

  start(): void {
    this.started = true;
    this.evaluate();
  }

  stop(): void {
    this.started = false;
    this.disconnect();
  }

  destroy(): void {
    this.stop();
    this.unsubscribeAuth();
    document.removeEventListener('visibilitychange', this.evaluate);
  }

  setRoute(route: string): void {
    this.route = route;
    this.evaluate();
  }

  private disconnect(): void {
    this.abortController?.abort();
    this.abortController = null;
    const reader = this.reader;
    this.reader = null;
    void reader?.cancel().catch(() => {});
  }

  private evaluate = (): void => {
    const auth = useAuthStore.getState();
    if (!auth.session || !auth.currentUserPubky) this.checkpoint = null;
    const disabledRoute = ['/onboarding', AUTH_ROUTES.SIGN_IN, AUTH_ROUTES.LOGOUT].some(
      (route) => this.route === route || this.route.startsWith(`${route}/`),
    );
    if (
      !this.started ||
      !auth.session ||
      !auth.hasProfile ||
      !auth.currentUserPubky ||
      disabledRoute ||
      document.visibilityState === 'hidden'
    ) {
      this.disconnect();
      return;
    }
    if (this.abortController && this.checkpoint?.viewerId === auth.currentUserPubky) return;
    this.disconnect();
    if (this.checkpoint?.viewerId !== auth.currentUserPubky) {
      this.checkpoint = { viewerId: auth.currentUserPubky, cursor: null, lastSnapshotAt: 0 };
    }
    this.abortController = new AbortController();
    void this.run(this.checkpoint, this.abortController.signal);
  };

  private async run(checkpoint: FollowSyncCheckpoint, signal: AbortSignal): Promise<void> {
    let retryMs = FOLLOW_SYNC_RETRY_MS;
    while (!signal.aborted) {
      try {
        if (checkpoint.cursor === null) {
          // Read the head BEFORE the snapshot, then replay from it: writes during listing cannot be missed.
          const cursor = await FollowSyncController.fetchCursor(checkpoint.viewerId);
          if (signal.aborted) return;
          if (!(await FollowSyncController.refreshFollowing(checkpoint.viewerId, signal))) {
            await this.pause(FOLLOW_SYNC_RETRY_MS, signal);
            continue;
          }
          if (signal.aborted) return;
          checkpoint.lastSnapshotAt = Date.now();
          checkpoint.cursor = cursor;
        }
        const stream = await FollowSyncController.subscribeFollowing(checkpoint.viewerId, checkpoint.cursor);
        if (signal.aborted) {
          await stream
            .getReader()
            .cancel()
            .catch(() => {});
          return;
        }
        const openedAt = Date.now();
        await this.consume(stream, checkpoint, signal);
        if (Date.now() - openedAt >= FOLLOW_SYNC_MAX_RETRY_MS) retryMs = FOLLOW_SYNC_RETRY_MS;
      } catch (error) {
        if (!signal.aborted) toAppError(error, ErrorService.Homeserver, 'followSync');
      }
      if (signal.aborted) return;

      // A failed/unavailable stream still gets a bounded periodic homeserver reconciliation.
      if (Date.now() - checkpoint.lastSnapshotAt >= getTtlUserMs()) {
        try {
          if (await FollowSyncController.refreshFollowing(checkpoint.viewerId, signal))
            checkpoint.lastSnapshotAt = Date.now();
        } catch (error) {
          if (!signal.aborted) toAppError(error, ErrorService.Homeserver, 'followSyncFallback');
        }
      }
      await this.pause(retryMs, signal);
      retryMs = Math.min(retryMs * 2, FOLLOW_SYNC_MAX_RETRY_MS);
    }
  }

  private async consume(
    stream: ReadableStream<THomeserverUserEvent>,
    checkpoint: FollowSyncCheckpoint,
    signal: AbortSignal,
  ): Promise<void> {
    const reader = stream.getReader();
    this.reader = reader;
    const pending = new Set<Pubky>();
    let pendingCursor: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let flushing: Promise<void> | null = null;
    let failure: unknown;
    let snapshotDue = false;

    const flush = async (): Promise<void> => {
      if (flushing) {
        await flushing;
        return flush();
      }
      if (signal.aborted || (pendingCursor === null && !snapshotDue)) return;
      const userIds = [...pending];
      const cursor = pendingCursor;
      let needsSnapshot = snapshotDue;
      snapshotDue = false;
      pending.clear();
      pendingCursor = null;
      const work = async () => {
        while (!signal.aborted) {
          if (needsSnapshot) {
            if (!(await FollowSyncController.refreshFollowing(checkpoint.viewerId, signal))) {
              await this.pause(FOLLOW_SYNC_RETRY_MS, signal);
              continue;
            }
            checkpoint.lastSnapshotAt = Date.now();
            needsSnapshot = false;
          }
          if (
            !userIds.length ||
            (await FollowSyncController.refreshRelationships(checkpoint.viewerId, userIds, signal))
          ) {
            if (!signal.aborted && cursor !== null) checkpoint.cursor = cursor;
            return;
          }
          await this.pause(FOLLOW_SYNC_RETRY_MS, signal);
        }
      };
      flushing = work();
      try {
        await flushing;
      } finally {
        flushing = null;
      }
    };

    const schedule = () => {
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        void flush().catch((error) => {
          failure = error;
          void reader.cancel().catch(() => {});
        });
      }, FOLLOW_SYNC_DEBOUNCE_MS);
    };
    const settleFlush = () => flushing?.catch(() => {});
    // Also repair failed optimistic writes or silently missed events while the stream stays open.
    // Share the flush queue so a slow snapshot cannot overwrite an already applied live batch.
    const reconciliationTimer = setInterval(() => {
      snapshotDue = true;
      schedule();
    }, getTtlUserMs());

    try {
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (failure) throw failure;
        if (done || signal.aborted) break;
        const target = value.resourcePath.startsWith(FOLLOW_SYNC_PATH)
          ? value.resourcePath.slice(FOLLOW_SYNC_PATH.length)
          : '';
        if ((value.eventType === 'PUT' || value.eventType === 'DEL') && isPubkyIdentifier(target)) pending.add(target);
        pendingCursor = value.cursor;
        if (pending.size >= FOLLOW_SYNC_BATCH_SIZE) await flush();
        else schedule();
      }
      if (failure) throw failure;
      await flush();
    } finally {
      clearTimeout(timer);
      clearInterval(reconciliationTimer);
      // A checkpoint advances only after a successful write. Failed/aborted batches replay on reconnect.
      await settleFlush();
      await reader.cancel().catch(() => {});
      if (this.reader === reader) this.reader = null;
    }
  }

  private pause(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, ms);
      signal.addEventListener('abort', finish, { once: true });
    });
  }
}
