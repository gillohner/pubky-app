# ADR 0019: Homeserver Follow Synchronization

## Status

Accepted — 2026-09-07

## Context

[Issue #1803](https://github.com/pubky/pubky-app/issues/1803) reports Follow buttons for users already followed. Nexus relationships are viewer-relative, and its index can lag behind homeserver writes. Refreshing each button through the user TTL also delays changes from another device and duplicates viewport subscriptions.

## Decision

Use the homeserver as the authority for the signed-in account's outgoing follows. Keep Nexus for profile details, incoming relationships, and other users' aggregate counts.

- `FollowSyncCoordinator → FollowSyncController → FollowSyncApplication → Services` owns one account-scoped stream for `/pub/pubky.app/follows/`, using the installed Pubky SDK. Pause while hidden and cancel on logout or account change.
- Capture the latest matching event cursor before reading the complete following directory. Apply the snapshot, then subscribe after that cursor. Writes during the snapshot are replayed. Checkpoint only successfully persisted batches; resume after visibility changes and reconnect with exponential backoff (1–30 seconds).
- Coalesce events for 250 ms, process at most 20 targets per batch, and read at most four resources concurrently. Read current resource existence rather than trusting historical PUT/DEL events.
- Reconcile the complete list periodically using the existing user TTL (10 minutes by default), including when SSE is unavailable. Serialize live batches and periodic snapshots. This also repairs failed optimistic writes that produced no event.
- Store the complete following set in the existing `user_connections` row. Optional, unindexed `followingSyncedAt` distinguishes a complete authoritative snapshot from partial legacy data; no database version change is needed.
- Serialize relationship/count writes with reconciliation in Dexie transactions. Once synchronized, Nexus cannot overwrite outgoing follow flags or the account's following count. Before the first snapshot, `followingBy` protects individual optimistic actions. An in-memory mutation revision rejects homeserver responses that overlap local follow/unfollow work.
- Keep the own Following stream paginated. Preserve its cached prefix order, merge remote additions into mounted lists without removing visible unfollowed rows, and hydrate at most one normal page automatically when an exhausted list gains entries. Other entries load through pagination.
- Keep `useIsFollowing` as a reactive local read. Existing viewport-aware subscriptions remain responsible for TTL profile refreshes. TTL startup observes actual session/profile transitions, including restored sessions.

## Consequences

Connected, visible sessions can show follow changes without waiting for the user TTL or Nexus indexing. Replayed events are idempotent, and delayed Nexus responses cannot undo a confirmed outgoing relationship.

Startup and periodic reconciliation read the full following directory and cached relationship rows. Live processing is bounded and does not scan every cached user. The authoritative set occupies an existing account row; rendered lists remain paginated. No additional dependency or per-button polling is introduced.

SSE delivery and resource reads still depend on network availability. Reconnection replays pending events, and periodic reconciliation is the fallback. Incoming follow flags and other users' counts continue to use Nexus freshness.

## Alternatives Considered

- Shorten the global user TTL: increases unrelated profile traffic and still depends on Nexus indexing.
- Refresh every mounted Follow button: includes offscreen rows and duplicates existing viewport tracking.
- Apply historical event types directly: replay can overwrite a newer action; reading current resource existence avoids this.

## References

- [PR #2474](https://github.com/pubky/pubky-app/pull/2474)
- [Pubky event streaming API](https://pubky.org/explore/pubky-protocol/api/#event-streaming)
- [ADR 0001: Local-First Writes](0001-local-first-writes.md)
- [ADR 0012: TTL Coordinator](0012-ttl-coordinator.md)
