'use client';

import type { ReactNode } from 'react';
import { getResourceRoute } from '@/app/routes';
import { Container } from '@/atoms/Container/Container';
import type { TPinakesResourceDetail } from '@/services/pinakes/pinakes.types';
import { getHttpUrl, getLinkHost, getResourceLinks, getResourceTypeLabel } from './ResourceCard.utils';
import { CARD_MUTED_TEXT, ResourceCardFrame, ResourceCardHeader } from './ResourceCardFrame';

interface ResourceEmbedFrameProps {
  /** The link as written: what the source opens and the tags and actions are on. */
  url: string;
  /** The link's Pinakes card when there is one: its type opens the resource page, its site names the source. */
  card: TPinakesResourceDetail | null;
  /** The resource's footer (`ResourceActions`). */
  actions: ReactNode;
  /** The platform's own embed (an X post, a video, a music player). */
  children: ReactNode;
  /** What the embed is, named in the header when there is no card to say it ("Post", "Video"). */
  fallbackTypeLabel?: string;
}

/**
 * A platform's own embed as an external resource in a post: the embed exactly as the platform makes
 * it, in the resource card's frame. Header: the type ("Video", "Social media posting") opens the
 * resource page, the source (site icon and name) opens the link; footer: the resource's tags and
 * actions, Also on in its ⋯ menu. Without a card (Pinakes does not know the link yet) the header
 * names the host and the type link says what the embed is (`fallbackTypeLabel`); the footer stays:
 * tags need no card. As on every card, the type opens the resource page and the source the link,
 * in a new tab. The frame is no click-through: the embed
 * is its own set of controls.
 */
export function ResourceEmbedFrame({
  url,
  card,
  actions,
  children,
  fallbackTypeLabel = 'Link',
}: ResourceEmbedFrameProps) {
  const links = card ? getResourceLinks(card, url) : null;
  const typeLabel = (card ? getResourceTypeLabel(card) : null) ?? fallbackTypeLabel;
  const href = links?.linkUrl ?? getHttpUrl(url);

  return (
    <ResourceCardFrame clickThroughUrl={null} className={CARD_MUTED_TEXT} data-testid="resource-embed-frame">
      <Container overrideDefaults className="flex min-w-0 flex-col gap-3 p-4">
        <ResourceCardHeader
          typeLabel={typeLabel}
          typeHref={getResourceRoute(card?.uri ?? url)}
          sourceUri={links?.sourceUri ?? url}
          href={href}
          siteName={links?.siteName ?? getLinkHost(href)}
        />
        <Container overrideDefaults className="min-w-0" data-testid="resource-embed-body">
          {children}
        </Container>
      </Container>
      {actions}
    </ResourceCardFrame>
  );
}
