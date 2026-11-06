import type { TOtherLink, TOtherLinkTags } from '@/hooks/useOtherLinkTags/useOtherLinkTags.types';
import { canonicalizeTagLabel } from '@/libs/utils/utils';
import { getAlsoOnName } from '@/molecules/ResourceCard/ResourceCard.utils';
import type { TPinakesCard, TPinakesResourceDetail } from '@/services/pinakes/pinakes.types';

/** Links read for their tags at most: a place can be on dozens of services (Wikipedia editions). */
export const MAX_OTHER_LINKS = 40;

/** Merged tags shown at most, as many as the link's own tag bar asks for. */
export const MAX_OTHER_TAGS = 20;

/** One link a merged tag was put on, with how many people put it there. */
export interface TMergedTagSource extends TOtherLink {
  count: number;
}

/** A tag across the other links: one chip per label, each tagger counted once. */
export interface TMergedTag {
  label: string;
  /** Every tagger Nexus listed on any of the links, once each. */
  taggers: string[];
  /**
   * People who put the tag on any of the links, each once. Nexus may list fewer taggers than it
   * counts; then at least the most any one link has (`isComplete` false).
   */
  count: number;
  /** Nexus listed every tagger on every link: `count` is exact, not a lower bound. */
  isComplete: boolean;
  /** The links it is on, most taggers first. */
  sources: TMergedTagSource[];
}

/**
 * The URIs that are the page's link itself: its tags are the "Tags on this …" bar, so they are not
 * read again as another link's. The page's link, the link acted on, the card's canonical link, the
 * links people wrote for it (`refs`) and its other spellings (`aliases`).
 */
export function getOwnLinkUris(
  card: Pick<TPinakesResourceDetail, 'uri' | 'refs' | 'aliases'>,
  pageUri: string,
  actionUri: string,
): Set<string> {
  return new Set([pageUri, actionUri, card.uri, ...card.refs, ...(card.aliases ?? [])]);
}

/**
 * The other links of the same thing whose tags are read, by URI: every other member of the card's
 * group (the links people wrote for it first, then its canonical link), then the card's Also on
 * entries. A derived Also on entry is left out: Pinakes found it through a source and nobody has
 * tagged it. Own URIs and repeats are skipped; at most `MAX_OTHER_LINKS`.
 *
 * @param members - The group's members (`GET /v1/groups/{id}`), the card itself among them; absent
 *   while read or for a card outside a group
 */
export function getOtherLinks(
  card: Pick<TPinakesResourceDetail, 'id' | 'also_on'>,
  members: Pick<TPinakesCard, 'id' | 'uri' | 'refs' | 'site'>[] | null | undefined,
  ownUris: ReadonlySet<string>,
): TOtherLink[] {
  const links = new Map<string, TOtherLink>();
  const add = (uri: string, site: string | null | undefined) => {
    if (!uri || ownUris.has(uri) || links.has(uri) || links.size >= MAX_OTHER_LINKS) return;
    links.set(uri, { uri, name: getAlsoOnName({ uri, site }) });
  };
  for (const member of members ?? []) {
    if (member.id === card.id) continue;
    for (const ref of member.refs ?? []) add(ref, member.site);
    add(member.uri, member.site);
  }
  for (const entry of card.also_on) {
    if (!entry.derived) add(entry.uri, entry.site);
  }
  return [...links.values()];
}

/**
 * Merges the tags of the other links (`getOtherLinks`, which already leaves out the page link's own
 * URIs) into one chip per label, labels compared as Nexus stores them, case-folded: taggers are
 * joined so a person who put the same tag on two links counts once, and each chip keeps the links
 * it came from, once each (two spellings of a label on one link keep the larger count). Most
 * taggers first, then on most links, then by label; at most `MAX_OTHER_TAGS`.
 */
export function mergeOtherLinkTags(reads: TOtherLinkTags[]): TMergedTag[] {
  const merged = new Map<
    string,
    { taggers: Set<string>; most: number; isComplete: boolean; sources: Map<string, TMergedTagSource> }
  >();
  for (const { link, tags } of reads) {
    for (const tag of tags) {
      const label = canonicalizeTagLabel(tag.label);
      if (!label) continue;
      const entry = merged.get(label) ?? { taggers: new Set<string>(), most: 0, isComplete: true, sources: new Map() };
      for (const tagger of tag.taggers) entry.taggers.add(tagger);
      const count = Math.max(tag.taggers_count, tag.taggers.length);
      entry.most = Math.max(entry.most, count);
      entry.isComplete &&= tag.taggers.length >= tag.taggers_count;
      const source = entry.sources.get(link.uri);
      if (!source || source.count < count) entry.sources.set(link.uri, { ...link, count });
      merged.set(label, entry);
    }
  }
  return [...merged.entries()]
    .map(([label, { taggers, most, isComplete, sources }]) => ({
      label,
      taggers: [...taggers],
      count: Math.max(taggers.size, most),
      isComplete,
      sources: [...sources.values()].sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.count - a.count || b.sources.length - a.sources.length || a.label.localeCompare(b.label))
    .slice(0, MAX_OTHER_TAGS);
}

/**
 * The link the card's tags, bookmark and collections are on: one people wrote (`refs`, most
 * referenced first), which is what a post's card acts on. The canonical `uri` often is not one
 * (Apple Music's `music.apple.com/song/…` for the `/gb/song/…` people wrote), and Nexus has no tags
 * on it. The page's own link when it is a ref, else `uri` when it is, else the most referenced one;
 * `uri` only for a card with no refs.
 */
export function getActionUri(card: TPinakesResourceDetail, pageUri: string): string {
  if (card.refs.includes(pageUri)) return pageUri;
  if (card.refs.includes(card.uri)) return card.uri;
  return card.refs[0] ?? card.uri;
}

/**
 * The link the resource page's thread is on (the replies read, the composer's `parent`, the
 * Participants): the acted-on link once the card is read (`getActionUri`), the page's own link when
 * Pinakes has no card for it, is not configured or failed; `null` while the card is read or without
 * a link, so the thread is not read twice for two links.
 */
export function getThreadUri(
  pageUri: string | null,
  read: { data: TPinakesResourceDetail | null | undefined; isLoading: boolean },
  isPinakesConfigured: boolean,
): string | null {
  if (!pageUri) return null;
  if (!isPinakesConfigured) return pageUri;
  if (read.data) return getActionUri(read.data, pageUri);
  return read.isLoading ? null : pageUri;
}
