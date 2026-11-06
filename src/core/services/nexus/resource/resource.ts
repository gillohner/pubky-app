import { QueryObserver } from '@tanstack/react-query';
import { httpResponseToError, safeFetch } from '@/libs/error/error.http';
import { ErrorService } from '@/libs/error/error.types';
import { HttpMethod, HttpStatusCode } from '@/libs/http/http.types';
import { parseResponseOrThrow } from '@/libs/http/response.utils';
import { NEXUS_RESOURCE_TAGS_OPERATION } from '@/libs/observability/sentry.constants';
import type { Pubky } from '@/models/models.types';
import { type TResourceViewerTag, withResourceViewerTag } from '@/pipes/tag/tag.resource';
import { nexusQueryClient } from '@/services/nexus/nexus.query-client';
import type { NexusPost, NexusTag } from '@/services/nexus/nexus.types';
import { queryNexus } from '@/services/nexus/nexus.utils';
import { resourceApi } from '@/services/nexus/resource/resource.api';
import { RESOURCE_TAGS_LIMIT } from '@/services/nexus/resource/resource.constants';
import type {
  NexusResourceTags,
  TResourceCounts,
  TResourceRepliesParams,
} from '@/services/nexus/resource/resource.types';

const OPERATION = NEXUS_RESOURCE_TAGS_OPERATION;

type TResourceTagsKey = { uri: string; viewerId?: Pubky | null };
function queryKey({ uri, viewerId }: TResourceTagsKey) {
  return ['nexus', 'resource', 'by-uri', uri, viewerId ?? null] as const;
}

/** The link's counts do not depend on the viewer: one entry per link. */
function countsKey(uri: string) {
  return ['nexus', 'resource', 'counts', uri] as const;
}

/** How fresh a link's counts stay before a reader asks again (a reply shows up within seconds). */
const COUNTS_STALE_TIME_MS = 30_000;

/**
 * Nexus reads of external resources: the tags people put on a web link (or any other URI that is
 * no Pubky object), matched by the raw URI.
 *
 * Reads go through `nexusQueryClient`, keyed by URI and viewer, so the card in a post and the
 * resource page share one request and one cached answer, and `subscribeTags` keeps every reader of
 * that answer on its latest state.
 */
export class NexusResourceService {
  private constructor() {}

  /**
   * The tags on a link (`GET /v0/resource/by-uri`).
   *
   * A 404 is an answer, not a failure: nobody tagged the link yet, so the read returns `[]`
   * without creating an AppError (an untagged link is the common case, and its link would
   * otherwise reach error telemetry).
   *
   * @param params.uri - The link exactly as written
   * @param params.viewerId - Marks the viewer's own tags; omit for a signed-out viewer
   * @returns The link's tags, `[]` when nobody tagged it
   * @throws AppError when Nexus fails or answers with anything else
   */
  static async fetchTagsByUri({ uri, viewerId }: TResourceTagsKey): Promise<NexusTag[]> {
    const url = resourceApi.byUri({ uri, viewer_id: viewerId ?? undefined, limit_tags: RESOURCE_TAGS_LIMIT });
    return nexusQueryClient.fetchQuery({
      queryKey: queryKey({ uri, viewerId }),
      queryFn: async () => {
        const body = await fetchResourceOrNull(url);
        // The same answer carries the link's counts: every card reading its tags has them too.
        nexusQueryClient.setQueryData(countsKey(uri), body ? toCounts(body) : null);
        return body?.tags ?? [];
      },
    });
  }

  /**
   * What Nexus counts on a link (`GET /v0/resource/by-uri`): replies, embeds and collections, with
   * the resource's id. `null` when nobody referenced or tagged the link yet (404). Shares the cache
   * entry `fetchTagsByUri` fills: a tag read of the link in flight is waited for, and a card that
   * read its tags asks nothing more.
   *
   * @throws AppError when Nexus fails or answers with anything else
   */
  static async fetchCounts({ uri }: { uri: string }): Promise<TResourceCounts | null> {
    const tagReads = nexusQueryClient
      .getQueryCache()
      .findAll({ queryKey: ['nexus', 'resource', 'by-uri', uri] })
      .filter((query) => query.state.fetchStatus === 'fetching');
    if (tagReads.length > 0) {
      await Promise.allSettled(tagReads.map((query) => query.promise));
      const counts = nexusQueryClient.getQueryData<TResourceCounts | null>(countsKey(uri));
      if (counts !== undefined) return counts;
    }
    // One tag is enough: the tags are read with the viewer's marks by `fetchTagsByUri`.
    const url = resourceApi.byUri({ uri, limit_tags: 1, limit_taggers: 1 });
    return nexusQueryClient.fetchQuery({
      queryKey: countsKey(uri),
      staleTime: COUNTS_STALE_TIME_MS,
      queryFn: async () => {
        const body = await fetchResourceOrNull(url);
        return body ? toCounts(body) : null;
      },
    });
  }

  /**
   * Calls `listener` with the link's counts each time another reader's answer changes them (a card's
   * tag read, a refetch). Never fetches. Returns the unsubscribe.
   */
  static subscribeCounts(uri: string, listener: (counts: TResourceCounts | null) => void): () => void {
    const observer = new QueryObserver<TResourceCounts | null>(nexusQueryClient, {
      queryKey: countsKey(uri),
      enabled: false,
    });
    let last = observer.getCurrentResult().data;
    return observer.subscribe(({ data }) => {
      if (data === undefined || data === last) return;
      last = data;
      listener(data);
    });
  }

  /** The counts already read for a link, without asking Nexus; `undefined` when none was read. */
  static getCachedCounts(uri: string): TResourceCounts | null | undefined {
    return nexusQueryClient.getQueryData<TResourceCounts | null>(countsKey(uri));
  }

  /**
   * The live posts replying to a resource (`GET /v0/resource/{id}/replies`, our Nexus fork), newest
   * first. Without their attachments' metadata: the fork refuses `include_attachment_metadata` in
   * the query string (`expected a boolean`), so a reply with files is read again by id.
   *
   * @throws AppError when Nexus fails or does not serve the route
   */
  static async fetchReplies({ resourceId, viewerId, skip, limit }: TResourceRepliesParams): Promise<NexusPost[]> {
    const url = resourceApi.replies(resourceId, { viewer_id: viewerId ?? undefined, skip, limit });
    // Always a fresh page: the list is read once per page view and on "show all".
    return queryNexus<NexusPost[]>({ url, force: true, notFoundRetries: 0 });
  }

  /**
   * Calls `listener` with the link's cached tags each time they change after this call: another
   * reader's answer, a refetch, or a tag write applied by `applyViewerTag`. Never fetches; while
   * subscribed the cached answer stays in the cache. Returns the unsubscribe.
   */
  static subscribeTags(key: TResourceTagsKey, listener: (tags: NexusTag[]) => void): () => void {
    const observer = new QueryObserver<NexusTag[]>(nexusQueryClient, { queryKey: queryKey(key), enabled: false });
    let last = observer.getCurrentResult().data;
    return observer.subscribe(({ data }) => {
      if (data === undefined || data === last) return;
      last = data;
      listener(data);
    });
  }

  /**
   * Applies the viewer's tag write to the cached answer for the link, so every reader of the
   * shared query sees it before Nexus indexes the write. Nothing cached means nothing to apply:
   * the next read asks Nexus.
   */
  static applyViewerTag({ uri, ...viewerTag }: TResourceViewerTag & { uri: string }, isAdded: boolean): void {
    nexusQueryClient.setQueryData<NexusTag[]>(queryKey({ uri, viewerId: viewerTag.viewerId }), (cached) =>
      cached ? withResourceViewerTag(cached, viewerTag, isAdded) : cached,
    );
  }
}

/**
 * One GET; retries come from `nexusQueryClient`. `endpoint` (error context of an HTTP error) is
 * the request without its query string, which carries a link from someone's post. A connection
 * failure or timeout is built by `safeFetch` with the full request as `context.url`; the
 * `nexus-resource-tags-transport` Sentry drop rule keeps it out of telemetry.
 */
async function fetchResourceOrNull(url: string): Promise<NexusResourceTags | null> {
  const endpoint = resourceApi.byUriEndpoint();
  const response = await safeFetch(url, { method: HttpMethod.GET }, ErrorService.Nexus, OPERATION);
  if (response.status === HttpStatusCode.NOT_FOUND) {
    response.body?.cancel().catch(() => {});
    return null;
  }
  if (!response.ok) {
    throw httpResponseToError(response, ErrorService.Nexus, OPERATION, endpoint);
  }
  return parseResponseOrThrow<NexusResourceTags>(response, ErrorService.Nexus, OPERATION, endpoint);
}

/** The counts of a `by-uri` answer; a count the configured Nexus does not serve stays `undefined`. */
function toCounts(body: NexusResourceTags): TResourceCounts {
  const count = (value: unknown) => (typeof value === 'number' && value >= 0 ? value : undefined);
  return {
    resourceId: body.resource.id,
    replies: count(body.replies_count),
    embeds: count(body.embeds_count),
    collections: count(body.collections_count),
  };
}
