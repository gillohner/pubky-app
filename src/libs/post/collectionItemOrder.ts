import { CompositeIdDomain } from '@/models/models.types';
import { buildCompositeIdFromPubkyUri } from '@/models/models.utils';

/**
 * Sorts a collection feed's post ids to match the collection envelope's
 * `items` order (an ordered array of `pubky://` post URIs).
 *
 * The envelope is the local-first source of truth for ordering: it updates
 * instantly after an add/remove/reorder commit, while the Nexus `collection`
 * stream re-indexes asynchronously and can serve a stale order for a while.
 * Sorting the stream's ids by the envelope closes that gap.
 *
 * Semantics:
 *   - ids present in the envelope come first, in envelope order
 *     (first occurrence wins for duplicate URIs);
 *   - ids NOT in the envelope keep their original stream order, appended;
 *   - envelope items with no matching stream id are ignored.
 *
 * Pure function — safe to call from any layer.
 */
export function sortPostIdsByCollectionOrder(postIds: string[], envelopeItems: string[] | undefined): string[] {
  if (!envelopeItems?.length || postIds.length < 2) return postIds;

  // Only the relative order of the indices matters, so the deduped id list's
  // positions are as good as the original envelope indices.
  const orderedPostIds = collectionItemsToPostIds(envelopeItems) ?? [];
  if (orderedPostIds.length === 0) return postIds;
  const orderByPostId = new Map<string, number>(orderedPostIds.map((postId, index) => [postId, index]));

  const inEnvelope: string[] = [];
  const rest: string[] = [];
  for (const postId of postIds) {
    (orderByPostId.has(postId) ? inEnvelope : rest).push(postId);
  }

  inEnvelope.sort((a, b) => (orderByPostId.get(a) ?? 0) - (orderByPostId.get(b) ?? 0));

  return [...inEnvelope, ...rest];
}

/**
 * Maps a collection envelope's `items` (`pubky://` post URIs) to composite
 * post ids, dropping malformed URIs and duplicates while preserving order.
 * Returns `undefined` when the envelope has not resolved yet so callers can
 * tell "unknown" apart from "empty".
 *
 * Pure function — safe to call from any layer.
 */
export function collectionItemsToPostIds(envelopeItems: string[] | undefined): string[] | undefined {
  if (!envelopeItems) return undefined;

  const postIds: string[] = [];
  const seen = new Set<string>();
  for (const uri of envelopeItems) {
    const compositeId = buildCompositeIdFromPubkyUri({ uri, domain: CompositeIdDomain.POSTS });
    if (compositeId !== null && !seen.has(compositeId)) {
      seen.add(compositeId);
      postIds.push(compositeId);
    }
  }
  return postIds;
}
