import type { NexusTag } from '@/services/nexus/nexus.types';

/** Another link of the same thing: what is read from Nexus, and the service it is on. */
export interface TOtherLink {
  /** The link exactly as written: Nexus matches the raw URI. */
  uri: string;
  /** The service name (`Netflix`), else the link's host. */
  name: string;
}

/** The tags Nexus has on one other link. */
export interface TOtherLinkTags {
  link: TOtherLink;
  tags: NexusTag[];
}

export interface UseOtherLinkTagsResult {
  /** The tags of every link read so far that has some; `[]` while the first batch is read. */
  reads: TOtherLinkTags[];
  isLoading: boolean;
}
