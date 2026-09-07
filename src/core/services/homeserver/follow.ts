import { followUriBuilder } from 'pubky-app-specs';
import { FOLLOW_SYNC_CONCURRENCY } from '@/config/follow-sync';
import { isCanonicalPubky } from '@/libs/utils/pubky';
import type { Pubky } from '@/models/models.types';
import { HomeserverService } from './homeserver';

/** The limit includes SDK probes still settling after an older connection was cancelled. */
export class HomeserverFollowService {
  private static active = 0;
  private static waiting = new Set<() => void>();

  private static async withSlot<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T | undefined> {
    while (this.active >= FOLLOW_SYNC_CONCURRENCY && !signal.aborted) {
      await new Promise<void>((resolve) => {
        const wake = () => {
          this.waiting.delete(wake);
          signal.removeEventListener('abort', wake);
          resolve();
        };
        this.waiting.add(wake);
        signal.addEventListener('abort', wake, { once: true });
      });
    }
    if (signal.aborted) {
      if (this.active < FOLLOW_SYNC_CONCURRENCY) this.waiting.values().next().value?.();
      return;
    }
    this.active += 1;
    try {
      return await work();
    } finally {
      this.active -= 1;
      this.waiting.values().next().value?.();
    }
  }

  static async readRelationships(
    viewerId: Pubky,
    userIds: Pubky[],
    signal: AbortSignal,
    canRead: () => Promise<boolean>,
  ): Promise<Map<Pubky, boolean> | null> {
    const ids = [...new Set(userIds)].filter(isCanonicalPubky);
    const changes = new Map<Pubky, boolean>();
    let next = 0;
    let stopped = false;
    const worker = async () => {
      try {
        while (next < ids.length && !stopped && !signal.aborted) {
          const id = ids[next++];
          await this.withSlot(signal, async () => {
            if (!(await canRead()) || stopped || signal.aborted) {
              stopped = true;
              return;
            }
            changes.set(id, await HomeserverService.exists(followUriBuilder(viewerId, id)));
          });
        }
      } catch (error) {
        stopped = true;
        throw error;
      }
    };
    const results = await Promise.allSettled(
      Array.from({ length: Math.min(FOLLOW_SYNC_CONCURRENCY, ids.length) }, worker),
    );
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    return signal.aborted || stopped ? null : changes;
  }
}
