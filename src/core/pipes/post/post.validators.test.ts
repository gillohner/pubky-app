import { describe, expect, it } from 'vitest';
import { PostValidators } from '@/pipes/post/post.validators';

describe('PostValidators.validatePostId', () => {
  const params = { postId: 'author:post-123', message: 'Parent post' };
  it('returns the URI from a resolved live parent without IO', () => {
    const post = { content: 'Hello', uri: 'pubky://author/pub/pubky.app/posts/post-123' };
    expect(PostValidators.validatePostId({ ...params, post })).toBe(post.uri);
  });
  it('rejects missing and tombstoned parents', () => {
    expect(() => PostValidators.validatePostId({ ...params, post: null })).toThrow('Parent post not found');
    expect(() => PostValidators.validatePostId({ ...params, post: { content: '[DELETED]', uri: 'unused' } })).toThrow(
      'Parent post not found',
    );
  });
});
