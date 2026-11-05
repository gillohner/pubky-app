import { describe, expect, it } from 'vitest';
import type { TPinakesAlsoOn } from '@/services/pinakes/pinakes.types';
import { getPlayerTarget, getPlayerTargets, PlayerProvider } from './resourcePlayer.utils';

const card = (uri: string, alsoOn: TPinakesAlsoOn[] = [], status = 'ok') => ({ uri, status, also_on: alsoOn });

describe('getPlayerTarget', () => {
  it('builds a youtube-nocookie player from a watch link, dropping everything else', () => {
    const target = getPlayerTarget('https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc&t=10');
    expect(target?.provider).toBe(PlayerProvider.YOUTUBE);
    expect(target?.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1&autoplay=1&rel=0');
    expect(target?.layout).toEqual({ kind: 'video' });
  });

  it('plays a YouTube playlist as a video series', () => {
    const target = getPlayerTarget('https://www.youtube.com/playlist?list=OLAK5uy_kNhM2yaBTOVwrcZJepB1C9P3-n5_Sfy5c');
    expect(target?.src).toContain(
      'https://www.youtube-nocookie.com/embed/videoseries?list=OLAK5uy_kNhM2yaBTOVwrcZJepB1C9P3-n5_Sfy5c',
    );
  });

  it('reads Spotify kinds with their documented heights', () => {
    expect(getPlayerTarget('https://open.spotify.com/track/69kOkLUCkxIZYexIgSG8rq?si=x')).toMatchObject({
      src: 'https://open.spotify.com/embed/track/69kOkLUCkxIZYexIgSG8rq',
      layout: { kind: 'audio', height: 152, dockHeight: 80 },
    });
    expect(getPlayerTarget('https://open.spotify.com/intl-de/show/2VRS1IJCTn2Nlkg33ZVfkM')?.layout).toEqual({
      kind: 'audio',
      height: 352,
      dockHeight: 80,
    });
  });

  it('starts Spotify and TIDAL on our press by their embed messages; Mixcloud needs a press inside', () => {
    expect(getPlayerTarget('https://open.spotify.com/track/69kOkLUCkxIZYexIgSG8rq')).toMatchObject({
      autoplay: true,
      start: { origin: 'https://open.spotify.com', message: { command: 'play' }, readyType: 'ready' },
    });
    expect(getPlayerTarget('https://tidal.com/browse/track/77646168')).toMatchObject({
      autoplay: true,
      start: { origin: 'https://embed.tidal.com', message: '{"commandName":"play"}' },
    });
    const mixcloud = getPlayerTarget('https://www.mixcloud.com/spartacus/party-time/');
    expect(mixcloud?.autoplay).toBe(false);
    expect(mixcloud?.start).toBeUndefined();
    expect(getPlayerTarget('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.start).toBeUndefined();
  });

  it('builds SoundCloud, Mixcloud, TIDAL and Vimeo players from links', () => {
    expect(getPlayerTarget('https://soundcloud.com/forss/flickermood')?.src).toBe(
      'https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fforss%2Fflickermood&auto_play=true&visual=false&show_teaser=false',
    );
    expect(
      getPlayerTarget('https://soundcloud.com/daftpunkofficialmusic/sets/random-access-memories-4')?.layout,
    ).toEqual({
      kind: 'audio',
      height: 450,
    });
    expect(getPlayerTarget('https://www.mixcloud.com/spartacus/party-time/')?.src).toBe(
      'https://www.mixcloud.com/widget/iframe/?feed=https%3A%2F%2Fwww.mixcloud.com%2Fspartacus%2Fparty-time%2F&hide_cover=1&autoplay=1',
    );
    expect(getPlayerTarget('https://tidal.com/track/490851477')?.src).toBe('https://embed.tidal.com/tracks/490851477');
    expect(getPlayerTarget('https://tidal.com/browse/album/20115556')?.layout).toEqual({
      kind: 'audio',
      height: 275,
      dockHeight: 120,
    });
    expect(getPlayerTarget('https://vimeo.com/1084537')?.src).toBe(
      'https://player.vimeo.com/video/1084537?autoplay=1&dnt=1',
    );
  });

  it('plays a plain https audio file in the browser player', () => {
    expect(getPlayerTarget('https://example.com/files/episode.mp3')).toMatchObject({ element: 'audio' });
  });

  it.each([
    'http://open.spotify.com/track/69kOkLUCkxIZYexIgSG8rq',
    'https://open.spotify.com.evil.example/track/69kOkLUCkxIZYexIgSG8rq',
    'https://user:pw@www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ',
    'https://soundcloud.com/discover/sets/x',
    'https://soundcloud.com/forss/likes',
    'https://www.deezer.com/album/320429237',
    'https://music.apple.com/song/1440717826',
    'https://www.youtube.com/channel/UCVMF2HD4ZgC0QHpU9Yq5Xrw',
    'javascript:alert(1)',
  ])('offers no player for %s', (link) => {
    expect(getPlayerTarget(link)).toBeNull();
  });
});

describe('getPlayerTargets', () => {
  it('lists one player per service: own link first, then Also on in Pinakes’ order', () => {
    const targets = getPlayerTargets(
      card('https://open.spotify.com/track/69kOkLUCkxIZYexIgSG8rq', [
        { uri: 'https://www.deezer.com/track/67238735', site: 'Deezer' },
        { uri: 'https://tidal.com/track/20115564', site: 'TIDAL', derived: true },
        { uri: 'https://www.youtube.com/watch?v=5NV6Rdv1a3I', site: 'YouTube' },
        { uri: 'https://open.spotify.com/track/118Opfz7qv2KA1g3Pmyk9T', site: 'Spotify', derived: true },
        { uri: 'https://www.youtube.com/watch?v=4D7u5KF7SP8', site: 'YouTube', derived: true },
      ] as TPinakesAlsoOn[]),
    );
    expect(targets.map((target) => target.provider)).toEqual([
      PlayerProvider.SPOTIFY,
      PlayerProvider.TIDAL,
      PlayerProvider.YOUTUBE,
    ]);
    expect(targets[2].link).toBe('https://www.youtube.com/watch?v=5NV6Rdv1a3I');
  });

  it('skips the own link of a card that is gone upstream', () => {
    const targets = getPlayerTargets(
      card(
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        [{ uri: 'https://vimeo.com/1084537' }] as TPinakesAlsoOn[],
        'missing',
      ),
    );
    expect(targets.map((target) => target.provider)).toEqual([PlayerProvider.VIMEO]);
  });

  it('offers nothing for a card on services we do not embed', () => {
    expect(getPlayerTargets(card('https://www.deezer.com/album/320429237'))).toEqual([]);
  });
});
