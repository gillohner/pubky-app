import { describe, expect, it } from 'vitest';
import type { NexusTag } from '@/services/nexus/nexus.types';
import videoFixture from '@/services/pinakes/fixtures/by-uri.video.json';
import type { TPinakesAlsoOn, TPinakesResourceDetail } from '@/services/pinakes/pinakes.types';
import {
  getActionUri,
  getOtherLinks,
  getOwnLinkUris,
  getThreadUri,
  MAX_OTHER_LINKS,
  MAX_OTHER_TAGS,
  mergeOtherLinkTags,
} from './ResourceOtherTags.utils';

const LETTERBOXD = 'https://letterboxd.com/film/the-matrix/';
const NETFLIX = 'https://www.netflix.com/title/20557937';
const TMDB = 'https://www.themoviedb.org/movie/603';
const IMDB = 'https://www.imdb.com/title/tt0133093/';

const tag = (label: string, taggers: string[], count = taggers.length): NexusTag => ({
  label,
  taggers,
  taggers_count: count,
  relationship: false,
  tag_uri: null,
});

describe('getOwnLinkUris', () => {
  it('is the acted-on link only: Nexus keeps the card’s other spellings apart', () => {
    expect([...getOwnLinkUris(LETTERBOXD)]).toEqual([LETTERBOXD]);
  });
});

describe('getOtherLinks', () => {
  const card = { id: 'letterboxd', also_on: [] as TPinakesAlsoOn[] };
  const own = new Set([LETTERBOXD]);

  it('lists the other group members, their written links first, then Also on, by URI once each', () => {
    const links = getOtherLinks(
      {
        ...card,
        also_on: [
          { uri: NETFLIX, id: 'netflix', site: 'Netflix' },
          { uri: IMDB, site: 'IMDb' },
        ],
      },
      [
        { id: 'netflix', uri: NETFLIX, refs: [NETFLIX], site: 'Netflix' },
        { id: 'letterboxd', uri: LETTERBOXD, refs: [LETTERBOXD], site: 'Letterboxd' },
        { id: 'tmdb', uri: TMDB, refs: ['https://themoviedb.org/movie/603', TMDB], site: 'TMDB' },
      ],
      own,
    );
    expect(links).toEqual([
      { uri: NETFLIX, name: 'Netflix' },
      { uri: 'https://themoviedb.org/movie/603', name: 'TMDB' },
      { uri: TMDB, name: 'TMDB' },
      { uri: IMDB, name: 'IMDb' },
    ]);
  });

  it('reads the card’s other spellings first, named by its service: Nexus tags each apart', () => {
    const links = getOtherLinks(
      {
        ...card,
        uri: LETTERBOXD,
        refs: [LETTERBOXD, 'https://boxd.it/29Lu'],
        aliases: ['http://letterboxd.com/film/the-matrix'],
        site: 'Letterboxd',
        also_on: [{ uri: NETFLIX, site: 'Netflix' }],
      },
      null,
      own,
    );
    expect(links).toEqual([
      { uri: 'https://boxd.it/29Lu', name: 'Letterboxd' },
      { uri: 'http://letterboxd.com/film/the-matrix', name: 'Letterboxd' },
      { uri: NETFLIX, name: 'Netflix' },
    ]);
  });

  it('never lists one of the page link’s own URIs, even under another member', () => {
    const links = getOtherLinks(
      { id: 'a', also_on: [{ uri: LETTERBOXD, site: 'Letterboxd' }] },
      [{ id: 'b', uri: 'https://example.com/b', refs: [LETTERBOXD], site: null }],
      own,
    );
    expect(links.map((link) => link.uri)).toEqual(['https://example.com/b']);
  });

  it('leaves out derived Also on links, which nobody tagged', () => {
    const links = getOtherLinks(
      {
        ...card,
        also_on: [
          { uri: IMDB, site: 'IMDb', derived: true, via: 'wikidata' },
          { uri: NETFLIX, site: 'Netflix' },
        ],
      },
      null,
      own,
    );
    expect(links).toEqual([{ uri: NETFLIX, name: 'Netflix' }]);
  });

  it('names a link without a service by its host', () => {
    expect(getOtherLinks({ ...card, also_on: [{ uri: 'https://mubi.com/films/3394' }] }, undefined, own)).toEqual([
      { uri: 'https://mubi.com/films/3394', name: 'mubi.com' },
    ]);
  });

  it('reads at most MAX_OTHER_LINKS links', () => {
    const also_on = Array.from({ length: MAX_OTHER_LINKS + 5 }, (_, index) => ({ uri: `https://e.com/${index}` }));
    expect(getOtherLinks({ ...card, also_on }, null, own)).toHaveLength(MAX_OTHER_LINKS);
  });
});

describe('mergeOtherLinkTags', () => {
  const netflix = { uri: NETFLIX, name: 'Netflix' };
  const tmdb = { uri: TMDB, name: 'TMDB' };

  it('merges one label across links, counting a person who tagged both links once', () => {
    const merged = mergeOtherLinkTags([
      { link: netflix, tags: [tag('film', ['ann']), tag('netflix', ['ann'])] },
      { link: tmdb, tags: [tag('film', ['ann', 'bob', 'cy']), tag('scifi', ['bob', 'cy'])] },
    ]);
    expect(merged.map(({ label, count }) => [label, count])).toEqual([
      ['film', 3],
      ['scifi', 2],
      ['netflix', 1],
    ]);
    expect(merged[0].taggers.sort()).toEqual(['ann', 'bob', 'cy']);
    expect(merged[0].isComplete).toBe(true);
    expect(merged[0].sources).toEqual([
      { uri: TMDB, name: 'TMDB', count: 3 },
      { uri: NETFLIX, name: 'Netflix', count: 1 },
    ]);
  });

  it('joins labels as Nexus stores them, case-folded', () => {
    const merged = mergeOtherLinkTags([
      { link: netflix, tags: [tag('Film', ['ann'])] },
      { link: tmdb, tags: [tag('film', ['bob'])] },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ label: 'film', count: 2 });
  });

  it('counts at least the most taggers one link has when Nexus lists fewer than it counts', () => {
    const merged = mergeOtherLinkTags([
      { link: netflix, tags: [tag('film', ['ann'], 1)] },
      { link: tmdb, tags: [tag('film', ['ann', 'bob'], 9)] },
    ]);
    expect(merged[0].count).toBe(9);
    expect(merged[0].isComplete).toBe(false);
    expect(merged[0].sources.map((source) => source.count)).toEqual([9, 1]);
  });

  it('lists a link once per chip when it holds two spellings of the label, with the larger count', () => {
    const merged = mergeOtherLinkTags([{ link: netflix, tags: [tag('Film', ['ann']), tag('film', ['ann', 'bob'])] }]);
    expect(merged).toEqual([
      { label: 'film', taggers: ['ann', 'bob'], count: 2, isComplete: true, sources: [{ ...netflix, count: 2 }] },
    ]);
  });

  it('keeps each label’s taggers to its own links: no tagger of one label shows under another', () => {
    const merged = mergeOtherLinkTags([
      { link: netflix, tags: [tag('film', ['ann']), tag('movie', ['dan'])] },
      { link: tmdb, tags: [tag('movie', ['eve'])] },
    ]);
    expect(merged.find((entry) => entry.label === 'film')?.taggers).toEqual(['ann']);
    expect(merged.find((entry) => entry.label === 'movie')?.taggers).toEqual(['dan', 'eve']);
  });

  it('orders by taggers, then by links, then by label, and keeps at most MAX_OTHER_TAGS', () => {
    const many = Array.from({ length: MAX_OTHER_TAGS + 3 }, (_, index) =>
      tag(`t${String(index).padStart(2, '0')}`, ['a']),
    );
    const merged = mergeOtherLinkTags([
      { link: netflix, tags: [...many, tag('both', ['a'])] },
      { link: tmdb, tags: [tag('both', ['a'])] },
    ]);
    expect(merged).toHaveLength(MAX_OTHER_TAGS);
    expect(merged[0].label).toBe('both');
    expect(merged[1].label).toBe('t00');
  });

  it('is empty when no other link has tags', () => {
    expect(mergeOtherLinkTags([])).toEqual([]);
    expect(mergeOtherLinkTags([{ link: netflix, tags: [] }])).toEqual([]);
  });
});

describe('getThreadUri', () => {
  const card: TPinakesResourceDetail = { ...(videoFixture as TPinakesResourceDetail), refs: ['https://youtu.be/x'] };

  it('is the acted-on link once the card is read', () => {
    expect(getThreadUri(card.uri, { data: card, isLoading: false }, true)).toBe(getActionUri(card, card.uri));
  });

  it('is nothing while the card is read, so the thread is read once', () => {
    expect(getThreadUri(card.uri, { data: undefined, isLoading: true }, true)).toBeNull();
  });

  it.each([
    ['without a card', { data: null, isLoading: false }, true],
    ['when Pinakes is not configured', { data: undefined, isLoading: true }, false],
  ])('is the page’s link %s', (_name, read, configured) => {
    expect(getThreadUri('https://example.com/a', read, configured)).toBe('https://example.com/a');
  });

  it('is nothing without a link', () => {
    expect(getThreadUri(null, { data: null, isLoading: false }, true)).toBeNull();
  });
});
