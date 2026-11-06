import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPlayerTarget } from './resourcePlayer.utils';
import { ResourcePlayerFrame } from './ResourcePlayerFrame';
import { useResourcePlayer } from './useResourcePlayer';

const SPOTIFY = getPlayerTarget('https://open.spotify.com/track/1YQWosTIljIvxAgHWTp7KP')!;
const YOUTUBE = getPlayerTarget('https://www.youtube.com/watch?v=dQw4w9WgXcQ')!;
const TIDAL = getPlayerTarget('https://tidal.com/browse/track/77646168')!;
const MIXCLOUD = getPlayerTarget('https://www.mixcloud.com/spartacus/party-time/')!;

/** The frame's window, with its `postMessage` watched. */
function watchFrame() {
  const frame = screen.getByTestId('resource-player-frame') as HTMLIFrameElement;
  const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});
  return { frame, post };
}

function postFromFrame(frame: HTMLIFrameElement, data: unknown, origin = 'https://open.spotify.com') {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin, source: frame.contentWindow }));
  });
}

function Player({ target }: { target: typeof SPOTIFY }) {
  const player = useResourcePlayer('frame-test', [target]);
  if (!player.current) {
    return (
      <button type="button" onClick={() => player.play(target)}>
        play
      </button>
    );
  }
  return (
    <ResourcePlayerFrame target={player.current} title="Get Lucky" load={player.load} onLoaded={player.onLoaded} />
  );
}

describe('ResourcePlayerFrame', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads the service’s own player, sandboxed, with what its embed code allows', () => {
    render(<ResourcePlayerFrame target={SPOTIFY} title="Get Lucky" load="loading" onLoaded={() => {}} />);

    const frame = screen.getByTestId('resource-player-frame');
    expect(frame).toHaveAttribute('src', SPOTIFY.src);
    expect(frame).toHaveAttribute('title', 'Spotify player: Get Lucky');
    expect(frame).toHaveAttribute('allow', SPOTIFY.allow);
    expect(frame).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    const sandbox = frame.getAttribute('sandbox')!.split(' ');
    expect(sandbox).toEqual(expect.arrayContaining(['allow-scripts', 'allow-same-origin', 'allow-popups']));
    expect(sandbox).not.toContain('allow-top-navigation');
    expect(screen.getByRole('region', { name: 'Spotify player: Get Lucky' })).toHaveAttribute('aria-busy', 'true');
  });

  it('says a press inside the player is needed for a service that cannot start on our press', () => {
    render(<ResourcePlayerFrame target={MIXCLOUD} title="Party Time" load="ready" onLoaded={() => {}} />);

    expect(screen.getByTestId('resource-player-status')).toHaveTextContent(
      'Press play in the Mixcloud player to start.',
    );
  });

  it('tells Spotify to play once its embed is ready, only from Spotify’s own frame, and says nothing more', () => {
    render(<ResourcePlayerFrame target={SPOTIFY} title="Get Lucky" load="ready" onLoaded={() => {}} />);
    const { frame, post } = watchFrame();

    postFromFrame(frame, { type: 'ready' }, 'https://evil.example');
    postFromFrame(frame, { type: 'playback_update' });
    expect(post).not.toHaveBeenCalled();

    postFromFrame(frame, { type: 'ready' });
    postFromFrame(frame, { type: 'ready' });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({ command: 'play' }, 'https://open.spotify.com');
    expect(screen.getByTestId('resource-player-status')).toBeEmptyDOMElement();
  });

  it('ignores a ready message from another window', () => {
    render(<ResourcePlayerFrame target={SPOTIFY} title="Get Lucky" load="ready" onLoaded={() => {}} />);
    const { post } = watchFrame();

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'ready' }, origin: 'https://open.spotify.com', source: window }),
      );
    });

    expect(post).not.toHaveBeenCalled();
  });

  it('tells TIDAL to play once its frame has loaded, once', () => {
    const onLoaded = vi.fn();
    render(<ResourcePlayerFrame target={TIDAL} title="Internal Calm" load="loading" onLoaded={onLoaded} />);
    const { frame, post } = watchFrame();

    expect(frame).toHaveAttribute('allow', expect.stringContaining('autoplay'));
    act(() => frame.dispatchEvent(new Event('load')));
    act(() => frame.dispatchEvent(new Event('load')));

    expect(onLoaded).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('{"commandName":"play"}', 'https://embed.tidal.com');
  });

  it('tells a player to play once per frame, also across a re-render with an equal target', () => {
    const { rerender } = render(
      <ResourcePlayerFrame target={SPOTIFY} title="Get Lucky" load="ready" onLoaded={() => {}} />,
    );
    const { frame, post } = watchFrame();

    postFromFrame(frame, { type: 'ready' });
    rerender(
      <ResourcePlayerFrame
        target={{ ...SPOTIFY, start: { ...SPOTIFY.start! } }}
        title="Get Lucky"
        load="ready"
        onLoaded={() => {}}
      />,
    );
    postFromFrame(frame, { type: 'ready' });

    expect(post).toHaveBeenCalledTimes(1);
  });

  it('tells a frame that loads another player address to play again, once', () => {
    const { rerender } = render(
      <ResourcePlayerFrame target={SPOTIFY} title="Get Lucky" load="ready" onLoaded={() => {}} />,
    );
    const { frame, post } = watchFrame();

    postFromFrame(frame, { type: 'ready' });
    rerender(
      <ResourcePlayerFrame
        target={{ ...SPOTIFY, src: `${SPOTIFY.src}?x` }}
        title="Get Lucky"
        load="ready"
        onLoaded={() => {}}
      />,
    );
    // The new address is a new document: the frame may have a new window (jsdom gives it one).
    const next = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});
    postFromFrame(frame, { type: 'ready' });
    postFromFrame(frame, { type: 'ready' });

    expect(post.mock.calls.length + (next === post ? 0 : next.mock.calls.length)).toBe(2);
  });

  it('tells TIDAL to play once, also when an equal target re-renders and the frame loads again', () => {
    const { rerender } = render(
      <ResourcePlayerFrame target={TIDAL} title="Internal Calm" load="loading" onLoaded={() => {}} />,
    );
    const { frame, post } = watchFrame();

    act(() => frame.dispatchEvent(new Event('load')));
    rerender(
      <ResourcePlayerFrame
        target={{ ...TIDAL, start: { ...TIDAL.start! } }}
        title="Internal Calm"
        load="ready"
        onLoaded={() => {}}
      />,
    );
    act(() => frame.dispatchEvent(new Event('load')));

    expect(post).toHaveBeenCalledTimes(1);
  });

  it('sends no message to a player that starts by its own address', () => {
    render(<ResourcePlayerFrame target={YOUTUBE} title="Video" load="loading" onLoaded={() => {}} />);
    const { frame, post } = watchFrame();

    act(() => frame.dispatchEvent(new Event('load')));
    postFromFrame(frame, { type: 'ready' }, 'https://www.youtube-nocookie.com');

    expect(post).not.toHaveBeenCalled();
  });

  it('says nothing more once a player that starts on load has loaded', () => {
    render(<ResourcePlayerFrame target={YOUTUBE} title="Video" load="ready" onLoaded={() => {}} />);

    expect(screen.getByTestId('resource-player-status')).toBeEmptyDOMElement();
  });

  it('offers the service’s page when the frame has not loaded after a while', () => {
    vi.useFakeTimers();
    render(<Player target={SPOTIFY} />);

    act(() => screen.getByRole('button', { name: 'play' }).click());
    act(() => vi.advanceTimersByTime(12_000));

    expect(screen.getByTestId('resource-player-status')).toHaveTextContent('Spotify has not answered.');
    expect(screen.getByRole('link', { name: 'Open in Spotify' })).toHaveAttribute('href', SPOTIFY.link);
  });
});
