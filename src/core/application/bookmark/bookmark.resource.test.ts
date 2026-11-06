import { buildBookmark } from 'pubky-social-specs';
import { fakeOwner } from 'pubky-social-specs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/libs/error/error';
import { HttpMethod } from '@/libs/http/http.types';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { LocalBookmarkService } from '@/services/local/bookmark/bookmark';
import { BookmarkApplication } from './bookmark';

const URI = 'https://open.spotify.com/track/5Z01UMMf7V1o0MzF86s6WJ';
const BUILT = buildBookmark(fakeOwner(1), URI);

describe('BookmarkApplication, external resources', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(HomeserverService, 'putBlob').mockResolvedValue(undefined);
    vi.spyOn(HomeserverService, 'deleteIdempotent').mockResolvedValue(undefined);
    vi.spyOn(LocalBookmarkService, 'persist').mockResolvedValue(undefined);
  });

  it('lists the bookmarked links from the listing, reading only the overflow form for its link', async () => {
    const long = `https://example.com/${'a'.repeat(300)}`;
    const overflow = buildBookmark(fakeOwner(1), long);
    const post = buildBookmark(fakeOwner(1), `pubky://${fakeOwner(2)}/pub/social/v1/posts/0035V9A20WSE4`);
    vi.spyOn(HomeserverService, 'listAll').mockResolvedValue([BUILT.url, post.url, overflow.url, BUILT.url]);
    const getBytes = vi.spyOn(HomeserverService, 'getBytes').mockResolvedValue(overflow.body);

    await expect(BookmarkApplication.fetchResourceBookmarks(fakeOwner(1))).resolves.toEqual([URI, long]);
    expect(getBytes).toHaveBeenCalledTimes(1);
    expect(getBytes).toHaveBeenCalledWith(overflow.url);
  });

  it('leaves out an overflow bookmark whose read fails', async () => {
    const overflow = buildBookmark(fakeOwner(1), `https://example.com/${'b'.repeat(300)}`);
    vi.spyOn(HomeserverService, 'listAll').mockResolvedValue([overflow.url, BUILT.url]);
    vi.spyOn(HomeserverService, 'getBytes').mockRejectedValue(new Error('offline'));

    await expect(BookmarkApplication.fetchResourceBookmarks(fakeOwner(1))).resolves.toEqual([URI]);
  });

  it('reads the state from the homeserver file', async () => {
    const exists = vi.spyOn(HomeserverService, 'exists').mockResolvedValue(false);

    await expect(BookmarkApplication.fetchResourceBookmarked(BUILT.url)).resolves.toBe(false);
    expect(exists).toHaveBeenCalledWith(BUILT.url);
  });

  it('PUTs the bytes and DELETEs the file, with no local row', async () => {
    await BookmarkApplication.persistResource(HttpMethod.PUT, { bookmarkUrl: BUILT.url, bookmarkBody: BUILT.body });
    await BookmarkApplication.persistResource(HttpMethod.DELETE, { bookmarkUrl: BUILT.url });

    expect(HomeserverService.putBlob).toHaveBeenCalledWith({ url: BUILT.url, blob: BUILT.body });
    expect(HomeserverService.deleteIdempotent).toHaveBeenCalledWith(BUILT.url);
    expect(LocalBookmarkService.persist).not.toHaveBeenCalled();
  });

  it('refuses a PUT without bytes rather than falling through to a delete', async () => {
    await expect(
      BookmarkApplication.persistResource(HttpMethod.PUT, { bookmarkUrl: BUILT.url }),
    ).rejects.toBeInstanceOf(AppError);
    expect(HomeserverService.deleteIdempotent).not.toHaveBeenCalled();
  });
});
