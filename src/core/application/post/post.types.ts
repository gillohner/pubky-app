import type { TCreateTagInput } from '@/application/tag/tag.types';
import type { Pubky } from '@/models/models.types';
import type { TFileAttachmentResult } from '@/pipes/file/file.types';
import type { PostSource, PubkyPostWire } from '@/pipes/post/post.wire';
import type { TLocalSavePostParams } from '@/services/local/post/post.types';

/** Retained with one immutable publication intent, including its uploaded file identities. */
export type TPostUploadState = { completed: boolean; postUncertain?: boolean };

export interface TCreatePostInput extends TLocalSavePostParams {
  postUrl: string;
  fileAttachments?: TFileAttachmentResult[];
  tags?: TCreateTagInput[];
  /** Mutable state belonging to one prepared create, retained across an uncertain post PUT. */
  uploadState?: TPostUploadState;
}

export interface TEditPostInput {
  compositePostId: string;
  post: PostSource;
  postUrl: string;
  /** Rechecked against the source immediately before uploads; conditional PUT is not available. */
  expectedContent?: string;
  /** Full normalized source captured during preparation, including attachments and relationship fields. */
  expectedSource?: PubkyPostWire;
  /** Retain one prepared edit across retries so uploaded file identities remain stable. */
  uploadState?: TPostUploadState;
  /** New attachment files (already normalized). Uploaded before the post PUT; rolled back if the PUT fails. */
  fileAttachments?: TFileAttachmentResult[];
  /** Previously referenced file URIs to delete (best-effort) after a successful PUT. */
  removedUris?: string[];
}

export type TGetOrFetchPostParams = {
  compositeId: string;
  /** Optional viewer ID for relationship data. Null/undefined for unauthenticated views. */
  viewerId?: Pubky | null;
};

export type TGetDetailsByIdsParams = {
  /** Composite post IDs in format "authorId:postId". */
  compositeIds: string[];
};
