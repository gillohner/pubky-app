import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlayerTarget } from './resourcePlayer.utils';
import { PlayerDock } from './ResourcePlayerControls';

const SPOTIFY = getPlayerTarget('https://open.spotify.com/track/1YQWosTIljIvxAgHWTp7KP')!;

let report: ((entries: { isIntersecting: boolean }[]) => void) | null = null;

class MockIntersectionObserver {
  constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
    report = callback;
  }

  observe = vi.fn();
  disconnect = vi.fn();
}

describe('PlayerDock', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    report = null;
  });

  const renderDock = (onClose = vi.fn()) => {
    render(
      <PlayerDock target={SPOTIFY} title="Get Lucky" onClose={onClose}>
        <iframe title="player" />
      </PlayerDock>,
    );
    return onClose;
  };

  it('keeps the player in the card while it is in view, marked to keep playing off screen', () => {
    renderDock();

    expect(screen.getByTestId('player-dock-slot')).not.toHaveAttribute('data-docked');
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.getByTitle('player').closest('[data-keep-playing]')).not.toBeNull();
  });

  it('moves the same player into the dock when the card scrolls away, and back when it returns', () => {
    renderDock();
    const frame = screen.getByTitle('player');

    act(() => report?.([{ isIntersecting: false }]));
    const dock = screen.getByRole('complementary', { name: 'Player dock: Get Lucky' });
    expect(dock).toContainElement(frame);
    expect(dock).toHaveClass('fixed', 'z-40');
    expect(screen.getByTestId('player-dock-slot')).toHaveAttribute('data-docked', 'true');

    act(() => report?.([{ isIntersecting: true }]));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.getByTitle('player')).toBe(frame);
  });

  it('closes the player from the dock, and scrolls back to the card', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    const onClose = renderDock();
    act(() => report?.([{ isIntersecting: false }]));

    fireEvent.click(screen.getByRole('button', { name: 'Back to Get Lucky' }));
    expect(scrollIntoView).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close the Spotify player' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
