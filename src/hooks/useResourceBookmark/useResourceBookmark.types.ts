export interface UseResourceBookmarkResult {
  /** The viewer's own bookmark state; `false` while signed out or loading. */
  isBookmarked: boolean;
  isLoading: boolean;
  isToggling: boolean;
  /** Bookmark or un-bookmark; resolves `true` when the write went through. */
  toggle: () => Promise<boolean>;
}
