import type { Pubky } from '@/models/models.types';
import type { NexusTag } from '@/services/nexus/nexus.types';

export type TResourceByUriParams = {
  /** The link exactly as written: Nexus matches the raw URI. */
  uri: string;
  /** Marks the viewer's own tags (`relationship`, `tag_uri`); omitted for a signed-out viewer. */
  viewer_id?: Pubky;
  limit_tags?: number;
  limit_taggers?: number;
};

/** `ResourceDetails` in the Nexus openapi: an external resource someone tagged. */
export type NexusResourceDetails = {
  /** 32-character lowercase hex resource id. */
  id: string;
  uri: string;
  scheme: string;
  indexed_at: number;
};

/**
 * `ResourceTagsResponse` in the Nexus openapi (`GET /v0/resource/by-uri`). The counts are our Nexus
 * fork's (external references): a Nexus without them leaves them out.
 */
export type NexusResourceTags = {
  resource: NexusResourceDetails;
  tags: NexusTag[];
  replies_count?: number;
  embeds_count?: number;
  collections_count?: number;
};

/**
 * What Nexus counts on an external resource: the posts replying to it (`parent`), embedding it
 * (`embed`) and the collections holding it. A count is `undefined` when the configured Nexus does
 * not serve it (production and the hosted staging Nexus, until the external references land).
 */
export type TResourceCounts = {
  /** The resource's Nexus id, which its reference lists are read by. */
  resourceId: string;
  replies?: number;
  embeds?: number;
  collections?: number;
};

export type TResourceRepliesParams = {
  /** 32-character lowercase hex resource id (`TResourceCounts.resourceId`). */
  resourceId: string;
  /** Marks the viewer's own tags and bookmarks on the replies; omitted signed out. */
  viewerId?: Pubky | null;
  skip?: number;
  limit?: number;
};
