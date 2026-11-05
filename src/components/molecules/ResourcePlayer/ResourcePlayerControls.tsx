'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, ChevronDown, Play, X } from 'lucide-react';
import { Button } from '@/atoms/Button/Button';
import { Container } from '@/atoms/Container/Container';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/atoms/DropdownMenu/DropdownMenu';
import { Typography } from '@/atoms/Typography/Typography';
import { KEEP_PLAYING_ATTRIBUTE } from '@/hooks/usePauseMediaOutsideViewport/usePauseMediaOutsideViewport';
import { cn } from '@/libs/utils/utils';
import { ResourceSourceIcon } from '@/molecules/ResourceCard/ResourceSourceIcon';
import type { PlayerTarget } from './resourcePlayer.utils';
import type { ResourcePlayerState } from './useResourcePlayer';

interface ProviderMenuProps {
  targets: PlayerTarget[];
  player: ResourcePlayerState;
  trigger: ReactNode;
  align?: 'start' | 'end';
}

const ROW = 'group gap-2 p-0';
const ROW_TEXT = 'truncate text-base font-medium transition-colors group-hover:text-foreground';

/**
 * The services to play on, in the post menu's style: one line per service (favicon and name), the
 * playing one in full colour with a check, then Close.
 */
export function ProviderMenu({ targets, player, trigger, align = 'start' }: ProviderMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        aria-label="Play on"
        className="flex w-56 flex-col gap-2.5"
        data-testid="play-on-menu"
      >
        {targets.map((target) => {
          const playing = player.current?.provider === target.provider;
          return (
            <DropdownMenuItem
              key={target.provider}
              data-testid="play-on-row"
              aria-current={playing || undefined}
              onSelect={() => player.play(target)}
              className={ROW}
            >
              <ResourceSourceIcon uri={target.link} />
              <Typography
                as="span"
                overrideDefaults
                className={cn(ROW_TEXT, 'min-w-0 flex-1', playing ? 'text-foreground' : 'text-muted-foreground')}
              >
                {target.name}
              </Typography>
              {playing && <Check aria-hidden="true" className="size-4 shrink-0 text-brand" />}
            </DropdownMenuItem>
          );
        })}
        {player.current && (
          <DropdownMenuItem onSelect={player.close} className={ROW}>
            <X
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
            />
            <Typography as="span" overrideDefaults className={cn(ROW_TEXT, 'text-muted-foreground')}>
              Close player
            </Typography>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const PILL_COMPACT = 'max-sm:gap-0.5 max-sm:px-2 max-sm:has-[>svg]:px-2';

/**
 * "▶ Play on <service logo> ⌄", a split pill for the action row: the main part plays the first
 * service (or closes the open player), the chevron picks another. The service is named by its logo
 * (the name is in the accessible name), so the pill and "Open in <site>" fit one row of a post. On a
 * phone the words are hidden: play icon, logo and chevron.
 */
export function PlayOnSplit({ targets, player }: { targets: PlayerTarget[]; player: ResourcePlayerState }) {
  const shown = player.current ?? targets[0];
  if (!shown) return null;
  const isOpen = player.current !== null;
  const hasMenu = targets.length > 1;
  return (
    <Container overrideDefaults role="group" aria-label="Player" className="flex shrink-0 items-center">
      <Button
        variant="default"
        size="sm"
        data-testid="play-on-main"
        aria-label={isOpen ? `Close the ${shown.name} player` : `Play on ${shown.name}`}
        onClick={() => (isOpen ? player.close() : player.play(shown))}
        className={cn(PILL_COMPACT, hasMenu && 'rounded-r-none border-r-0 pr-2.5 max-sm:pr-1.5')}
      >
        {isOpen ? <X aria-hidden="true" /> : <Play aria-hidden="true" className="fill-current" />}
        <span className="max-sm:hidden">{isOpen ? 'Close' : 'Play on'}</span>
        <ResourceSourceIcon uri={shown.link} />
      </Button>
      {hasMenu && (
        <ProviderMenu
          targets={targets}
          player={player}
          trigger={
            <Button
              variant="default"
              size="sm"
              data-testid="play-on-trigger"
              aria-label="Play on another service"
              className="rounded-l-none border-l-brand/40 px-2 has-[>svg]:px-2 max-sm:px-1.5 max-sm:has-[>svg]:px-1.5"
            >
              <ChevronDown aria-hidden="true" className="max-sm:size-3" />
            </Button>
          }
        />
      )}
    </Container>
  );
}

/**
 * Keeps an open player on screen when its card scrolls away: the player's box becomes a small fixed
 * dock (CSS only, the frame is never moved, so it keeps playing) with Close and a way back; back in
 * view it returns to the card. The dock sits above the phone's bottom bar and left of the new-post
 * button (Fab: right-3 bottom-18 size-20, sm:right-10, md:bottom-20, lg:bottom-6), so it never
 * covers either. Audio uses the service's compact height; video stays at least 200 px high.
 */
export function PlayerDock({
  target,
  title,
  onClose,
  children,
}: {
  target: PlayerTarget;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const slotRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [docked, setDocked] = useState(false);
  const [slotHeight, setSlotHeight] = useState<number | null>(null);

  useEffect(() => {
    const slot = slotRef.current;
    if (!slot || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting && boxRef.current && !boxRef.current.dataset.docked) {
          setSlotHeight(boxRef.current.offsetHeight);
        }
        setDocked(!entry.isIntersecting);
      },
      { threshold: 0 },
    );
    observer.observe(slot);
    return () => observer.disconnect();
  }, []);

  const backToCard = () => slotRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  return (
    <div
      ref={slotRef}
      style={docked && slotHeight ? { height: slotHeight } : undefined}
      className={cn('relative min-w-0', docked && 'rounded-md border border-dashed border-border')}
      data-testid="player-dock-slot"
      data-docked={docked ? 'true' : undefined}
    >
      {docked && (
        <Container overrideDefaults className="flex h-full items-center justify-center p-3">
          <Button variant="outline" size="sm" onClick={backToCard}>
            Playing in the dock · Back here
          </Button>
        </Container>
      )}
      <div
        ref={boxRef}
        data-docked={docked ? 'true' : undefined}
        className={cn(
          docked && [
            'fixed right-26 bottom-18 left-3 z-40 flex items-start gap-1 rounded-lg border border-border bg-popover p-1 shadow-2xl',
            'sm:right-34 sm:left-auto sm:w-96 md:bottom-20 lg:bottom-6',
            '[&_[data-player-region]]:h-(--player-dock-h) [&_[data-testid=resource-player-status]]:sr-only',
          ],
        )}
        // A post pauses its media once off screen (`usePauseMediaOutsideViewport`); the player then
        // plays on in the dock.
        {...{ [KEEP_PLAYING_ATTRIBUTE]: 'true' }}
        role={docked ? 'complementary' : undefined}
        aria-label={docked ? `Player dock: ${title}` : undefined}
      >
        <div className="min-w-0 flex-1">{children}</div>
        {docked && (
          <Container overrideDefaults className="flex shrink-0 flex-col" data-testid="player-dock-bar">
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Close the ${target.name} player`}
              data-testid="player-dock-close"
              onClick={onClose}
              className="size-8 text-muted-foreground hover:text-foreground"
            >
              <X aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Back to ${title}`}
              data-testid="player-dock-back"
              onClick={backToCard}
              className="size-8 text-muted-foreground hover:text-foreground"
            >
              <ArrowUp aria-hidden="true" />
            </Button>
          </Container>
        )}
      </div>
    </div>
  );
}
