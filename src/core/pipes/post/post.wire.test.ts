import { PubkyAppPost, PubkyAppPostEmbed, PubkyAppPostKind } from 'pubky-app-specs';
import { describe, expect, it } from 'vitest';
import { normalizePostEmbed, toPostWire, validatePostWire } from '@/pipes/post/post.wire';

describe('toPostWire', () => {
  it('adapts real WASM output and legacy embeds to canonical wire fields', () => {
    const post = new PubkyAppPost(
      'hello',
      PubkyAppPostKind.Short,
      null,
      new PubkyAppPostEmbed('https://example.com', PubkyAppPostKind.Link),
    );
    expect(toPostWire(post)).toMatchObject({ kind: 'short', embed: 'https://example.com/', parent: null, lock: null });
  });

  it.each(['event', 'Event', 'Image', 'SHORT', 'unknown'])('preserves raw %s without enum interpretation', (kind) => {
    expect(toPostWire({ kind, content: ' {} ' })).toMatchObject({ kind, content: ' {} ' });
  });
});

describe('generic post validation', () => {
  it.each(['', ' event', 'a,b', 'a\nb', 'é'.repeat(65)])('rejects invalid kind %j', (kind) => {
    expect(() => validatePostWire({ kind, content: '{}' })).toThrow();
  });

  it('does not normalize identifiers at validation', () => {
    const post = { kind: 'Event:custom', content: ' {} ' };
    expect(validatePostWire(post)).toBe(post);
  });

  it.each(['[DELETED]', '   '])('rejects empty or reserved content %j', (content) => {
    expect(() => validatePostWire({ kind: 'event', content })).toThrow();
  });
});

describe('universal embed gate', () => {
  it.each([
    [' GEO:1,2 ', 'geo:1,2'],
    ['https://Example.com/Case#Fragment', 'https://Example.com/Case#Fragment'],
    ['nostr:ABC', 'nostr:ABC'],
  ])('normalizes only scheme and surrounding whitespace for %s', (input, expected) => {
    expect(normalizePostEmbed(input)).toBe(expected);
  });

  it.each([
    'https:///',
    'geo:',
    '1geo:a',
    'https://a\nb',
    'no-scheme',
    'pubky+private:secret',
    'pubky://invalid/pub/a',
    'geo:' + 'a'.repeat(1021),
  ])('rejects %s', (uri) => {
    expect(() => normalizePostEmbed(uri)).toThrow();
  });
});
