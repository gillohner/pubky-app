'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import { TagController } from '@/controllers/tag/tag';
import { useAuthStore } from '@/stores/auth/auth.store';
import type { TOtherLink, TOtherLinkTags, UseOtherLinkTagsResult } from './useOtherLinkTags.types';

/** Links read at once: Nexus has no batch read of resources, so one `by-uri` request per link. */
export const OTHER_LINK_READS_AT_ONCE = 6;

type TSettled = { key: string; reads: TOtherLinkTags[] };

/**
 * The tags people put on other links of the same thing (the same film on Netflix and TMDB), read
 * from Nexus link by link, exactly as written: the same shared read a card of that link makes, so
 * a link read elsewhere moments ago (still cached) is not asked again. Read only, a few links at a
 * time, each batch shown as it arrives; a link that fails to read (already reported) is left out.
 * Each answer stays with its own link, never joined to another by label. The reads start again
 * only when the links (by URI) or the viewer change, not on a new array of the same links.
 *
 * @param links - The other links (`getOtherLinks`), the page's own link not among them
 */
export function useOtherLinkTags(links: TOtherLink[]): UseOtherLinkTagsResult {
  const viewerId = useAuthStore((state) => state.currentUserPubky);
  const key = links.length > 0 ? `${links.map((link) => link.uri).join('\n')}\n\n${viewerId ?? ''}` : '';
  const [settled, setSettled] = useState<TSettled | null>(null);

  // Reads the links of the render that asked; `key` alone decides when to read again.
  const readAll = useEffectEvent(async (readKey: string, isCancelled: () => boolean) => {
    const reads: TOtherLinkTags[] = [];
    for (let start = 0; start < links.length; start += OTHER_LINK_READS_AT_ONCE) {
      const batch = links.slice(start, start + OTHER_LINK_READS_AT_ONCE);
      const answers = await Promise.allSettled(
        batch.map((link) => TagController.fetchResourceTags({ uri: link.uri, viewerId })),
      );
      if (isCancelled()) return;
      answers.forEach((answer, index) => {
        if (answer.status === 'fulfilled' && answer.value.length > 0) {
          reads.push({ link: batch[index], tags: answer.value });
        }
      });
      setSettled({ key: readKey, reads: [...reads] });
    }
  });

  useEffect(() => {
    if (!key) return;
    // Set by the cleanup when the links or the viewer change, so a late answer never shows.
    let cancelled = false;
    void readAll(key, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [key]);

  const current = settled?.key === key ? settled : null;
  return { reads: current?.reads ?? [], isLoading: Boolean(key) && !current };
}
