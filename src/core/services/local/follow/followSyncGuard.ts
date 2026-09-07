import type { Pubky } from '@/models/models.types';

// Prevent a homeserver read racing an optimistic follow/unfollow from undoing the user's action.
let revision = 0;
const pending = new Map<Pubky, number>();

export const followSyncGuard = {
  capture(): number {
    return revision;
  },
  canApply(viewerId: Pubky, version: number): boolean {
    return !pending.has(viewerId) && version === revision;
  },
  begin(viewerId: Pubky): () => void {
    revision += 1;
    pending.set(viewerId, (pending.get(viewerId) ?? 0) + 1);
    return () => {
      revision += 1;
      const remaining = (pending.get(viewerId) ?? 1) - 1;
      if (remaining) pending.set(viewerId, remaining);
      else pending.delete(viewerId);
    };
  },
};
