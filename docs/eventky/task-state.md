# Eventky task state

Status as of 2026-09-09: **implementation and staging acceptance in progress**. The revised user requirements supersede the original import/reminder delivery. This record does not claim completion. See [verification](verification.md) for observed results and [decisions](decisions.md) for shared boundaries.

| Area                                               | Owner             | Current state                                                                                                                                                      | Remaining acceptance                                                                              |
| -------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Native post contract and generic source projection | Lead/backend      | Existing event/calendar contract, immutable source synchronization and optional Nexus extension retained                                                           | Finish isolated staging indexing recovery; verify fresh complete projection coverage after writes |
| Calendar views and named selection                 | calendar_ux       | Agenda/month/week/day, useful timed schedule views, shared date picker, device timezone and Monday week start implemented                                          | Real staging overlay/view/navigation checks against indexed fixtures; final visual review         |
| Event/calendar authoring                           | composer_ux       | Shared ShadCN dates, event-only timezone selection, duration units, native named membership/contributor/exclusion controls implemented                             | Real event edit, attachment, occurrence move/cancel and calendar curation phases                  |
| Native attendance                                  | attendance + lead | Native attendance replies, series/occurrence resolution, bounded discovery and retry/account guards implemented                                                    | Guest staging RSVP changes and social journeys, including post-index refresh behavior             |
| Device-timezone display                            | attendance        | Reading surfaces convert through the shared calendar engine; authoring retains source wall-time labels                                                             | Final cross-device screenshot/acceptance checks                                                   |
| Removed workflows                                  | Lead + workers    | Import/export and subscription-link UI, reminder activation and local preference controls removed; no URI-pasting controls                                         | Final absence audit in deployed UI                                                                |
| Staging deployment                                 | Lead              | HTTPS frontend at `https://159.69.22.174`; separate staging Nexus/projection; staging homeserver runtime verified                                                  | Backend indexing fix and final frontend rebuild for later local fixes                             |
| Real owner browser checks                          | composer_ux       | Staging calendar/event created through UI, homeserver PUTs confirmed; named calendar, timezone, recurrence and tag persisted; post rendering/editor opening passed | Run prepared edit/curate phases after guest checks and indexing readiness                         |
| Real guest browser checks                          | Lead              | Guest staging account created                                                                                                                                      | Social/attendance results not yet established by this record                                      |
| Evidence and review                                | Lead + workers    | Focused tests and Chromium screenshots recorded                                                                                                                    | Revised-scope completion audit and final integrated checks                                        |

Deployment update: both projection services are healthy on `staging-backoff-20260909`; frontend `staging-20260909c` built successfully and deployment is underway. The canonical staging hostname is `homeserver.staging.pubky.app`. Guest social and owner edit/curation acceptance remain pending.

## Public staging fixtures

The owner key is `33z96rj5sgyodym3yf8j3jncecogmkssuzbuobprk7jts5j8swpy`.

- Calendar post: `0035P2T1EFT30`.
- Event post: `0035P2T1T0B20`.
- Guest key: `ybjyked1u5ktb37rhzq71ddogywq7dcwmjsdumdcrh7u8reuscxy`.

The event starts on 2026-10-01 at 18:00 in `America/New_York`, ends at 20:00 and repeats weekly six times. A Zurich device displays the first interval on October 2 from midnight to 02:00. The exact public source snapshots and successful owner checks are recorded in `/tmp/eventky-staging-fixtures.json` on the development machine. These are staging fixtures, not production posts.

`../../scripts/eventky-staging-authoring.mjs` uses the persistent disposable owner browser profile. Its `create`, `view` and `compose-preview` phases passed. `edit` and `curate` are prepared, not yet passed. Do not rerun `create` to duplicate existing fixtures or use the owner profile concurrently with another browser process.

## Open findings

- The staging index has not yet supplied the new user profiles reliably. Author headers can remain skeletons and guest contributor discovery returns no user. The lead is investigating the backend before broadening acceptance claims.
- A real full-name contributor search attempt exposed the mention-autocomplete restriction on spaces. The local picker now uses the existing general search hook; its regression test passes. The fix still needs deployment and real full-name selection verification.
- Earlier baseline results (including the full 13,482 frontend and 1,066 backend suites) apply to their recorded source revisions. They are not a full regression run of the revised worktree.

Permanent implementation checkouts are `/home/gil/Repositories/pubky/pubky-app-eventky` and `/home/gil/Repositories/pubky/pubky-nexus-eventky`. The original user checkouts remain separate. Attendance invitations, delegated rosters and arbitrary RFC features outside the documented contract are not implied by native RSVP support.
