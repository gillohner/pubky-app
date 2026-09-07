/** A single account stream; requests are coalesced and bounded independently of list size. */
export const FOLLOW_SYNC_PATH = '/pub/pubky.app/follows/';
export const FOLLOW_SYNC_DEBOUNCE_MS = 250;
export const FOLLOW_SYNC_BATCH_SIZE = 20;
export const FOLLOW_SYNC_CONCURRENCY = 4;
export const FOLLOW_SYNC_RETRY_MS = 1_000;
export const FOLLOW_SYNC_MAX_RETRY_MS = 30_000;
