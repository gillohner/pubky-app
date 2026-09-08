import { PubkyAppPostKind } from 'pubky-app-specs';
import { afterEach, describe, expect, it } from 'vitest';
import { PubkySpecsSingleton } from '@/pipes/pipes.builder';
import { TEST_POST_IDS, TEST_PUBKY } from '@/pipes/pipes.test-utils';
import { PostNormalizer } from '@/pipes/post/post.normalizer';
import { MAX_CUSTOM_POST_BYTES, type PubkyPostWire, toPostWire } from '@/pipes/post/post.wire';

const author = TEST_PUBKY.USER_1;
const id = TEST_POST_IDS.POST_1;
const uri = `pubky://${author}/pub/pubky.app/posts/${id}`;
const source: PubkyPostWire = {
  kind: 'event',
  content: '{"summary":"Before","extensions":{"future":true}}',
  parent: null,
  embed: 'geo:47.37,8.54',
  attachments: [`pubky://${author}/pub/pubky.app/files/${id}`],
  lock: `pubky://${author}/pub/locks/one`,
};

afterEach(() => PubkySpecsSingleton.reset());

describe('PostNormalizer universal boundary', () => {
  it('preserves custom content and exact kind while allocating a normal native identity', async () => {
    const content = '  {"summary":"Native event"}  ';
    const result = await PostNormalizer.to({ kind: 'Event', content }, author);
    expect(result.post).toMatchObject({ kind: 'Event', content, parent: null, embed: null });
    expect(result.meta.url).toBe(`pubky://${author}/pub/pubky.app/posts/${result.meta.id}`);
    expect(result.meta.path).toBe(`/pub/pubky.app/posts/${result.meta.id}`);
  });

  it('reuses the allocated post id when retrying a publication', async () => {
    const postId = PostNormalizer.createId(author);
    const first = await PostNormalizer.to({ kind: 'event', content: '{}', postId }, author);
    const retry = await PostNormalizer.to({ kind: 'event', content: '{}', postId }, author);
    expect(retry).toEqual(first);
  });

  it.each([
    PubkyAppPostKind.Short,
    PubkyAppPostKind.Long,
    PubkyAppPostKind.Image,
    PubkyAppPostKind.Video,
    PubkyAppPostKind.Link,
    PubkyAppPostKind.File,
  ])('keeps specs validation and text cleanup for built-in kind %s', async (kind) => {
    const result = await PostNormalizer.to({ kind, content: '  readable text  ' }, author);
    expect(result.post.content).toBe('readable text');
    expect(result.post.kind).toBe(PubkyAppPostKind[kind].toLowerCase());
  });

  it('retains built-in short length limits but accepts opaque longer custom content', async () => {
    const content = 'x'.repeat(2001);
    await expect(PostNormalizer.to({ kind: PubkyAppPostKind.Short, content }, author)).rejects.toThrow();
    expect((await PostNormalizer.to({ kind: 'event', content }, author)).post.content).toBe(content);
  });

  it.each(['Image', 'SHORT', 'event:custom', 'unknown'])(
    'does not reinterpret the raw string kind %s',
    async (kind) => {
      const result = await PostNormalizer.to({ kind, content: ' '.repeat(3) + 'x'.repeat(2001) }, author);
      expect(result.post.kind).toBe(kind);
      expect(result.post.content.startsWith('   ')).toBe(true);
    },
  );

  it('enforces the final escaped UTF-8 envelope size', async () => {
    await expect(
      PostNormalizer.to({ kind: 'event', content: '"'.repeat(MAX_CUSTOM_POST_BYTES / 2) }, author),
    ).rejects.toThrow('512 KiB');
  });

  it('preserves ordinary replies and reposts of unknown target kinds without resolving target content', async () => {
    const result = await PostNormalizer.to(
      { kind: PubkyAppPostKind.Short, content: '', embed: uri, parentUri: uri },
      author,
    );
    expect(result.post).toMatchObject({ parent: uri, embed: uri, kind: 'short' });
  });

  it('keeps opaque embed identity instead of applying legacy URL sanitization', async () => {
    const result = await PostNormalizer.to(
      { kind: PubkyAppPostKind.Short, content: '', embed: 'GEO:47.37,8.54' },
      author,
    );
    expect(result.post.embed).toBe('geo:47.37,8.54');
  });

  it('does not allow custom kinds to bypass parent, attachment or lock rules', async () => {
    await expect(
      PostNormalizer.to({ kind: 'event', content: '{}', parentUri: 'https://example.com' }, author),
    ).rejects.toThrow();
    await expect(
      PostNormalizer.to({ kind: 'event', content: '{}', attachmentUris: ['javascript:alert(1)'] }, author),
    ).rejects.toThrow();
    await expect(
      PostNormalizer.to(
        { kind: 'event', content: '{}', attachmentUris: Array(11).fill('https://example.com/a') },
        author,
      ),
    ).rejects.toThrow();
    await expect(
      PostNormalizer.to({ kind: 'event', content: '{}', lock: 'https://example.com' }, author),
    ).rejects.toThrow();
  });

  it('retains the collection builder and its validation', async () => {
    const result = await PostNormalizer.toCollection({ name: 'Events', items: [uri] }, author);
    expect(toPostWire(result.post).kind).toBe('collection');
    await expect(
      PostNormalizer.to({ kind: PubkyAppPostKind.Collection, content: '{}', embed: uri }, author),
    ).rejects.toThrow();
  });
});

describe('PostNormalizer editing resolved source records', () => {
  const edit = (overrides: Partial<Parameters<typeof PostNormalizer.toEdit>[0]> = {}) =>
    PostNormalizer.toEdit({
      compositePostId: `${author}:${id}`,
      currentUserPubky: author,
      content: '{"summary":"After","extensions":{"future":true}}',
      source,
      ...overrides,
    });

  it('preserves custom identity, source envelope, and inert extension data', async () => {
    const result = await edit();
    expect(result.meta.url).toBe(uri);
    expect(result.post).toEqual({ ...source, content: '{"summary":"After","extensions":{"future":true}}' });
  });

  it('can clear attachments without changing a custom kind', async () => {
    expect((await edit({ attachments: [] })).post).toMatchObject({
      kind: 'event',
      attachments: null,
      embed: source.embed,
      lock: source.lock,
    });
  });

  it('preserves an ordinary post’s external embed and lock on text edits', async () => {
    const result = await edit({ source: { ...source, kind: 'short', content: 'Before' }, content: ' After ' });
    expect(result.post).toMatchObject({ kind: 'short', content: 'After', embed: source.embed, lock: source.lock });
  });

  it('supports explicit known media kind changes when attachments change', async () => {
    expect((await edit({ source: { ...source, kind: 'short' }, kind: PubkyAppPostKind.Image })).post.kind).toBe(
      'image',
    );
  });

  it('rejects missing, deleted, foreign-author, and invalid-id sources', async () => {
    await expect(edit({ source: null })).rejects.toThrow('Post not found');
    await expect(edit({ source: { ...source, content: '[DELETED]' } })).rejects.toThrow('Post not found');
    await expect(edit({ currentUserPubky: TEST_PUBKY.USER_2 })).rejects.toThrow('not the author');
    await expect(edit({ compositePostId: `${author}:invalid` })).rejects.toThrow();
  });
});
