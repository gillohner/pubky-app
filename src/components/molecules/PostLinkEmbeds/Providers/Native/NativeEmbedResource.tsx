'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Container } from '@/atoms/Container/Container';
import { usePinakesCard } from '@/hooks/usePinakesCard/usePinakesCard';
import { useViewportObserver } from '@/hooks/useViewportObserver/useViewportObserver';
import { ResourceAlsoOn } from '@/molecules/ResourceCard/ResourceAlsoOn';
import { ResourceCard } from '@/molecules/ResourceCard/ResourceCard';
import { getHttpUrl, getResourceLinks, getResourceTagsLabel } from '@/molecules/ResourceCard/ResourceCard.utils';
import { ResourceEmbedFrame } from '@/molecules/ResourceCard/ResourceEmbedFrame';
import { ResourceCardSkeleton } from '@/molecules/ResourceCardSkeleton/ResourceCardSkeleton';
import { PlayOnPill } from '@/molecules/ResourcePlayer/ResourcePlayerControls';
import { AnimatedHeight } from '@/molecules/ResourcePlayer/ResourcePlayerFrame';
import { useCardPlayer } from '@/molecules/ResourcePlayer/useCardPlayer';
import { ResourceActions } from '@/organisms/ResourceActions/ResourceActions';
import { getMenuAlsoOn, PINAKES_SLOW_READ_MS, useSlowRead } from '../Generic/GenericResourcePreview';
import type { EmbedResourceKind } from '../Provider.types';
import { chooseNativeEmbed, getNativeEmbedCard } from './nativeEmbed.utils';

/** Renders the platform's own embed; `onError` is called when the platform says it cannot show it. */
export type RenderNativeEmbed = (options: { onError: () => void }) => ReactNode;

interface NativeEmbedResourceProps {
  /** The link as written: the post's embed. */
  url: string;
  kind: EmbedResourceKind;
  renderEmbed: RenderNativeEmbed;
  /**
   * The composer's preview: Pinakes is asked to read the link right away (`resolve`), so the
   * preview and the published post show its card; the same choice, without the footer.
   */
  isComposing?: boolean;
}

/**
 * `true` once the viewer has pressed inside the embed's frame (a press in an iframe moves the focus
 * there and blurs the page): from then on a card read later does not replace a playing embed.
 */
function useEmbedEngaged(box: React.RefObject<HTMLElement | null>): boolean {
  const [engaged, setEngaged] = useState(false);
  useEffect(() => {
    if (engaged) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Read after the blur: some browsers move the focus to the iframe only once it has fired.
    const onBlur = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const active = document.activeElement;
        if (active instanceof HTMLIFrameElement && box.current?.contains(active)) setEngaged(true);
      }, 0);
    };
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('blur', onBlur);
      clearTimeout(timer);
    };
  }, [box, engaged]);
  return engaged;
}

/**
 * A post's embedded link that the platform has its own embed for (an X post, a YouTube or Vimeo
 * video), as an external resource (`chooseNativeEmbed`):
 * - Pinakes knows it on other services too (Also on): our card, like every other link. A video
 *   plays from Play on (the card player, its dock); an X post shows from "Show on 𝕏". Nothing
 *   is loaded from the platform before that press.
 * - Otherwise (no Also on, no card yet, still pending): the platform's own embed in the resource
 *   frame (`ResourceEmbedFrame`), with the resource's header and footer.
 * - An embed the platform cannot show (a deleted post) gives way to the card when there is one.
 *
 * While Pinakes is read (at most `PINAKES_SLOW_READ_MS`) the card's skeleton holds the place, so a
 * platform embed is never loaded only to be swapped for the card. A link Pinakes does not know yet
 * is read again while on screen, like any embedded link. In the composer (`isComposing`) Pinakes
 * is asked to read it at once, and the preview makes the same choice without the footer.
 */
export function NativeEmbedResource(props: NativeEmbedResourceProps) {
  const { ref, isVisible } = useViewportObserver({ rootMargin: '0px' });
  const choice = <NativeEmbedChoice {...props} isOnScreen={isVisible} />;
  return (
    <div ref={ref} className="min-w-0" data-testid="native-embed-resource" data-kind={props.kind}>
      {/* The composer measures and snaps its own height; elsewhere the box grows smoothly. */}
      {props.isComposing ? choice : <AnimatedHeight>{choice}</AnimatedHeight>}
    </div>
  );
}

function NativeEmbedChoice({
  url,
  kind,
  renderEmbed,
  isComposing = false,
  isOnScreen,
}: NativeEmbedResourceProps & { isOnScreen: boolean }) {
  const { data, isLoading, isResolving } = usePinakesCard(
    url,
    isComposing ? { resolve: true } : { recheck: isOnScreen },
  );
  // In the composer a link Pinakes did not know is being read (`resolve`): wait for it too, so no
  // platform embed loads only to give way to the card.
  const isReading = isLoading || Boolean(isResolving);
  const isSlow = useSlowRead(url, isReading, PINAKES_SLOW_READ_MS);
  const embedRef = useRef<HTMLDivElement>(null);
  const engaged = useEmbedEngaged(embedRef);
  const [failed, setFailed] = useState(false);
  const [isPostOpen, setIsPostOpen] = useState(false);

  const card = getNativeEmbedCard(data);
  const alsoOn = card ? getMenuAlsoOn(card, url) : null;
  const choice = chooseNativeEmbed({
    hasCard: card !== null,
    hasAlsoOn: alsoOn !== null,
    embedFailed: failed,
    engaged,
  });
  const showsCard = choice === 'card' && card !== null;
  const isVideo = kind === 'video';
  const player = useCardPlayer(showsCard && isVideo && !isComposing ? card : null, url);
  const siteName = card ? getResourceLinks(card, url).siteName : null;

  // An X post on our card: ▶ and X's mark put the post's own embed in the card's body; while it shows,
  // the mark and ✕ close it: the card player's pill (`PlayOnPill`).
  const showLabel = isPostOpen ? `Close the ${siteName ?? 'X'} post` : `Show on ${siteName ?? 'X'}`;
  const showPost =
    showsCard && !isVideo && !failed && !isComposing ? (
      <PlayOnPill
        uri={url}
        isOpen={isPostOpen}
        label={showLabel}
        aria-expanded={isPostOpen}
        onClick={() => setIsPostOpen((open) => !open)}
        data-testid="show-embed"
      />
    ) : undefined;

  if (isReading && !isSlow) return <ResourceCardSkeleton withActions={!isComposing} />;

  const actions = isComposing ? null : (
    <ResourceActions
      uri={url}
      collectionsCount={card?.collections}
      tagsLabel={getResourceTagsLabel(card)}
      linkUrl={card ? getResourceLinks(card, url).linkUrl : getHttpUrl(url)}
      title={card?.name}
      playOn={showsCard ? (isVideo ? player.playOn : showPost) : undefined}
      extraMenuContent={
        alsoOn
          ? ({ variant, closeMenu }) => <ResourceAlsoOn alsoOn={alsoOn} variant={variant} closeMenu={closeMenu} />
          : undefined
      }
    />
  );

  if (showsCard) {
    const renderBody = isVideo
      ? player.renderBody
      : (body: ReactNode) =>
          isPostOpen && !failed ? (
            <Container overrideDefaults className="min-w-0" data-testid="native-embed-body">
              {renderEmbed({ onError: () => setFailed(true) })}
            </Container>
          ) : (
            body
          );
    return (
      <ResourceCard card={card} href={url} actions={actions} hasAlsoOn={alsoOn !== null} renderBody={renderBody} />
    );
  }

  return (
    <ResourceEmbedFrame url={url} card={card} actions={actions} fallbackTypeLabel={isVideo ? 'Video' : 'Post'}>
      <div ref={embedRef} className="min-w-0" data-testid="native-embed-body">
        {renderEmbed({ onError: () => setFailed(true) })}
      </div>
    </ResourceEmbedFrame>
  );
}
