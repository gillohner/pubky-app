'use client';

import { useEffect, useState } from 'react';
import { ResourceController } from '@/controllers/resource/resource';
import type { TResourceCounts } from '@/services/nexus/resource/resource.types';

interface UseResourceCountsOptions {
  /**
   * Ask Nexus for the counts (the resource page). Without it the hook only follows what other reads
   * of the link brought in: a card's tag read carries its counts, so a card asks nothing more.
   */
  fetch?: boolean;
}

/**
 * What Nexus counts on an external resource (replies, embeds, collections) and its Nexus id, for the
 * link exactly as written. `undefined` while nothing was read, `null` when Nexus does not know the
 * link (nobody tagged or referenced it yet). A count the configured Nexus does not serve is
 * `undefined` in the counts: callers show 0 then, as for a link Nexus does not know.
 *
 * Network only (ADR-0011: controller + TanStack Query + effect): the counts live in the Nexus query
 * cache, shared by every reader of the link.
 *
 * @param uri - The link exactly as written; `null` reads nothing
 */
export function useResourceCounts(
  uri: string | null,
  { fetch = false }: UseResourceCountsOptions = {},
): TResourceCounts | null | undefined {
  const [settled, setSettled] = useState<{ uri: string; counts: TResourceCounts | null } | null>(null);

  useEffect(() => {
    if (!uri) return;
    let cancelled = false;
    const unsubscribe = ResourceController.subscribeCounts(uri, (counts) => {
      if (!cancelled) setSettled({ uri, counts });
    });
    if (fetch) {
      ResourceController.fetchCounts({ uri }).then(
        (counts) => {
          if (!cancelled) setSettled({ uri, counts });
        },
        // The service reported the failure through Err.*: no counts show.
        () => {},
      );
    }
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [uri, fetch]);

  if (!uri) return undefined;
  if (settled?.uri === uri) return settled.counts;
  // Counts another reader already brought in show from the first render.
  return ResourceController.getCachedCounts(uri);
}
