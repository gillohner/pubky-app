# ADR 0019: Local-First Tag Cache and Viewport Lifetimes

## Status

Proposed — 2026-09-07

This draft supersedes the route/authentication lifecycle decisions in [ADR 0012](0012-ttl-coordinator.md) and extends [ADR 0005](0005-ttl-refresh-policy.md) with independent tag freshness. ADR 0012 remains unchanged as the historical record.

## Context

Fetching tags on every card mount repeats data already supplied by bootstrap or grouped hydration. Simply removing those requests leaves cold public profiles uninitialized and expanded lists without reliable pagination or freshness. Batch previews cannot establish which labels disappeared from a longer loaded list, and delayed responses can overwrite optimistic edits.

## Decision

- Tag hooks observe IndexedDB. Controller → Application → Service loading fills missing or uninitialized records and revalidates viewer relationships when the viewer changes. A persisted empty collection is a cache hit. Local read failures remain contained in the hook.
- Persist server cursor, exhaustion, freshness, revision, and viewer alongside the collection. Local edits do not change the server cursor. Serialize refresh and pagination for the same entity/viewer. If a concurrent accepted write changes the revision, reread and retry the operation at most twice; report persistent contention.
- Batch previews retain expanded windows. Background refresh replaces their loaded prefix atomically, using requests of at most 100 tags. Preserve active local mutation intent through both batch and page writes, and prune expired intent on subsequent local writes.
- Entity TTL and tag TTL are independent. A failed tag refresh retains the displayed window and records a 30-second retry cooldown. Subsequent viewport ticks retry eligible tags without downloading healthy entity batches again. A newer accepted revision prevents an old failure from expiring that data. Notification invalidation clears the cooldown; explicit pagination is still available.
- The manager owns the TTL coordinator's start/stop lifetime. Viewport consumers own reference-counted subscriptions across navigation. Authentication changes clear queued session work and bootstrap retry ownership while retaining mounted viewport subscriptions; controller session guards reject old responses. Visible public content can refresh after logout without a manager remount.
- Tag notifications invalidate affected collections before forced hydration. A complete accepted batch preview needs no extra tag request; incomplete or omitted targets refresh the loaded window. Reply streams await grouped hydration before publishing cold reply IDs.

## Consequences

Navigation through fresh cached content causes no per-card tag request. Cold public profiles and pagination remain functional. Deleted labels disappear on full-window refresh, while temporary local intent protects optimistic changes. A failing tag endpoint retries at a bounded rate independent of healthy entity batches.

Optional cache metadata keeps legacy IndexedDB records readable without a reset. Expanded windows cost more than a preview to refresh. Repeated concurrent writes can still exhaust the bounded retry; pagination then reports a retryable error instead of silently succeeding. A 30-second cooldown delays automatic recovery from transient failures, while explicit interactions and new notifications can proceed.

## Alternatives

- Fetch on every mount: simple, but repeats cached data and causes loading churn.
- Remove mount requests without cache metadata: cannot distinguish unloaded/empty data or maintain server pagination.
- Merge shorter previews indefinitely: retains deleted labels; replacing with each preview truncates expanded lists.
- Expire the whole entity when tag refresh fails: repeatedly downloads healthy details/counts.
- Destroy TTL on logout or clear subscriptions on navigation: loses owners whose components remain mounted.
