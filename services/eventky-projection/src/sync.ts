import { ProjectionStore } from './store';
import type { SourceAdapter } from './types';

/** Single-writer synchronizer; callers serialize passes rather than running inventory and changes concurrently. */
export class ProjectionSync {
  private running = false;
  constructor(
    private readonly store: ProjectionStore,
    private readonly source: SourceAdapter,
  ) {
    if (store.metadata().backend_id !== source.backendId) throw new Error('Projection source identity mismatch.');
  }

  async reconcile() {
    this.store.beginInventory();
    let cursor: string | undefined;
    let checkpoint: string | undefined;
    const seenCursors = new Set<string>();
    for (let pages = 0; pages < 100000; pages++) {
      const page = await this.source.inventory(cursor);
      if (checkpoint && checkpoint !== page.checkpoint)
        throw new Error('Inventory snapshot changed during enumeration.');
      checkpoint = page.checkpoint;
      this.store.stageInventory(page.posts);
      if (!page.next_cursor) {
        // Inventory scans current graph. Replay every committed mutation from its starting
        // watermark before promoting; this covers concurrent inserts, deletes and kind changes.
        const startCheckpoint = checkpoint;
        for (let replay = 0; replay < 10000; replay++) {
          const changes = await this.source.changes(checkpoint);
          if (changes.reset) throw new Error('Inventory replay cursor expired or its source epoch changed.');
          for (const change of changes.changes) this.store.stageChange(change);
          if (changes.caught_up) {
            await this.source.verifySnapshot?.(startCheckpoint);
            this.store.finishInventory(changes.checkpoint);
            return;
          }
          if (changes.checkpoint === checkpoint) throw new Error('Inventory replay cursor did not advance.');
          checkpoint = changes.checkpoint;
        }
        throw new Error('Inventory replay exceeded its bounded page budget.');
      }
      if (seenCursors.has(page.next_cursor)) throw new Error('Inventory cursor did not advance.');
      seenCursors.add(page.next_cursor);
      cursor = page.next_cursor;
    }
    throw new Error('Inventory exceeded its bounded page budget.');
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const metadata = this.store.metadata();
      if (
        !metadata.checkpoint ||
        !metadata.reconciled_at ||
        Date.now() - Date.parse(metadata.reconciled_at) > 5 * 60 * 1000
      )
        await this.reconcile();
      let caughtUp = false;
      for (let batch = 0; batch < 100; batch++) {
        const before = this.store.metadata().checkpoint!;
        const changes = await this.source.changes(before);
        if (changes.reset) {
          await this.reconcile();
          continue;
        }
        this.store.enqueueChanges(changes.changes, changes.checkpoint, changes.caught_up);
        for (const uri of this.store.dueJobs()) {
          try {
            const current = this.store.jobSource(uri) ?? (await this.source.hydrate(uri));
            if ((current.status === 'present' ? current.post.uri : current.uri) !== uri)
              throw new Error('Hydrated source identity mismatch.');
            this.store.applyHydration(current);
          } catch {
            this.store.applyHydration({ status: 'unavailable', uri });
          }
        }
        if (changes.caught_up) {
          caughtUp = true;
          break;
        }
        if (changes.checkpoint === before) throw new Error('Change cursor did not advance.');
      }
      this.store.setReady(caughtUp);
    } catch (e) {
      this.store.setReady(false);
      throw e;
    } finally {
      this.running = false;
    }
  }
}
