'use client';

import { ArrowUpRight } from 'lucide-react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { Container } from '@/atoms/Container/Container';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import { cn } from '@/libs/utils/utils';
import { useIsPostPreviewNavigable } from '@/molecules/PostPreviewCard/PostPreviewNestingContext';
import { isCardSurfaceClick } from './ResourceCard.utils';
import { ResourceSourceIcon } from './ResourceSourceIcon';

/**
 * Inside the card's frame (`bg-muted`) the app's muted grey is 3.8:1; this tone, between the text
 * colour and the frame's, keeps grey text above 4.5:1 there and on the large card's surface.
 */
export const CARD_MUTED_TEXT = '[--color-muted-foreground:color-mix(in_oklab,var(--foreground)_58%,var(--muted))]';

interface ResourceCardFrameProps extends Omit<React.HTMLAttributes<HTMLElement>, 'onClick' | 'onKeyDown'> {
  /**
   * Where a click on the card itself goes (a new tab), or `null` for a card with no click-through.
   * Keyboard users reach the same link through the source link in the header. The card's header
   * and body show the pointer, its bottom zone of actions and tags does not.
   */
  clickThroughUrl: string | null;
  children: ReactNode;
}

/**
 * The frame an external resource sits in inside a post: the app's embedded-post surface
 * (`rounded-md bg-muted`, like a quoted post), with a hairline divider between its parts: the
 * header and body, then the bottom zone of actions and tags.
 *
 * With a `clickThroughUrl`, a mouse click anywhere on the card that is not one of its controls
 * opens the link in a new tab. The frame itself has no interactive role, so no control is nested
 * in another; clicks, and Enter or Space on the card's links and controls, never reach the
 * surrounding post (a quoted post opens itself on either key, wherever it came from).
 */
export function ResourceCardFrame({ clickThroughUrl, className, children, ...props }: ResourceCardFrameProps) {
  const handleClick = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    if (!clickThroughUrl || !isCardSurfaceClick(event.currentTarget, event.target)) return;
    // Selecting text on the card is not a click on it.
    if (window.getSelection()?.toString()) return;
    window.open(clickThroughUrl, '_blank', 'noopener,noreferrer');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
  };

  return (
    <Container
      as="article"
      overrideDefaults
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      data-click-through={clickThroughUrl ? 'true' : undefined}
      className={cn('flex w-full min-w-0 flex-col divide-y divide-card overflow-hidden rounded-md bg-muted', className)}
      {...props}
    >
      {children}
    </Container>
  );
}

interface ResourceCardHeaderProps {
  /** The type in plain words, top left; nothing for an untyped link. */
  typeLabel: string | null;
  /**
   * Where the type links (the resource's page), for a card with no title to carry that link (a
   * platform embed in `ResourceEmbedFrame`); plain text otherwise.
   */
  typeHref?: string;
  /** The URI the source names, for its icon (the card's own link when web). */
  sourceUri: string;
  /** Where the source links: the link as written, `http(s)` only. */
  href: string | null;
  /** The site's name (`card.site`, else the host without `www.`); never the full link. */
  siteName: string | null;
  /**
   * Says what the source link does, "Open in <site>": on the resource page's card it is the one way
   * to open the resource (the title there is no second link to the same place).
   */
  openIn?: boolean;
}

/** The type line on the left and the source on the right: the site's icon and name, linking out. */
export function ResourceCardHeader({
  typeLabel,
  typeHref,
  sourceUri,
  href,
  siteName,
  openIn = false,
}: ResourceCardHeaderProps) {
  const navigable = useIsPostPreviewNavigable();
  const typeClassName = 'truncate text-xs font-medium tracking-wide text-muted-foreground uppercase';
  return (
    <Container overrideDefaults className="flex min-w-0 items-center justify-between gap-3">
      {typeLabel &&
        (typeHref ? (
          // Where links may not navigate (the composer), in a new tab, as the card's title does.
          <Link
            href={typeHref}
            target={navigable ? undefined : '_blank'}
            rel={navigable ? undefined : 'noopener noreferrer'}
            overrideDefaults
            aria-label={`${typeLabel}: open the resource page`}
            data-testid="resource-card-type"
            className={cn(typeClassName, 'hover:text-brand')}
          >
            {typeLabel}
          </Link>
        ) : (
          <Typography as="span" overrideDefaults data-testid="resource-card-type" className={typeClassName}>
            {typeLabel}
          </Typography>
        ))}
      <ResourceSource uri={sourceUri} href={href} name={siteName} openIn={openIn} />
    </Container>
  );
}

/** The site the card's link goes to: favicon, name and ↗, linking out when the link is web. */
function ResourceSource({
  uri,
  href,
  name,
  openIn,
}: {
  uri: string;
  href: string | null;
  name: string | null;
  openIn: boolean;
}) {
  const className = 'ml-auto flex min-w-0 shrink items-center gap-1.5 text-xs font-medium text-muted-foreground';

  // Without a name the icon alone would be an unlabelled link: the title opens the resource instead.
  if (!href || !name) {
    return (
      <Typography as="span" overrideDefaults data-testid="resource-card-source" className={className}>
        <ResourceSourceIcon uri={uri} />
        {name && <span className="truncate">{name}</span>}
      </Typography>
    );
  }
  return (
    <Link href={href} overrideDefaults data-testid="resource-card-source" className={cn(className, 'hover:text-brand')}>
      <ResourceSourceIcon uri={uri} />
      <span className="truncate">{openIn ? `Open in ${name}` : name}</span>
      <ArrowUpRight aria-hidden="true" className="size-3 shrink-0" />
    </Link>
  );
}
