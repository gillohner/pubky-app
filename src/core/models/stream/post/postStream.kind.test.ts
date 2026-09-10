import { describe, expect, it } from 'vitest';
import { postKindToStreamSegment, streamSegmentToPostKind } from '@/models/stream/post/postStream.kind';
import {
  buildContentSearchStreamId,
  buildKindFilteredPostStreamId,
  getPostStreamKind,
} from '@/models/stream/post/postStream.types';
import { createPostStreamParams } from '@/services/nexus/stream/posts/postStream.utils';
import { postKindBelongsToStream } from '@/stores/home/home.utils';

const KINDS = ['event', 'calendar', 'Event', 'unknown', 'all', 'vendor:event%📅', 'k~event', 'calendar&kind=short'];

describe('Exact kind cache-key encoding', () => {
  it.each(KINDS)('round trips %s without broadening its content-search query', (kind) => {
    const segment = postKindToStreamSegment(kind);
    expect(segment).not.toContain(':');
    expect(streamSegmentToPostKind(segment)).toBe(kind);
    const streamId = buildContentSearchStreamId('community', segment);
    expect(
      createPostStreamParams({ streamId, streamTail: 0, streamHead: 0, viewerId: null, limit: 10 }).params.kind,
    ).toBe(kind);
    expect(postKindBelongsToStream(kind, streamId)).toBe(true);
    expect(postKindBelongsToStream('unrelated', streamId)).toBe(false);
  });

  it('keeps literal all distinct from an unfiltered feed and different raw kinds collision free', () => {
    expect(streamSegmentToPostKind('all')).toBeUndefined();
    expect(new Set(KINDS.map(postKindToStreamSegment)).size).toBe(KINDS.length);
    const streamId = buildKindFilteredPostStreamId('all');
    expect(getPostStreamKind(streamId)).toBe('k~all');
    expect(postKindBelongsToStream('event', streamId)).toBe(false);
    expect(postKindBelongsToStream('event', 'timeline:all:all')).toBe(true);
  });

  it.each(['', 'bad kind', 'bad,kind', '\u0085', 'a'.repeat(129), '📅'.repeat(33)])(
    'rejects invalid raw kind %j',
    (kind) => {
      expect(() => postKindToStreamSegment(kind)).toThrow();
    },
  );

  it('fails closed for invalid encoded local filters', () => {
    expect(postKindBelongsToStream('event', 'timeline:all:k~%')).toBe(false);
    expect(postKindBelongsToStream('event', 'content_search:q~term:k~%')).toBe(false);
  });
});
