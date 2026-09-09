# Eventky verification record

This record separates observed checks from the remaining acceptance work. **The revised implementation is not yet verified complete.** Historical test totals below belong to the earlier scope and source revisions.

## Revised scope: observed checks

| Check                               | Observed evidence                                                                                                                                                                        | Limit                                                                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused revised regression batch    | 210 tests / 14 files passed; `/tmp/eventky-revised-tests.log`                                                                                                                            | Earlier in the revision; later fixes require their own checks                                                                                   |
| Device-timezone display             | 31 tests / 4 files passed; `/tmp/eventky-device-display-tests.log`                                                                                                                       | Covers engine/display/device-hook behavior, not all live browser journeys                                                                       |
| Calendar schedule                   | 16 tests passed; `/tmp/calendar-schedule-final-tests.log`; 4 Chromium VRT tests passed in `/tmp/calendar-schedule-final-vrt2.log`                                                        | Mocked/fixture data; real staging view tests still required                                                                                     |
| Composer lifecycle/serialization    | 21 existing hook tests passed                                                                                                                                                            | Scope is authoring logic, not complete social behavior                                                                                          |
| Shared date/time fields             | 6 tests passed across shared picker and field suites; `/tmp/composer-recurrence-unit2.log`                                                                                               | Monday-first dates, disabled state, civil-date values, timezone/calendar selection and duration behavior                                        |
| Advanced recurrence browser flow    | 2 Chromium tests passed; `/tmp/composer-recurrence-vrt2.log`                                                                                                                             | Browser fixture moves October 1 to October 2 and verifies original recurrence identity/source zone in saved payload; controller write is mocked |
| Contributor full-name fix           | 1 regression test passed; `/tmp/eventky-contributor-tests.log`; focused ESLint and TypeScript checks passed                                                                              | Local fix; not yet verified in deployed browser                                                                                                 |
| Native attendance                   | 10 tests / 3 files passed in `/tmp/attendance-final-tests.log`; 7 scope tests / 2 files passed in `/tmp/attendance-scope-tests.log`                                                      | Overlapping focused suites; real guest lifecycle remains a separate gate                                                                        |
| Staging runtime isolation           | Real owner browser asserts `deployEnv=staging`, staging homeserver key and `/api/eventky/status` backend `http://staging-nexus:8080`; production homeserver network requests are blocked | Verifies the tested origin/configuration; recheck after deployment changes                                                                      |
| Native staging publication          | Calendar and event created through the actual UI; successful homeserver PUTs captured in `/tmp/eventky-staging-fixtures.json`; `/tmp/eventky-authoring-create3.log`                      | Contributor was omitted while guest indexing was unavailable                                                                                    |
| Native staging event fields         | Confirmed `America/New_York`, weekly COUNT=6, selected calendar URI and displayed `eventky-staging` tag                                                                                  | Further edit/attachment/curation checks pending                                                                                                 |
| Native staging reading/edit opening | `view` and `compose-preview` phases passed; screenshots in `/tmp/eventky-staging-authoring/`                                                                                             | Opening the editor is not a successful edit/write test; user header indexing still incomplete                                                   |
| Static checks                       | Focused composer lint, diff checks and later TypeScript checks passed                                                                                                                    | No claim that the latest complete worktree has a clean final whole-repository lint/test run                                                     |

These suites overlap; do not sum them into a unique test count. Browser fixture tests do not substitute for real homeserver end-to-end tests.

## Deployment update

The lead reports both projection services healthy on `staging-backoff-20260909`. Frontend `staging-20260909c` built successfully and is being deployed with the full-name contributor fix. These operational results do not replace pending guest social, owner edit/attachment/curation and final loaded-screen checks. The canonical verified staging TLS/API hostname is `homeserver.staging.pubky.app`.

## Screenshot review

Checked-in Chromium baselines include desktop/mobile composer, open date picker, recurrence-preview picker and occurrence-move picker images. They were inspected for spacing, clipping, control alignment and theme consistency. The review led to friendly duration units and a corrected dark-theme occurrence-time icon.

Real staging screenshots capture the calendar composer, populated event editor and native event post at desktop/mobile widths. The event's New York time correctly displays on the next day in Zurich. The first post captures still show author/loading skeletons while the staging user index catches up; they are diagnostic evidence, not the final clean visual acceptance set. The script now clears autofocus selection and waits for the relevant content before capture. Final screenshots must be taken again after indexing recovery and the last deployment.

## Remaining end-to-end gates

1. Finish staging backend indexing recovery and verify the owner/guest profiles and source projection reach the expected state.
2. Complete guest Going/Maybe/Can't go changes, indexed attendance refresh, comments, tags, bookmarks and reposts with the native UI.
3. Complete owner event editing, attachment upload, moved and cancelled occurrences, and preservation of series identity/social discussion.
4. Deploy and exercise full-name contributor selection. Exercise named event exclusion and restoration without changing the event post.
5. Verify calendar selection, agenda/month/week/day navigation and occurrence rendering against the real staging records, including display-zone/date-boundary behavior.
6. Verify the final deployed UI has no import/export, subscription-link, alarm/reminder, saved local calendar-preference or URI-pasting controls.
7. Run integrated checks appropriate to the final worktree and review the final loaded desktop/mobile screenshots. Do not infer complete Safari/Firefox coverage from Chromium.

The owner script preserves fixture identities and refuses non-staging authoring. Its prepared `edit` and `curate` phases are not passing evidence until their actual runs finish. Only disposable staging accounts may write test data; no signup admin credential or signing key belongs in logs, docs or fixture manifests.

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
