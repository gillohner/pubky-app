# Eventky deployment and recovery

The revised application is published at [https://159.69.22.174](https://159.69.22.174). Staging acceptance is still in progress. The presence of a healthy frontend container is not evidence that indexing, projection coverage or the complete user journey has passed.

Review branches are `gillohner/pubky-app:feat/eventky-native` ([client PR #1](https://github.com/gillohner/pubky-app/pull/1)) and the optional generic Nexus extension ([PR #15](https://github.com/gillohner/pubky-nexus/pull/15), stacked on PR #14). Deployed source can include later integration changes; never assume a PR's earlier CI run covers the current image. No server credential, homeserver admin password or account signing key belongs in either repository.

## Current staging deployment

The HTTPS reverse proxy serves the frontend and routes Nexus reads to an isolated staging backend. The original production-homeserver Nexus dataset is not the staging test index. The browser writes through the staging homeserver; the projection is derived read-only data and receives no signing key.

Frontend image `pubky-vibe/eventky-frontend:staging-20260909c` has built successfully and is being deployed. It includes the contributor full-name search fix. The earlier `staging-20260909b` image served the recorded owner publication tests. Both projection services are healthy with the `staging-backoff-20260909` image. This health result does not establish completion of the remaining user-profile/indexing and browser acceptance checks. The deployment lead owns current image/configuration state; inspect it before restart or rollback.

| Boundary                       | Verified setting or behavior                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Public frontend                | `https://159.69.22.174`                                                                                         |
| Runtime environment            | `window.__PUBKY_CONFIG__.deployEnv` equals `staging`                                                            |
| Authoritative write homeserver | `ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy` (`homeserver.staging.pubky.app`)                         |
| Native event/calendar flags    | Both enabled for this staging application                                                                       |
| Browser read path              | Same-origin Nexus and `/api/eventky/*` routes                                                                   |
| Projection backend identity    | `/api/eventky/status` returns `{ "ok": true, "value": { "backend_id": "http://staging-nexus:8080", ... } }`     |
| Private staging loopback ports | Nexus `8082`, projection `8092`; these are operator endpoints, not browser configuration                        |
| Browser cache separation       | Frontend build uses `eventky-staging-v2` database name to avoid carrying over the earlier production read cache |
| Test identities                | Disposable owner and guest created on staging; persistent profiles stay on the development machine              |

The owner authoring harness explicitly checks the environment, homeserver key and staging projection identity before enabling writes. It aborts requests to the production homeserver. Keep these checks when extending the harness. Do not reuse the production homeserver for convenience or copy browser profile contents into evidence artifacts.

Current application scope has no import/export, subscription-link, alarm/reminder or local calendar-preference controls. The internal RFC/ICS protocol modules may still exist; they do not require exposing another app workflow or public route. Reading uses the device timezone automatically. Authoring can use a different event timezone, and its recurrence editor preserves that source wall-time meaning.

## Verification before broader use

1. Inspect the current frontend image, runtime network settings and reverse-proxy targets. Confirm the staging homeserver key and isolated backend identity again after any deployment change.
2. Check the Nexus information endpoint and the private projection readiness/status. A running process or a `200` status envelope is not the same as `coverage.complete=true`.
3. Verify newly created staging user profiles and native posts reach Nexus. At the time of this record, missing new user profiles and incomplete source catch-up remain under investigation.
4. Reconcile projection coverage after the index is healthy. Verify zero unexplained pending/invalid/unavailable sources before interpreting an empty calendar result as complete.
5. Run the pending real-browser gates in [verification.md](verification.md), including guest social/attendance and owner edit/curation, then capture and review the final loaded desktop/mobile UI.

Safe public read-only checks:

```sh
curl --fail https://159.69.22.174/v0/info
curl --fail https://159.69.22.174/api/eventky/status
```

Use the configured trust chain for HTTPS; do not make certificate verification bypasses part of the application. Inspect private readiness from the VPS itself. Do not print Docker environment arrays or secret files when collecting evidence.

## Building another isolated deployment

1. Build the frontend from the intended source with its Dockerfile and environment-specific database name. Supply the normal required `PUBKY_RUNTIME_*` settings, `PUBKY_RUNTIME_EVENTKY_ENABLED=true`, and `PUBKY_RUNTIME_EVENTKY_CALENDAR_ENABLED=true`. Serve authenticated browser functionality over HTTPS.
2. Use a compatible Nexus build with the generic projection extension and the intended homeserver dataset. Allocate separate graph/cache state for a staging index. Preserve any newer universal-parent compatibility changes when choosing a deployment revision.
3. Generate a server-only `NEXUS_PROJECTION_TOKEN` of at least 32 characters. The private `/v0/projection/posts/*` endpoints expose retained source history and belong only on the trusted service network. Never pass the token through a `PUBKY_RUNTIME_*` variable or forward it to browsers.
4. Build the sidecar from the repository root with `docker build -f services/eventky-projection/Dockerfile -t eventky-projection:<revision> .`. Its Node 24 runtime supports `node:sqlite`. Set `EVENTKY_NEXUS_URL` to the isolated Nexus and `EVENTKY_NEXUS_SYNC_TOKEN` to the same server-only token. Mount a persistent writable `/data` volume owned by UID 1000.
5. Set the frontend server-only `EVENTKY_PROJECTION_URL` to that sidecar. The browser uses same-origin application proxy routes. Bind backend services to private networks/loopback; permit only the required public read routes through the reverse proxy.
6. Wait for an actual complete inventory/replay state, then perform the real application acceptance checks. Do not silently change the backend behind an existing projection database.

## Resource and history limits

The generic Nexus outbox retains 10,000 source revisions. At the maximum custom-post size, payloads alone can approach 5 GiB, before graph indexes, active data, Redis, frontend and sidecar storage. Measure host disk and memory headroom before another build or enabling history; a revision cap is not a byte quota. Keep container limits within the host's actual capacity.

The sidecar persists its backend identity, epoch/cursor, durable jobs, staged inventories and current sources in SQLite with WAL enabled. It rejects a database opened against a different backend. Inventory promotion, range expansion, response size, pagination and recurrence work are bounded. Retention expiry triggers a fresh staged inventory rather than guessed deletions.

Run one sidecar writer per database volume. Query workers use bounded execution and queue deadlines. `EVENTKY_WORKERS=1` is the conservative VPS configuration; do not override Node heap flags that defeat per-worker limits. Protocol-level feed/worker limits remain documented in [SUBSCRIPTIONS.md](../../services/eventky-projection/SUBSCRIPTIONS.md), even though the native UI has no subscription/export controls. Production throughput and broad external-client compatibility have not been established by staging functional checks.

## Recovery and rollback

- Capture the current image tags, source revisions, non-secret configuration and reverse-proxy targets before changing them. Keep the production and staging stacks/data identities distinct throughout recovery.
- Disable the calendar-query flag first if projection results are unavailable. Normal event/calendar posts remain authoritative; changing feature flags does not rewrite them.
- Stop the sidecar before restoring its database. Use SQLite's backup API, or stop the process and copy the main database with its WAL/SHM files. A fresh projection can be rebuilt from the intended Nexus inventory.
- Never copy a production projection database into a staging sidecar. After restoration, verify backend identity, epoch, source coverage and checkpoint before trusting query results.
- A failed inventory must not replace the active generation, and an unavailable source must not be interpreted as deleted. Keep fail-closed behavior while diagnosing indexing gaps.
- Reverting the Nexus extension stops new invalidations. Retain source-history nodes until a separate explicit maintenance decision; ordinary rollback must not destroy graph or homeserver data.
- Keep disposable browser profiles intact while tests are underway. Clearing site storage can remove the authenticated test session and local unsynchronized work; it is not a backend repair or a public-post deletion.

The older read-only migration preview and interchange code are outside the current native workflow. Do not add migration publication, alarms or preference management to a deployment acceptance run for this revision.
