# Eventky verification record

Final staging acceptance remains in progress. The following results distinguish deployed journeys from local regressions. Historical test totals apply only to their recorded source and must not be summed with overlapping focused suites.

## Current deployment

Frontend `staging-20260909e` is live and healthy. Backend `dce35bf7` is live with sticky primary-user indexing enabled; both staging users are indexed and the configured projection is complete. Live HTTP 429 handling paused for 60 seconds, then a successful request advanced the persisted global cursor to 25350. Historical catch-up continues; projection completeness covers configured Nexus sources, not all homeserver history.

Keep primary-user indexing enabled under the [backend rollback constraints](https://github.com/gillohner/pubky-nexus/blob/deploy/eventky-vps/docs/primary-user-indexing.md). No cursor reset or skipped history is part of this deployment.

## Real staging results

| Journey | Verified evidence | Scope |
| --- | --- | --- |
| Isolation and initial publication | `/tmp/eventky-staging-fixtures.json`; owner/guest harness checks staging environment, homeserver key and isolated projection identity | Staging writes only |
| Owner edit and attachments | `/tmp/eventky-owner-edit.log`, `/tmp/eventky-owner-edited-projection.json` | First occurrence moved while retaining original identity; October 8 cancelled; complete configured projection |
| Named calendar curation | `/tmp/eventky-owner-curate.log` | Full-name contributor selection and main-event exclusion/restoration |
| Guest social actions | `/tmp/eventky-staging-social/results.json` | Going/Maybe, comment, tag, bookmark and repost passed on c; latest grouped-roster checks separate |
| Calendar views | Same social results and reviewed calendar screenshots | Agenda/month/week/day and named selection passed; final clean captures pending |
| All-day lifecycle | Owner native authoring harness, frontend d | Create, civil-date projection, native DELETE, source GET 404 and projected removal passed |
| Guest contribution | Guest native publication, frontend d | Named owner calendar selected, source PUT/GET and complete projected membership passed |
| Owner curation of guest contribution | `/tmp/eventky-owner-guest-curation-e.log`, guest excluded/included projection snapshots | Exclusion and restoration passed on e |
| Removed-workflow audit | `/tmp/eventky-owner-authoring-audit-e3.log` | Final native authoring audit passed on e |
| Grouped attendance | `/tmp/eventky-social-attendance-e2.log`, exit 0 on e | Whole-series decline PUT/GET/indexed reload; unique grouped identities; ordinary comment retained, status cards hidden and correct badge; occurrence Going with original recurrence identity survived reload while whole-series decline remained unchanged |

The edited first occurrence is October 2, 2026 at 18:00 New York, visible October 3 at midnight on a Zurich device. Its original recurrence identity remains October 1. Do not compare the earlier pre-edit screenshot dates as if the event source were unchanged.

## Current local and backend regressions

| Check | Evidence | Limit |
| --- | --- | --- |
| Integrated attendance/discussion and native shared paths | 383 tests / 16 files; `/tmp/eventky-attendee-final-tests.log` | Includes existing post, stream, thread and action tests; focused suite |
| Attendance visual surfaces | Two Chromium tests, six desktop/mobile baselines; `/tmp/eventky-attendance-vrt.log` | Compact row and grouped dialogs visually reviewed |
| Calendar visual surfaces | Six updated Chromium VRT cases passed for e | Mock-based screenshots supplement real calendar journeys |
| TypeScript and final repository lint | `/tmp/eventky-attendee-final-typecheck.log`, `/tmp/eventky-final-e-lint2.log` | Passed for integrated e source |
| Production packaging | `/tmp/eventky-frontend-staging-e-final-build.log` | e production build passed; image live healthy |
| Real graph concurrency | Eight-writer regression passed in 11.05 seconds; `/tmp/eventky-graph-final-validation.log` | Disposable real Neo4j; not load certification |
| Primary indexing integration | `/tmp/eventky-primary-global-integration.log`, `/tmp/eventky-primary-retry-integration.log`, `/tmp/eventky-primary-lane-final-integration.log` | Handoff, stale retry and ordered failure tests passed against isolated tunneled databases |
| Backend focused units | Nine graph retry, four primary-lane, one legacy-config and one projection-quota test passed | Separate from historical full backend CI |
| HTTP throttle handling | Three focused tests; `/tmp/eventky-http-status-units.log`, `/tmp/eventky-http-backoff-units.log`, `/tmp/eventky-http-backoff-check.log` | Live 60-second pause and subsequent cursor advancement also verified |

Earlier revised-scope focused runs covered device-timezone semantics, form reactivity, calendar schedules, contributor freshness and projection backoff. They overlap these checks and are not a new full-suite total. The supported RFC profile and bounded recurrence/interchange limitations remain in the [contract documentation](../../packages/eventky-contract/README.md). Browser evidence is Chromium-only; Safari/Firefox compatibility has not been established. A runner shutdown-timeout notice after passed tests is distinct from an assertion failure.

The first attendance harness repeatedly reloaded every five seconds, aborting outstanding reads while public bulk-post requests encountered HTTP 429. A settled retry passed against the unchanged deployed runtime. Dense browser reloads can hit the public bulk-read rate limit; this result does not establish unrestricted reload throughput. The final owner authoring audit also captured loaded event/calendar editors.

## Remaining acceptance gates

1. Delete the disposable guest contribution through the native UI and verify source deletion and projected removal. Preserve the main demo event/calendar.
2. Capture and review clean loaded desktop/mobile calendar and attendee surfaces after cleanup.
3. Record final evidence and source/image identity. Historical homeserver catch-up remains ongoing independently of these functional gates.

Only disposable staging accounts may publish test data. Evidence must contain no persistent browser sessions, admin credentials or signing keys.

## Repeatable current commands

```sh
NODE_OPTIONS=--no-webstorage npx vitest run --project unit src/hooks/useEventkyPostForm src/components/organisms/EventkyPostForm src/components/molecules/EventkyDatePicker
NODE_OPTIONS=--no-webstorage npx vitest run --project vrt --browser.name chromium src/components/organisms/EventkyPostForm/EventkyPostForm.vrt.test.tsx
npm run typecheck
npm run lint
EVENTKY_AUTHORING_PHASE=view EVENTKY_STAGING_ROUTE_READY=yes node scripts/eventky-staging-authoring.mjs
# Run edit/curate only after coordinating fixture ownership and staging readiness:
EVENTKY_AUTHORING_PHASE=edit EVENTKY_STAGING_ROUTE_READY=yes node scripts/eventky-staging-authoring.mjs
EVENTKY_AUTHORING_PHASE=curate EVENTKY_STAGING_ROUTE_READY=yes node scripts/eventky-staging-authoring.mjs
```

The real-browser script also requires the already-created owner profile and public fixture files on the development machine; it does not create or silently replace an identity. WebKit host dependencies are unavailable in this environment. The Chromium harness can report a shutdown-timeout notice after passing tests; distinguish that notice from test failures and confirm process completion.

## Historical baseline, before the revised scope

The following table is retained from the original implementation record. It includes now-removed UI workflows and applies to that earlier source, not the final revised deployment. Backend [CI run 34246154418](https://github.com/gillohner/pubky-nexus/actions/runs/34246154418) passed on `4e930142` with 1,066 tests; the newer staging deployment and any indexing fixes need their own evidence. The original client full-suite result was local, not a current PR-check claim.

| Check                             | Evidence                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Final frontend regression suite   | 800 files passed: 13,482 tests passed, two skipped, in 705.93 seconds. This final run excludes only the separately verified Node sidecar files; frozen source includes all final import and write-boundary fixes.                                                                           |
| Universal writes                  | Initial 275 focused tests; final 181 affected write tests passed after adding full-envelope concurrency guards. Fourteen composer lifecycle tests passed, including account changes and retained uncertain writes.                                                                          |
| Cache / discovery / rendering     | 534 focused cache/discovery checks and 217 native renderer checks passed, covering raw kind strings, complete envelopes, escaped stream keys and native post integration.                                                                                                                   |
| Calendar contract / interchange   | 75 tests passed for DST, custom VTIMEZONE, fold/gap semantics, recurrence bounds, original exception identities, ICS folding/roundtrips/GEO and legacy previews.                                                                                                                            |
| Calendar view / hydration         | 44 focused tests passed for date windows, pagination, exact source hashes, local mutation overlays and native post hydration.                                                                                                                                                               |
| Private preferences / reminders   | 51 tests passed, including account/backend isolation, explicit opt-in, cancellation/muting/deletion, latest revision checks and cross-tab deduplication.                                                                                                                                    |
| Durable imports                   | Initial 16 ledger/helper/publication tests passed; final 12 hook tests passed including asynchronous file/account changes, repeated preview clicks and uncertain-write recovery.                                                                                                            |
| Browser import worker             | Five transport/lifecycle tests and one real Chromium RFC roundtrip passed. Parsing has a five-second hard deadline, 2 MiB input and bounded result transport.                                                                                                                               |
| Native browser surfaces           | Eight Chromium desktop/mobile tests passed for composer, import dialog, calendar views and native event content. The two import-dialog tests passed again using the real Web Worker. Eight screenshot baselines are included.                                                               |
| Source projection workers         | Target Node 24.18.0 actual app unit project:35 sidecar tests / 4 files passed. Dense recurrence, hung/heap-exhausted workers, queue deadlines, cancellation, stale conditional responses, snapshot limits and SQLite migration were exercised.                                              |
| Public HTTP boundaries            | 42 focused sidecar/feed/proxy tests passed; seven additional JSON proxy tests passed for fixed upstream, credentials, HTTP failure handling, UTF-8 and byte limits.                                                                                                                         |
| Nexus graph replication           | Actual Neo4j 5.26.27 test passed immutable source envelopes, edits/deletes, rollback, concurrent revisions, inventory, retention and user deletion guard. Final reset-floor unit and rollback-only live Cypher regression passed without modifying the shared checkpoint.                   |
| Nexus mentions                    | Seven extraction tests, three generic social parser tests and a live Neo4j/Redis lifecycle test passed kind transitions, tombstones, recovery and notification deduplication.                                                                                                               |
| Private source protocol           | Revision/reset and bearer authorization/reset tests passed. Strict Clippy passed for common, watcher and web API libraries; common-library Clippy passed again after the final retention fix.                                                                                               |
| Real homeserver social acceptance | One actual Pubky testnet homeserver→watcher→Neo4j/Redis fixture passed in 8.04 seconds. Both event/calendar kinds retained exact content, native comments, tags, reposts, bookmarks, kind-only/content edits and deletions.                                                                 |
| Production packaging              | Dual-entry sidecar bundle passed. Migration CLI built and converted an owned legacy event without publication; oversized and non-regular file rejection passed. Final Next production build passed, including the bundled browser import worker, TypeScript, static pages and build traces. |
| Static checks                     | Repository-wide ESLint and Prettier checks passed. Final build TypeScript passed; the test-only NODE_ENV typing issue is fixed. Rust formatting and both diff checks pass.                                                                                                                  |
