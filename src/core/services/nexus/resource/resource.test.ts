import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getNexusUrl } from '@/config/nexus';
import { AppError } from '@/libs/error/error';
import { nexusQueryClient } from '@/services/nexus/nexus.query-client';
import type { NexusTag } from '@/services/nexus/nexus.types';
import { NexusResourceService } from './resource';
import { resourceApi } from './resource.api';
import { RESOURCE_TAGS_LIMIT } from './resource.constants';

const URI = 'https://www.openstreetmap.org/node/240109189';
const VIEWER = 'hkdrfoddu3rmeucj1mazu4aeg11nxj7uaxybnmots5o9s5hd3t6y';
// Captured from Nexus staging `GET /v0/resource/by-uri?uri=<URI>` on 2026-11-04 (taggers shortened).
const BY_URI_RESPONSE = {
  resource: { id: '81cefcae5a6a468cfc27ff1c1b420fce', uri: URI, scheme: 'https', indexed_at: 1792421637616 },
  tags: [
    {
      label: 'berlin',
      taggers: ['7ehtbiryqz1pkncn7jgrxnzcrzxz8po79dwczgswfeuu3zbh1kwy'],
      taggers_count: 3,
      relationship: false,
      tag_uri: null,
    },
    { label: 'travel', taggers: [VIEWER], taggers_count: 2, relationship: false, tag_uri: null },
  ],
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('resourceApi', () => {
  it('builds the by-uri read with the link encoded', () => {
    expect(resourceApi.byUri({ uri: URI, viewer_id: VIEWER, limit_tags: 20 })).toBe(
      `${getNexusUrl()}/v0/resource/by-uri?uri=${encodeURIComponent(URI)}&viewer_id=${VIEWER}&limit_tags=20`,
    );
    expect(resourceApi.byUriEndpoint()).toBe(`${getNexusUrl()}/v0/resource/by-uri`);
  });
});

describe('NexusResourceService', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');

  beforeEach(() => {
    nexusQueryClient.clear();
    fetchSpy.mockReset();
  });

  afterEach(() => {
    nexusQueryClient.clear();
  });

  it('reads the link’s tags for the viewer', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(BY_URI_RESPONSE));

    const tags = await NexusResourceService.fetchTagsByUri({ uri: URI, viewerId: VIEWER });

    expect(tags).toEqual(BY_URI_RESPONSE.tags);
    expect(fetchSpy).toHaveBeenCalledWith(
      resourceApi.byUri({ uri: URI, viewer_id: VIEWER, limit_tags: RESOURCE_TAGS_LIMIT }),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('reads without a viewer when signed out', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(BY_URI_RESPONSE));

    await NexusResourceService.fetchTagsByUri({ uri: URI, viewerId: null });

    expect(String(fetchSpy.mock.calls[0][0])).not.toContain('viewer_id');
  });

  it('shares one request between readers of the same link and viewer', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(BY_URI_RESPONSE));

    await Promise.all([
      NexusResourceService.fetchTagsByUri({ uri: URI, viewerId: VIEWER }),
      NexusResourceService.fetchTagsByUri({ uri: URI, viewerId: VIEWER }),
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('answers a 404 (nobody tagged the link yet) with no tags, without an error', async () => {
    fetchSpy.mockResolvedValue(new Response('', { status: 404 }));

    await expect(NexusResourceService.fetchTagsByUri({ uri: URI })).resolves.toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('fails with an AppError that keeps the link out of its endpoint', async () => {
    fetchSpy.mockResolvedValue(new Response('', { status: 400 }));

    const error = await NexusResourceService.fetchTagsByUri({ uri: URI }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(JSON.stringify((error as AppError).context)).not.toContain('openstreetmap');
  });

  it('applies the viewer’s write to the cached answer', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(BY_URI_RESPONSE));
    await NexusResourceService.fetchTagsByUri({ uri: URI, viewerId: VIEWER });

    NexusResourceService.applyViewerTag({ uri: URI, label: 'city', viewerId: VIEWER, tagUri: 'pubky://x' }, true);
    const tags = await NexusResourceService.fetchTagsByUri({ uri: URI, viewerId: VIEWER });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(tags.map((tag: NexusTag) => tag.label)).toEqual(['berlin', 'travel', 'city']);
    expect(tags[2]).toMatchObject({ relationship: true, taggers_count: 1, tag_uri: 'pubky://x' });
  });

  it('tells every subscriber of the link the answer and each write applied to it', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(BY_URI_RESPONSE));
    const first = vi.fn();
    const second = vi.fn();
    const otherViewer = vi.fn();
    const unsubscribeFirst = NexusResourceService.subscribeTags({ uri: URI, viewerId: VIEWER }, first);
    const unsubscribeSecond = NexusResourceService.subscribeTags({ uri: URI, viewerId: VIEWER }, second);
    const unsubscribeOther = NexusResourceService.subscribeTags({ uri: URI, viewerId: null }, otherViewer);

    await NexusResourceService.fetchTagsByUri({ uri: URI, viewerId: VIEWER });
    await vi.waitFor(() => expect(first).toHaveBeenLastCalledWith(BY_URI_RESPONSE.tags));
    expect(second).toHaveBeenLastCalledWith(BY_URI_RESPONSE.tags);

    unsubscribeSecond();
    NexusResourceService.applyViewerTag({ uri: URI, label: 'city', viewerId: VIEWER, tagUri: 'pubky://x' }, true);
    await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(2));
    expect(first.mock.lastCall?.[0].map((tag: NexusTag) => tag.label)).toEqual(['berlin', 'travel', 'city']);
    expect(second).toHaveBeenCalledTimes(1);
    expect(otherViewer).not.toHaveBeenCalled();

    unsubscribeFirst();
    unsubscribeOther();
  });

  it('never fetches for a subscriber', async () => {
    const unsubscribe = NexusResourceService.subscribeTags({ uri: URI, viewerId: VIEWER }, vi.fn());

    await Promise.resolve();

    expect(fetchSpy).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('applies nothing when the link was never read', () => {
    NexusResourceService.applyViewerTag({ uri: URI, label: 'city', viewerId: VIEWER }, true);

    expect(nexusQueryClient.getQueryData(['nexus', 'resource', 'by-uri', URI, VIEWER])).toBeUndefined();
  });
});

describe('NexusResourceService counts and replies (our Nexus fork)', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  const WITH_COUNTS = { ...BY_URI_RESPONSE, replies_count: 3, embeds_count: 1, collections_count: 2 };
  const RESOURCE_ID = BY_URI_RESPONSE.resource.id;

  beforeEach(() => {
    nexusQueryClient.clear();
    fetchSpy.mockReset();
  });

  afterEach(() => {
    nexusQueryClient.clear();
  });

  it('reads the link’s counts and id', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(WITH_COUNTS));

    await expect(NexusResourceService.fetchCounts({ uri: URI })).resolves.toEqual({
      resourceId: RESOURCE_ID,
      replies: 3,
      embeds: 1,
      collections: 2,
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      resourceApi.byUri({ uri: URI, limit_tags: 1, limit_taggers: 1 }),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('leaves out the counts a Nexus does not serve', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(BY_URI_RESPONSE));

    await expect(NexusResourceService.fetchCounts({ uri: URI })).resolves.toEqual({
      resourceId: RESOURCE_ID,
      replies: undefined,
      embeds: undefined,
      collections: undefined,
    });
  });

  it('reads no counts for a link Nexus does not know (404)', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 404 }));

    await expect(NexusResourceService.fetchCounts({ uri: URI })).resolves.toBeNull();
  });

  it('takes the counts from a card’s tag read, without a request of their own', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(WITH_COUNTS));
    const listener = vi.fn();
    const unsubscribe = NexusResourceService.subscribeCounts(URI, listener);

    await NexusResourceService.fetchTagsByUri({ uri: URI, viewerId: VIEWER });

    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(expect.objectContaining({ replies: 3 })));
    expect(NexusResourceService.getCachedCounts(URI)).toEqual(expect.objectContaining({ resourceId: RESOURCE_ID }));
    await NexusResourceService.fetchCounts({ uri: URI });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('waits for a tag read of the link in flight instead of asking again', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(WITH_COUNTS));

    const tags = NexusResourceService.fetchTagsByUri({ uri: URI, viewerId: VIEWER });
    const counts = NexusResourceService.fetchCounts({ uri: URI });

    await expect(counts).resolves.toEqual(expect.objectContaining({ replies: 3, collections: 2 }));
    await tags;
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('reads the replies by the resource’s id', async () => {
    fetchSpy.mockResolvedValue(jsonResponse([]));

    await expect(
      NexusResourceService.fetchReplies({ resourceId: RESOURCE_ID, viewerId: VIEWER, skip: 3, limit: 20 }),
    ).resolves.toEqual([]);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      `${getNexusUrl()}/v0/resource/${RESOURCE_ID}/replies?viewer_id=${VIEWER}&skip=3&limit=20`,
    );
  });
});
