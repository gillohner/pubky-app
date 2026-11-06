import { getResourceStatus } from '@/molecules/ResourceCard/ResourceCard.utils';
import { PinakesStatus, type TPinakesResourceDetail } from '@/services/pinakes/pinakes.types';

/**
 * What a post's embedded link shows when the platform has its own embed (an X post, a YouTube or
 * Vimeo video, a link on a service the card player plays):
 * - `card`: our card, the platform's player only on Play on (or Show on for a post). For a link
 *   Pinakes knows on other services too (Also on: the same song or video elsewhere), the card says
 *   more than one platform's embed, and the viewer picks where to play it.
 * - `embed`: the platform's own embed in the resource frame (`ResourceEmbedFrame`), loaded up front,
 *   as for an X post: a link with no Also on, or no card (unknown to Pinakes, still pending).
 *
 * The card is also where an embed that failed goes (`embedFailed`: a deleted post), and an embed the
 * viewer has started (`engaged`) stays, so a card read later never unloads a playing video.
 */
export function chooseNativeEmbed({
  hasCard,
  hasAlsoOn,
  embedFailed = false,
  engaged = false,
}: {
  hasCard: boolean;
  hasAlsoOn: boolean;
  embedFailed?: boolean;
  engaged?: boolean;
}): 'card' | 'embed' {
  if (!hasCard) return 'embed';
  if (embedFailed) return 'card';
  return hasAlsoOn && !engaged ? 'card' : 'embed';
}

/**
 * The card to show next to a platform embed: one Pinakes has read and named. A `pending` or `error`
 * card, or one without a name, says less than the platform's own embed. A post's card repeats its
 * text as name and description: the description is left out when it only repeats the name.
 */
export function getNativeEmbedCard(card: TPinakesResourceDetail | null | undefined): TPinakesResourceDetail | null {
  const name = card?.name?.trim();
  if (!card || !name) return null;
  const status = getResourceStatus(card.status);
  if (status === PinakesStatus.PENDING || status === PinakesStatus.ERROR) return null;
  return card.description?.trim() === name ? { ...card, description: null } : card;
}
