import { limits } from 'pubky-social-specs';
import { describe, expect, it } from 'vitest';
import { getComposerEmbedUrl, getShownEmbedUrl, getWebEmbedUrl } from './postEmbedUrl';

describe('getWebEmbedUrl', () => {
  it.each(['https://en.wikipedia.org/wiki/Bitcoin', 'http://example.com/a?b=c#d'])('returns the web link %s', (url) => {
    expect(getWebEmbedUrl(url)).toBe(url);
  });

  it.each([
    null,
    undefined,
    '',
    'pubky://pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy/pub/social/v1/posts/0035QZPT4QG00',
    'isbn:9780140328721',
    'javascript:alert(1)',
    'data:text/html,hi',
    'HTTPS://example.com',
    ' https://example.com',
  ])('returns null for %s', (value) => {
    expect(getWebEmbedUrl(value)).toBeNull();
  });
});

describe('getComposerEmbedUrl', () => {
  it('returns the first link of the text', () => {
    expect(getComposerEmbedUrl('Read https://en.wikipedia.org/wiki/Bitcoin and https://luma.com/376whqyw')).toBe(
      'https://en.wikipedia.org/wiki/Bitcoin',
    );
  });

  it.each(['see example.com/page', 'see en.wikipedia.org/wiki/Bitcoin and https://luma.com/376whqyw'])(
    'returns null when the first link is written without a scheme: %s',
    (content) => {
      expect(getComposerEmbedUrl(content)).toBeNull();
    },
  );

  it.each(['HTTPS://example.com/page', 'see //example.com/page'])('returns null for %s', (content) => {
    expect(getComposerEmbedUrl(content)).toBeNull();
  });

  it('returns null without a link', () => {
    expect(getComposerEmbedUrl('no links here')).toBeNull();
  });

  it('returns null for a link to this app', () => {
    expect(getComposerEmbedUrl(`look ${window.location.origin}/post/abc/123`)).toBeNull();
  });

  it('returns null for a link longer than the data model stores', () => {
    const url = `https://example.com/${'a'.repeat(limits.referenceUriMaxLength)}`;
    expect(getComposerEmbedUrl(url)).toBeNull();
  });
});

describe('getShownEmbedUrl', () => {
  const EMBED = 'https://a.example/page';

  it.each([`Read ${EMBED}`, `Read b.example first, then ${EMBED}`, `Read [this](${EMBED})`])(
    'returns the embed while the text holds its link: %s',
    (content) => {
      expect(getShownEmbedUrl(EMBED, content)).toBe(EMBED);
    },
  );

  it.each(['Read https://b.example/page', 'Read it later', `Read ${EMBED}/more`])(
    'returns null once the text no longer holds the link: %s',
    (content) => {
      expect(getShownEmbedUrl(EMBED, content)).toBeNull();
    },
  );

  it('returns the embed of a post without text', () => {
    expect(getShownEmbedUrl(EMBED, '  ')).toBe(EMBED);
  });

  it.each([null, undefined])('returns null without an embed (%s)', (embed) => {
    expect(getShownEmbedUrl(embed, `Read ${EMBED}`)).toBeNull();
  });
});
