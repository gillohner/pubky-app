# Eventky implementation decisions

## Baselines and authorization

The user authorized creating `gillohner/pubky-app` and implementing the full native Eventky plan with repeated integration and verification. The fork was created on 2026-09-08 at https://github.com/gillohner/pubky-app.

- Implementation checkout: `/tmp/pubky-app-eventky`, branch `feat/eventky-native`.
- Fork point: current upstream default branch `dev`, commit `70dc066a047403850b0d4df181c2fba409043cb9`.
- Nexus compatibility baseline: PR #14, `77ae61a524d3c19c71f674e45874de1c08a91527`.
- The original local Pubky App and Nexus checkouts are preserved.

`plan.md` and `agent-briefs.md` retain the earlier planning snapshot. This record overrides outdated baseline facts in those documents. The current upstream app has `pubky-app-specs` 0.7.0, runtime `PUBKY_RUNTIME_*` endpoint configuration, full attachment editing, and unsupported-kind edits that fail closed. It also requires concrete imports, RHF/Zod forms, and no unprofiled manual memoization. Follow the current AGENTS.md.

## Current interfaces

- Event/calendar sources are normal posts, with exact `kind` and JSON serialized into `content`.
- Post membership is `event.content.calendar_uris`; parent/embed remain social relationships.
- Pure contract implementation is `packages/eventky-contract/src/`, imported through concrete `@eventky/*` aliases.
- `contract.ts` exports EventContent, CalendarContent, CalendarTime, EventOverride, eventContentSchema, calendarContentSchema, parseEventkyContent, serializeEventkyContent and summarizeEventkyContent.
- `parseEventkyContent(kind, content)` distinguishes supported, unsupported-kind, unsupported-version and invalid.
- The native wire module is `src/core/pipes/post/post.wire.ts`: PubkyPostWire, PostSource and toPostWire. Known-kind WASM validation remains in place, but arbitrary custom strings never pass through a numeric enum.
- New composers retain `PostController.prepareCreate`/`commitPreparedCreate` or `prepareEdit`/`commitPreparedEdit` across uncertain retries. The existing convenience methods remain available. `fetchSource` reads the current authoritative homeserver envelope for membership and recovery; it does not read Nexus caches.
- Local details retain parent/embed/lock as optional fields; no database schema bump solely for string kinds or unindexed optional fields.
- Calendar engine dependencies: `ical.js` 2.2.1, `@js-temporal/polyfill` 0.5.1 and `timezones-ical-library` 2.3.1, pinned with passing time/interchange fixtures. Exact supported profiles are in the contract package README.

## Import and private preferences

Imports use a separate IndexedDB database keyed by account, exact Nexus URL, local source name, kind and UID. A reservation retains the native post ID, exact content, prior expected content and attempted-write state before any homeserver PUT. Retry confirms an already-applied payload without rewriting it; changed sources are conflicts. A missing post after an uncertain creation requires explicit acknowledgement before it can be recreated. Imported snapshots replace optional fields rather than patching omitted fields from an older import. Source grouping stays fixed after its first reservation; native post editing can subsequently change membership.

Calendar selections, overlay colors, viewing preferences and reminder opt-ins are local and scoped to account/backend. They are separate from public bookmarks and published alarm suggestions. Notification permission is requested only through a user action. Delivery runs while the app is open, refreshes opted-in sources, suppresses stale/cancelled/muted data and deduplicates deliveries across tabs.

## Projection boundary

`packages/eventky-api` shares validated read contracts between the sidecar and client proxy. The sidecar owns a derived SQLite database and uses private generic Nexus inventory plus immutable change payloads. It stages full inventories, replays retained changes before promotion, tracks pending work durably, and periodically reconciles. Its server receives no authoring requests.

Public `/api/eventky/occurrences` and `/api/eventky/calendar.ics` proxy only to the configured server-side origin; browser credentials and replication tokens are never forwarded. Calendar feeds retain UID/master/exception identity, recheck current membership and deletion state, and issue validators only for a complete response. See the sidecar policy for exact limits and worker deadlines.

## Ownership

Root owns package/lockfile/configuration, documentation, integration, composers/imports and tests crossing packages. The calendar worker owns the contract/recurrence/interchange package and isolated projection execution. The backend worker owns generic Nexus source changes/mentions and real homeserver acceptance. The native client worker owns verified calendar rendering, local preferences/reminders and their browser checks. Coordinate changes to shared boundaries before editing; task-state.md records handoff status.

No deployment has been changed by this implementation wave. Domain configuration remains a release parameter; core development continues against local fixtures and the pinned Nexus contract.
