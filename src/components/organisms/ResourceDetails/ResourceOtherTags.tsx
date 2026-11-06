'use client';

import { useRef, useState } from 'react';
import { getResourceRoute } from '@/app/routes';
import { Container } from '@/atoms/Container/Container';
import { Link } from '@/atoms/Link/Link';
import { Popover, PopoverAnchor, PopoverContent } from '@/atoms/Popover/Popover';
import { Typography } from '@/atoms/Typography/Typography';
import { useEnrichedTags } from '@/hooks/useEnrichedTags/useEnrichedTags';
import { useOtherLinkTags } from '@/hooks/useOtherLinkTags/useOtherLinkTags';
import type { TOtherLink } from '@/hooks/useOtherLinkTags/useOtherLinkTags.types';
import { generateRandomColor } from '@/libs/utils/utils';
import { PostTag } from '@/molecules/PostTag/PostTag';
import { MAX_VISIBLE_AVATARS } from '@/molecules/PostTagPopoverWrapper/PostTagPopoverWrapper.constants';
import { TaggerAvatar } from '@/molecules/PostTagPopoverWrapper/TaggerAvatar/TaggerAvatar';
import { ResourceSourceIcon } from '@/molecules/ResourceCard/ResourceSourceIcon';
import type { TaggerWithAvatar, TagWithAvatars } from '@/molecules/TaggedItem/TaggedItem.types';
import { mergeOtherLinkTags, type TMergedTag } from './ResourceOtherTags.utils';

/** The second tag group's label, under "Tags on this …". */
export const OTHER_TAGS_LABEL = 'Tags on other services';

interface ResourceOtherTagsProps {
  /** The other links of the same thing (`getOtherLinks`), the page's own link not among them. */
  links: TOtherLink[];
}

/**
 * The tags people put on the same thing on other services, under the link's own footer: one chip
 * per label across those links (each tagger counted once), in the app's tag colors. Display only:
 * a chip opens who tagged it and on which service, and a tag is still added to this link only, in
 * the row above. Nothing shows while read or when the other links have no tags.
 */
export function ResourceOtherTags({ links }: ResourceOtherTagsProps) {
  const { reads } = useOtherLinkTags(links);
  const merged = mergeOtherLinkTags(reads);
  // This group's own taggers, enriched by label within this group only: the link's own bar keeps
  // its own, so a person who tagged only this link never shows here (and the other way round).
  const { enrichedTags } = useEnrichedTags(
    merged.map((tag): TagWithAvatars => ({
      label: tag.label,
      taggers: tag.taggers.map((id) => ({ id })),
      taggers_count: tag.count,
      relationship: false,
      tag_uri: null,
    })),
  );
  if (merged.length === 0) return null;

  return (
    <Container
      overrideDefaults
      data-testid="resource-other-tags"
      role="group"
      aria-label={OTHER_TAGS_LABEL}
      className="flex min-w-0 flex-wrap items-center gap-2"
    >
      <Typography
        as="span"
        overrideDefaults
        data-testid="resource-other-tags-label"
        className="min-w-0 text-xs font-medium tracking-wide text-muted-foreground uppercase"
      >
        {OTHER_TAGS_LABEL}
      </Typography>
      {merged.map((tag, index) => (
        <OtherTagChip key={tag.label} tag={tag} taggers={enrichedTags[index]?.taggers ?? []} />
      ))}
    </Container>
  );
}

/** One merged chip; a click opens its taggers and the services it is on. */
function OtherTagChip({ tag, taggers }: { tag: TMergedTag; taggers: TaggerWithAvatar[] }) {
  const [open, setOpen] = useState(false);
  // The chip is the popover's anchor, not a Radix trigger (the chip stops its click): a press on it
  // must not count as outside the popover, or it would close and at once reopen it. With no
  // trigger Radix gives focus back to nothing, so closing from inside (Escape) gives it to the chip.
  const anchorRef = useRef<HTMLSpanElement>(null);
  const closedFromOutside = useRef(false);
  const visibleTaggers = taggers.slice(0, MAX_VISIBLE_AVATARS);
  const moreTaggers = Math.max(0, tag.count - visibleTaggers.length);
  const services = tag.sources.map((source) => source.name).join(', ');
  const people = `${tag.isComplete ? '' : 'at least '}${tag.count} ${tag.count === 1 ? 'person' : 'people'}`;

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) closedFromOutside.current = false;
    setOpen(isOpen);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverAnchor asChild>
        <span ref={anchorRef} className="inline-flex max-w-full">
          <PostTag
            label={tag.label}
            count={tag.count}
            color={generateRandomColor(tag.label)}
            onClick={() => handleOpenChange(!open)}
            data-testid="resource-other-tag"
            aria-label={`${tag.label}, tagged by ${people} on ${services}`}
            // It opens a popover and toggles nothing: no pressed state (Radix lets this override it).
            aria-pressed={undefined}
            aria-haspopup="dialog"
            aria-expanded={open}
          />
        </span>
      </PopoverAnchor>
      <PopoverContent
        side="bottom"
        sideOffset={4}
        align="start"
        aria-label={`${tag.label} on other services`}
        data-testid="resource-other-tag-menu"
        className="flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-3 p-3"
        onInteractOutside={(event) => {
          if (event.target instanceof Node && anchorRef.current?.contains(event.target)) event.preventDefault();
          else closedFromOutside.current = true;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!closedFromOutside.current) anchorRef.current?.querySelector('button')?.focus();
        }}
      >
        {visibleTaggers.length > 0 && (
          <Container overrideDefaults className="flex items-center gap-2">
            <Container overrideDefaults className="flex items-center">
              {visibleTaggers.map((tagger, index) => (
                <TaggerAvatar key={tagger.id} tagger={tagger} index={index} />
              ))}
            </Container>
            {moreTaggers > 0 && (
              <Typography as="span" size="sm" className="font-normal text-muted-foreground">
                +{moreTaggers}
              </Typography>
            )}
          </Container>
        )}
        <ul className="-mx-1 flex flex-col gap-0.5" data-testid="resource-other-tag-sources">
          {tag.sources.map((source) => (
            <li key={source.uri} className="min-w-0">
              <Link
                href={getResourceRoute(source.uri)}
                overrideDefaults
                onClick={() => setOpen(false)}
                className="flex min-w-0 items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-accent focus-visible:bg-accent"
              >
                <ResourceSourceIcon uri={source.uri} />
                <span className="min-w-0 flex-1 truncate text-foreground">{source.name}</span>
                <span className="shrink-0 text-muted-foreground">{source.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
