# Eventky deployment and recovery

The client feature branch is `gillohner/pubky-app:feat/eventky-native`. The optional generic Nexus extension is [PR #15](https://github.com/gillohner/pubky-nexus/pull/15) on `gillohner/pubky-nexus:feat/eventky-generic-projection`, based on PR #14 commit `77ae61a524d3c19c71f674e45874de1c08a91527`. No server credentials or signing keys belong in either repository.

## Roll out in two stages

1. Build the client with its existing Dockerfile. Supply all required `PUBKY_RUNTIME_*` network variables from the deployment's normal runtime configuration. Set `PUBKY_RUNTIME_EVENTKY_ENABLED=true`. Keep `PUBKY_RUNTIME_EVENTKY_CALENDAR_ENABLED=false` for the native post demonstration on unchanged Nexus PR #14. Event/calendar rendering, publishing and normal post interactions do not require the projection.
2. After verifying the generic Nexus extension and its resource budget, deploy that separate Nexus branch. Set a randomly generated `NEXUS_PROJECTION_TOKEN` of at least 32 characters on the web API. The private `/v0/projection/posts/*` endpoints expose retained historical payloads and must remain restricted to trusted services. Never send this token to the browser or place it in a `PUBKY_RUNTIME_*` setting.
3. Build the sidecar from the repository root with `docker build -f services/eventky-projection/Dockerfile -t eventky-projection:<commit> .`. The major-version Node 24 image supports `node:sqlite`; pin a tested image digest in a deployed release. Provide `EVENTKY_NEXUS_URL` and the same token as `EVENTKY_NEXUS_SYNC_TOKEN`. Mount a persistent writable volume at `/data` owned by UID 1000. Bind the sidecar only to the private container network; it needs no homeserver signing credentials.
4. Set the frontend server-only `EVENTKY_PROJECTION_URL=http://eventky-projection:8091` and `PUBKY_RUNTIME_EVENTKY_CALENDAR_ENABLED=true`. The browser uses same-origin `/api/eventky/*` routes. Permit only the intended public read routes through the reverse proxy. Serve the app over HTTPS for authenticated browser functionality and optional local notifications.
5. Wait for `/v1/status` to report a completed reconciliation with no pending changes, then exercise the acceptance checks in `verification.md`. `/healthz` reports projection readiness; a healthy service still needs the client and social acceptance checks.

The supplied Dockerfile is build packaging, not evidence of a successful Docker deployment. The current environment cannot access the Docker daemon; actual graph tests use isolated local Neo4j and Redis processes instead. Public frontend and calendar subscription domains remain deployment parameters.

## Resource and history limits

The Nexus outbox retains 10,000 source revisions. At the maximum custom post size its payloads alone can approach 5 GiB; indexes, active graph data, Redis, the client process and the sidecar add to that. Check real disk/memory headroom on the VPS before enabling it. Do not increase existing container limits beyond host capacity. A revision count cap is not a byte quota.

The sidecar persists its backend identity, epoch/cursor, durable jobs, staged inventories and current sources in SQLite with WAL enabled. It rejects a database opened against a different backend. Range expansion, response sizes, page counts and recurrence work have explicit limits; incomplete results are labeled, and complete subscription feeds fail closed when unavailable. Periodic reconciliation repairs missed or out-of-band source changes. A cursor expired by retention triggers a fresh staged inventory, not guessed deletions.

The read projection is a single writer. Run one sidecar per database volume. Do not attach multiple containers to the same SQLite file. Queries and feed exports run in workers with two-second active deadlines and one-second queue deadlines. Set `EVENTKY_WORKERS=1` for the more conservative initial VPS footprint (default: two); use the container memory cap and do not set Node heap override flags, which defeat per-worker limits and are rejected at startup. See [subscription and worker limits](../../services/eventky-projection/SUBSCRIPTIONS.md). CPU-bound recurrence expansion should still be load-tested with the deployment's expected series count and traffic before broader release.

## Recovery and rollback

- First disable the calendar flag to remove date-query UI; normal event/calendar posts stay available. Disabling authoring separately removes creation controls. Neither action rewrites posts.
- Stop the sidecar before replacing or restoring its database. Back up the database with SQLite's backup API, or stop the process and copy the main file together with its WAL/SHM files. The projection can be rebuilt from current Nexus inventory; post sources remain authoritative.
- A failed inventory never replaces the active generation. An unavailable source is not treated as deleted. After restore, verify the reported backend identity, epoch, coverage and checkpoint before serving subscriptions.
- Reverting the generic Nexus extension stops new invalidations. Leave historical outbox nodes intact until an explicit maintenance decision; do not run destructive cleanup as part of ordinary rollback.
- Browser import ledgers and reminder/subscription preferences are local to that browser, account and backend. Clearing site storage removes retry mappings and private preferences; it does not delete public posts. Export or record important mappings before clearing it.

## Legacy preview

`npm run eventky:migration:build` builds a read-only migration preview command. Run `node dist/eventky-migration-preview.cjs input.json > report.json`. Input is `{ "owner": "<public-key>", "now": "<UTC timestamp>", "uriMap": { "<legacy-uri>": "<allocated-post-uri>" }, "records": [{ "uri": "<legacy-uri>", "data": {} }] }`.

The preview validates ownership, microsecond timestamps, calendar references and master/exception grouping. It prints calendar entries before events and reports unsupported fields or missing URI mappings. Exit status 2 means the report contains migration errors. It never publishes, removes legacy records, activates alarms or impersonates attendees. Review its report before any separate authenticated publication.
