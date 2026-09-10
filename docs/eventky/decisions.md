# Eventky implementation decisions

## Baselines and authorization

The user authorized creating `gillohner/pubky-app` and implementing the full native Eventky plan with repeated integration and verification. The fork was created on 2026-09-08 at https://github.com/gillohner/pubky-app.

- Implementation/test checkout: `/tmp/pubky-app-eventky`, branch `feat/eventky-native`; permanent delivery checkout: `/home/gil/Repositories/pubky/pubky-app-eventky`.
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

## Native workflow boundary

The revised application has no calendar import/export, subscription-link, alarm/reminder or local calendar-preference UI. Calendar selection is current navigation state; display always uses the device timezone and weeks start on Monday. Event authoring can choose another timezone, with source wall-time labels preserved for recurrence edits. Calendar membership, contributors and exclusions use named native resource pickers rather than public-key or URI text entry.

The earlier implementation included a durable import ledger and account/backend-scoped reminder/preferences stores. Those designs are historical and no longer define the native experience. Retained protocol/interchange modules and readable existing wire metadata must not reactivate removed workflows. Their historical tests do not prove the revised UI requirements.

## Public events and availability

Public Pubky events describe an event, not the viewer's personal availability. The editor therefore has no “Show this time as free” control or replacement availability setting. Existing RFC `TRANSP` values remain compatible: the hidden form defaults retain an existing event's value during edits, while new events use the existing opaque default. Removing the control must not rewrite a transparent source merely because another field was edited.

## Projection boundary

`packages/eventky-api` shares validated read contracts between the sidecar and client proxy. The sidecar owns a derived SQLite database and uses private generic Nexus inventory plus immutable change payloads. It stages full inventories, replays retained changes before promotion, tracks pending work durably, and periodically reconciles. Its server receives no authoring requests.

Public `/api/eventky/occurrences` and `/api/eventky/calendar.ics` proxy only to the configured server-side origin; browser credentials and replication tokens are never forwarded. Calendar feeds retain UID/master/exception identity, recheck current membership and deletion state, and issue validators only for a complete response. See the sidecar policy for exact limits and worker deadlines.

## Ownership and deployment

Calendar_ux owns calendar navigation/filter discovery, composer_ux owns authoring controls, attendance owns response contracts and native content actions, and the lead owns shared integration, backend review, staging infrastructure and final evidence. Coordinate shared-boundary changes before editing; [task-state.md](task-state.md) records handoffs and unresolved acceptance work.

The application is published at `https://159.69.22.174`, using `homeserver.staging.pubky.app` and an isolated staging Nexus/projection. Frontend `staging-20260909e` is live and healthy. Backend `dce35bf7` is live with sticky primary-user indexing enabled; both staging users are indexed and the configured projection is complete. Live HTTP 429 handling paused for 60 seconds, then a successful request advanced the persisted global cursor to 25350. Historical catch-up continues; projection completeness covers configured Nexus sources, not all homeserver history. Production-homeserver test publication is prohibited. See [deployment.md](deployment.md) for image identity, private boundaries and the sticky-primary rollback constraint, and [verification.md](verification.md) for completed journeys and remaining acceptance.

## Current scope revision (2026-09-09)

The latest user requirements supersede the earlier import/preferences scope. The native UI must have calendar selection and calendar views, event/calendar creation and editing, and attendance. Display always uses the device timezone with Monday as the week start; event authoring may choose another timezone. Date/time fields use native Shadcn patterns. Remove import/export and subscription-link entry points, reminder activation and local preference controls, and replace URI text entry with named native resource pickers. Existing wire data must remain readable without activating removed features.

Acceptance now requires real staging-homeserver end-to-end journeys (never production fixture publication), desktop/mobile screenshots and visual review. Earlier tests are historical evidence, not proof of this revision. The deployed VPS Nexus/projection are available for inspection; staging test data must stay separate from its production homeserver dataset.

Current ownership: calendar_ux owns calendar navigation/filter discovery; composer_ux owns authoring controls; attendance owns response contracts and native content actions; root owns shared integration, backend review, staging harness and final evidence. No completion claim until the revised requirements are verified.


## Attendance roster and discussion boundary (2026-09-09)

Universal `attendance` posts remain the public write contract and history. Event discussion suppresses their status cards in favor of a compact current-attendee row and native grouped dialog. Resolution stays author-bound and recurrence-aware; each selected scope resolves one current response per person. No organizer-maintained roster or private attendance store is introduced.

Reply discovery is shared across attendee, discussion and count consumers, scoped by backend/viewer/event/cursor. It scans raw pages of 50 with a 1,000-record work budget per request and explicit continuation/partial states. Filtering after pagination prevents status-only pages from prematurely ending discussion. Exact comment counts are shown only for complete discovery; index completeness is not a guarantee of an atomic homeserver snapshot.

Hydration reuses the native post application path. Only explicitly pending event reply writes can override indexed source content; full prepared-envelope comparison protects content and attachment-only edits until indexing catches up. Pending acknowledgement is versioned, account/backend scoped and ephemeral. Native tombstones retain deletion protection. Local unit and visual results are recorded in [attendance.md](attendance.md); deployed browser acceptance remains separately owned by the staging verification workflow.
