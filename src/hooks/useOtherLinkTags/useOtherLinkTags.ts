'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import { TagController } from '@/controllers/tag/tag';
import { useAuthStore } from '@/stores/auth/auth.store';
import type { TOtherLink, TOtherLinkTags, UseOtherLinkTagsResult } from './useOtherLinkTags.types';

type TSettled = { key: string; reads: TOtherLinkTags[] };

/**
 * The tags people put on other links of the same thing (the same film on Netflix and TMDB), read
 * from Nexus exactly as written: the same shared read a card of that link makes, so a link read
 * elsewhere moments ago (still cached) is not asked again. All links are asked at once and Nexus
 * answers them in one `by_ids` request (100 links per request; per link by `by-uri` on a Nexus
 * without it); the answers are shown as they arrive, in the links' order, and a link that fails to
 * read (already reported) is left out. Each answer stays with its own link, never joined to another
 * by label. The reads start again only when the links (by URI) or the viewer change, not on a new
 * array of the same links.
 *
 * @param links - The other links (`getOtherLinks`), the page's own link not among them
 */
export function useOtherLinkTags(links: TOtherLink[]): UseOtherLinkTagsResult {
  const viewerId = useAuthStore((state) => state.currentUserPubky);
  const key = links.length > 0 ? `${links.map((link) => link.uri).join('\n')}\n\n${viewerId ?? ''}` : '';
  const [settled, setSettled] = useState<TSettled | null>(null);

  // Reads the links of the render that asked; `key` alone decides when to read again.
  const readAll = useEffectEvent(async (readKey: string, isCancelled: () => boolean) => {
    const answers: (TOtherLinkTags | null | undefined)[] = links.map(() => undefined);
    const show = () => {
      if (isCancelled()) return;
      const reads = answers.filter((answer): answer is TOtherLinkTags => Boolean(answer));
      const isDone = answers.every((answer) => answer !== undefined);
      // Shown once something is read, or once every link answered (all without tags).
      if (reads.length > 0 || isDone) setSettled({ key: readKey, reads });
    };
    await Promise.allSettled(
      links.map((link, index) =>
        TagController.fetchResourceTags({ uri: link.uri, viewerId }).then(
          (tags) => {
            answers[index] = tags.length > 0 ? { link, tags } : null;
            show();
          },
          () => {
            answers[index] = null;
            show();
          },
        ),
      ),
    );
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
