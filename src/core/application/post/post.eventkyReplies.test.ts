import { beforeEach, expect, it, vi } from 'vitest';
import { PostStreamApplication } from '@/application/stream/posts/post';
import { toPostWire } from '@/pipes/post/post.wire';
import { LocalPostService } from '@/services/local/post/post';
import { PostApplication } from './post';

vi.mock('@/application/stream/posts/post', () => ({ PostStreamApplication: { persistFetchedPosts: vi.fn() } }));
vi.mock('@/services/local/post/post', () => ({ LocalPostService: { readDetailsByIds: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());
const source = {
  author: 'author',
  id: 'reply',
  uri: 'pubky://author/pub/pubky.app/posts/reply',
  kind: 'short',
  content: 'old comment',
  parent: 'pubky://owner/pub/pubky.app/posts/event',
  attachments: ['old-file'],
};
const batch = { sources: [source], posts: [{ details: source }] as never, complete: true, nextSkip: null };
it('protects a locally edited comment until the full source matches the index', async () => {
  vi.mocked(LocalPostService.readDetailsByIds).mockResolvedValue([
    { ...source, id: 'author:reply', content: 'edited comment' },
  ] as never);
  expect(
    (
      await PostApplication.persistEventkyReplies(batch, 'author', {
        'author:reply': JSON.stringify(toPostWire({ ...source, content: 'edited comment' })),
      })
    ).acknowledged,
  ).toEqual([]);
  expect(PostStreamApplication.persistFetchedPosts).toHaveBeenCalledWith([], 'author');
});
it('does not acknowledge attachment-only edits from an older index snapshot', async () => {
  vi.mocked(LocalPostService.readDetailsByIds).mockResolvedValue([
    { ...source, id: 'author:reply', attachments: ['new-file'] },
  ] as never);
  expect(
    (
      await PostApplication.persistEventkyReplies(batch, 'author', {
        'author:reply': JSON.stringify(toPostWire({ ...source, attachments: ['new-file'] })),
      })
    ).acknowledged,
  ).toEqual([]);
  expect(PostStreamApplication.persistFetchedPosts).toHaveBeenCalledWith([], 'author');
});
it('hydrates the already fetched native batch once its full source catches up', async () => {
  vi.mocked(LocalPostService.readDetailsByIds).mockResolvedValue([{ ...source, id: 'author:reply' }] as never);
  expect(
    (
      await PostApplication.persistEventkyReplies(batch, 'author', {
        'author:reply': JSON.stringify(toPostWire(source)),
      })
    ).acknowledged,
  ).toEqual(['author:reply']);
  expect(PostStreamApplication.persistFetchedPosts).toHaveBeenCalledWith(batch.posts, 'author');
});
