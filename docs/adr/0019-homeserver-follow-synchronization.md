# ADR 0019: Homeserver Follow Synchronization

## Status

Accepted — 2026-09-07

## Context

[Issue #1803](https://github.com/pubky/pubky-app/issues/1803) reports Follow buttons for users already followed. Nexus relationships are viewer-relative, and its index can lag behind homeserver writes. Refreshing each button through the user TTL also delays changes from another device and duplicates viewport subscriptions.

## Decision

Use the homeserver as the authority for the signed-in account's outgoing follows. Keep Nexus for profile details, incoming relationships, and other users' aggregate counts.

- `FollowSyncCoordinator → FollowSyncController → FollowSyncApplication → Services` owns one account-scoped stream for `/pub/pubky.app/follows/`, using the installed Pubky SDK. Pause while hidden and cancel on logout or account change.
- Capture the latest matching event cursor before reading the complete following directory. Apply the snapshot, then subscribe after that cursor. Writes during the snapshot are replayed. Checkpoint only successfully persisted batches; resume after visibility changes and reconnect with exponential backoff (1–30 seconds).
- Coalesce events for 250 ms, process at most 20 targets per batch, and read at most four resources concurrently per window, including SDK requests still settling after cancellation. Workers take the next target as soon as a slot opens. Read current resource existence rather than trusting historical PUT/DEL events, and accept only canonical public-key resource names.
- Reconcile the complete list periodically using the existing user TTL (10 minutes by default), including when SSE is unavailable. Measure elapsed time across short visits. One worker drains live batches and periodic snapshots; missing authority triggers a fresh snapshot. This also repairs failed optimistic writes that produced no event.
- Store the complete following set in the existing `user_connections` row. Optional, unindexed `followingSyncedAt` distinguishes a complete authoritative snapshot from partial legacy data; no database version change is needed.
- Serialize relationship/count writes with reconciliation in Dexie transactions. Once synchronized, Nexus cannot overwrite outgoing follow flags or the account's following count. Before the first snapshot, `followingBy` protects individual optimistic actions. A persisted optional `followingRevision` and account-scoped Web Locks reject responses overlapping local actions or another window's reconciliation. Each successful reconciliation advances that revision, including unchanged snapshots. Mutations share a lock; only the short snapshot capture/apply takes an exclusive lock. Closing a window releases its locks automatically.
- Keep the own Following stream paginated, including when another consumer has cached a larger list. Resolve the last visible member inside the local transaction before selecting the next page. Merge remote additions without removing visible unfollowed rows, and hydrate at most one normal page automatically when an exhausted list gains entries. Stop automatic retries after a hydration failure.
- Treat missing viewer relationships as incomplete user data even when profile details are cached. Derive the account's following count from its authoritative set even before Nexus has indexed a counts row.
- Clear the shared database atomically. When another window changes the persisted account, stop coordinators and reload to restore that session; the database holds one viewer's relationships.
- Keep `useIsFollowing` as a reactive local read. Existing viewport-aware subscriptions remain responsible for TTL profile refreshes. TTL startup observes actual session/profile transitions, including restored sessions.

## Consequences

Connected, visible sessions can show follow changes without waiting for the user TTL or Nexus indexing. Replayed events are idempotent, and delayed Nexus responses cannot undo a confirmed outgoing relationship.

Startup and periodic reconciliation read the full following directory. Only the first snapshot scans all cached relationships to repair legacy data; later snapshots touch changed membership. An unchanged snapshot updates only its revision, preserving relationships, counts, and streams. Live processing is bounded and does not scan every cached user. The authoritative set occupies an existing account row; rendered lists remain paginated. No additional dependency or per-button polling is introduced.

SSE delivery and resource reads still depend on network availability. Reconnection replays pending events, and periodic reconciliation is the fallback. Cancellation stops queued probes and subsequent directory pages; the SDK cannot abort a resource request already in progress. Incoming follow flags and other users' counts continue to use Nexus freshness.

## Alternatives Considered

- Shorten the global user TTL: increases unrelated profile traffic and still depends on Nexus indexing.
- Refresh every mounted Follow button: includes offscreen rows and duplicates existing viewport tracking.
- Apply historical event types directly: replay can overwrite a newer action; reading current resource existence avoids this.

## References

- [PR #2474](https://github.com/pubky/pubky-app/pull/2474)
- [Pubky event streaming API](https://pubky.org/explore/pubky-protocol/api/#event-streaming)
- [ADR 0001: Local-First Writes](0001-local-first-writes.md)
- [ADR 0012: TTL Coordinator](0012-ttl-coordinator.md)
