# Eventky verification record

This record distinguishes passing component checks from release gates that still need evidence. Commands run in the isolated feature checkouts, leaving the user's original repositories unchanged.

## Recorded checks

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

These are overlapping suites; do not sum the rows into a unique test count. Node 25 tests use `NODE_OPTIONS=--no-webstorage` because its native Web Storage shadows jsdom's localStorage. Sidecar runtime checks also ran on Node 24.18.0, matching its Dockerfile major version.

## Delivery and deployment limits

A combined run exhausted the temporary workspace quota. Generated webpack caches and superseded Rust intermediates were removed; the complete frontend regression suite then passed on frozen source. Interrupted quota runs are excluded from the passing evidence above. Temporary local database services used by completed homeserver acceptance tests were shut down afterward.

The browser harness emits a shutdown-timeout notice after successful Chromium checks and exits 0. Firefox/WebKit are not established by these results; WebKit's host libraries are unavailable here. Docker image builds, live HTTPS login/write flows, external calendar-client compatibility and production throughput/capacity remain deployment checks. No implementation-phase VPS mutation or public demo-account publication occurred.

The backend implementation is [PR #15](https://github.com/gillohner/pubky-nexus/pull/15), commit `4e4b9aeebd1f10715c543e28984e77983aa8971b` on `feat/eventky-generic-projection`, stacked on unchanged PR #14 at `77ae61a5`. Its initial CI formatter and test-only initializer warnings were corrected. The full workspace formatter and exact CI lint scope (`cargo clippy --all-targets -- -D warnings`) pass locally. The client is [draft PR #1](https://github.com/gillohner/pubky-app/pull/1), with implementation commit `37913c32` and a documentation-only delivery update. GitHub check status is available on both PRs; local passes above do not imply remote checks have completed. Commits follow the current Git configuration and are unsigned.

Permanent checkouts are `/home/gil/Repositories/pubky/pubky-app-eventky` and `/home/gil/Repositories/pubky/pubky-nexus-eventky`. Tests ran in the isolated temporary implementation checkouts before publication.

## Repeatable commands

```sh
NODE_OPTIONS=--no-webstorage npm test -- --maxWorkers=4 --exclude='services/eventky-projection/**'
# Run these with Node 24 for the sidecar runtime target:
NODE_OPTIONS=--no-webstorage npm test -- --maxWorkers=2 services/eventky-projection/src
npm run typecheck
npm run lint
NODE_OPTIONS=--no-webstorage NEXT_TELEMETRY_DISABLED=1 npm run build
NODE_OPTIONS=--no-webstorage npx vitest run --project='vrt (chromium)' src/components/organisms/EventkyPostForm/EventkyPostForm.vrt.test.tsx
npm run eventky:projection:build
npm run eventky:migration:build
```

The repository's complete VRT project additionally selects Firefox and WebKit. WebKit's required host libraries are unavailable in this environment; do not claim Safari coverage from Chromium screenshots.

For the Nexus tests and private protocol operation, see `docs/private-post-projection.md` in the backend feature branch. All test keys and isolated service data are disposable fixtures; no real account key is part of a source change or artifact.
