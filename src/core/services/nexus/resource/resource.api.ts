import { buildNexusUrl, buildUrlWithQuery } from '@/services/nexus/nexus.utils';
import type { TResourceByIdsParams, TResourceByUriParams } from '@/services/nexus/resource/resource.types';

type TResourceRepliesQuery = {
  viewer_id?: string;
  skip?: number;
  limit?: number;
};

/**
 * Resource API Endpoints
 *
 * External resources (web links and other non-Pubky URIs) people tagged.
 */

const PREFIX = 'v0/resource';

export const resourceApi = {
  byUri: (params: TResourceByUriParams) => buildUrlWithQuery({ baseRoute: `${PREFIX}/by-uri`, params }),
  /** The endpoint without its query string, for error context: the query carries a link from someone's post. */
  byUriEndpoint: () => buildNexusUrl(`${PREFIX}/by-uri`),
  /**
   * The views of up to 100 resources by link in one POST (our Nexus fork; production and the hosted
   * staging Nexus answer 404). Returns the URL and the JSON body.
   */
  byIds: ({ uris, viewer_id, ...params }: TResourceByIdsParams) => ({
    url: buildUrlWithQuery({ baseRoute: 'v0/stream/resources/by_ids', params }),
    body: viewer_id ? { uris, viewer_id } : { uris },
  }),
  /** The live posts whose `parent` is the resource, newest first (our Nexus fork). */
  replies: (resourceId: string, params: TResourceRepliesQuery) =>
    buildUrlWithQuery({ baseRoute: `${PREFIX}/${encodeURIComponent(resourceId)}/replies`, params }),
};

export type ResourceApiEndpoint = keyof typeof resourceApi;
