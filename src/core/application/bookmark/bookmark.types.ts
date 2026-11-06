export type TBookmarkPersistInput = {
  postId: string; // Composite post ID (authorId:postId)
  bookmarkUrl: string;
  /** The bytes to PUT; absent on a delete. */
  bookmarkBody?: Uint8Array;
};

/** A bookmark of an external resource: the built file only, no local row. */
export type TResourceBookmarkPersistInput = {
  bookmarkUrl: string;
  /** The bytes to PUT; absent on a delete. */
  bookmarkBody?: Uint8Array;
};

export interface TBookmarkFetchOptions {
  /** Whether the account the fetch started for is still the current one; checked before the local write. */
  isCurrent?: () => boolean;
}
