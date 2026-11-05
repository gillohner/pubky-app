'use client';

import { usePinakesGroup } from '@/hooks/usePinakesGroup/usePinakesGroup';
import {
  PinakesCreditField,
  PinakesStatus,
  type TPinakesCard,
  type TPinakesCredit,
} from '@/services/pinakes/pinakes.types';
import { getAlsoOnName, getHttpUrl } from './ResourceCard.utils';

/** A value a card borrows from another member of its group, and where it is from. */
export interface TBorrowedValue {
  value: string;
  /** The member's service (`TIDAL`), named in the card's "Image: <site>" note. */
  site: string;
  /** The member's own link, `http(s)` only; `null` names the site without a link. */
  href: string | null;
  /** The member's own credit for the value, shown instead of the note when it has one. */
  credit: TPinakesCredit | null;
}

export interface TResourceFallback {
  description: TBorrowedValue | null;
  image: TBorrowedValue | null;
  /** The group is still being read: what it lends is not known yet. */
  pending: boolean;
}

const NONE: TResourceFallback = { description: null, image: null, pending: false };

function borrow(member: TPinakesCard, value: string, field: PinakesCreditField): TBorrowedValue {
  return {
    value,
    site: getAlsoOnName(member),
    href: getHttpUrl(member.uri),
    credit: member.credits?.find((credit) => credit.field === field) ?? null,
  };
}

/**
 * What a sparse card borrows from its group (the same thing on other services, `/v1/groups/{id}`)
 * when it lacks a description or an image: the first member that is `ok` and has one, members of
 * the card's own type first. The group is read only for a card in a group that lacks one of them,
 * once per group (the query is shared with the resource page's group list). Never across
 * `maybe_same`: those are not confirmed to be the same thing.
 *
 * @param card - The card being shown
 * @param needs - Which values the card lacks, and images that failed to load (not offered again)
 */
export function useResourceFallback(
  card: Pick<TPinakesCard, 'id' | 'type' | 'group'>,
  needs: { description: boolean; image: boolean; skipImages?: readonly string[] },
): TResourceFallback {
  // A group of one has nobody to borrow from.
  const hasOthers = (card.group?.size ?? 0) > 1;
  const groupId = hasOthers && (needs.description || needs.image) ? card.group?.id : null;
  const { data: group, isLoading } = usePinakesGroup(groupId);
  if (!groupId) return NONE;
  if (!group) return { ...NONE, pending: isLoading };

  const members = group.members
    .filter((member) => member.id !== card.id && member.status === PinakesStatus.OK)
    // Same type first; `sort` is stable, so the group's own order stays within each part.
    .sort((a, b) => Number(b.type === card.type) - Number(a.type === card.type));

  let description: TBorrowedValue | null = null;
  let image: TBorrowedValue | null = null;
  for (const member of members) {
    const text = member.description?.trim();
    if (needs.description && !description && text) description = borrow(member, text, PinakesCreditField.DESCRIPTION);
    const memberImage = getHttpUrl(member.image);
    const usable = memberImage && !needs.skipImages?.includes(memberImage) ? memberImage : null;
    if (needs.image && !image && usable) image = borrow(member, usable, PinakesCreditField.IMAGE);
  }
  return { description, image, pending: false };
}
