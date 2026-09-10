# Eventky task state

Status as of 2026-09-09: **final guest cleanup and staging captures in progress**. Current user decisions supersede the original import/reminder plan.

| Area | Observed state | Remaining acceptance |
| --- | --- | --- |
| Native event/calendar posts | Normal universal-kind posts and social actions published on staging | Final revised attendance integration |
| Event authoring | Creation, edit, attachment, moved/cancelled recurrence and source identity preservation passed | None for these recorded journeys |
| All-day lifecycle | Native create, civil-date projection, DELETE, exact source GET 404 and projected removal passed on d | None |
| Calendar views | Named selection and agenda/month/week/day passed on d; mobile bounds and screenshots reviewed | Final clean captures after disposable guest event removal |
| Guest contribution | Named owner calendar selected, source PUT/GET and complete projected membership passed on d | Owner exclusion/restoration passed on e; guest deletion pending |
| Discovery freshness | Initial event/calendar streams and editable policy now refresh before picker use; 7 tests passed | Owner exclusion/restoration passed on e |
| Attendance and comments | Going/Maybe and native comment/tag/bookmark/repost passed on c; grouped attendee UI and comment filtering implemented locally | e passed decline/indexed reload, unique grouped identities, clean discussion/counts and occurrence override with unchanged series response |
| Description editor | Pubky border around full editor live on d; desktop/mobile reviewed | None |
| Removed workflows | Import/export, subscription, alarms, local preferences and availability checkbox absent | Audit passed on e |
| Backend | dce35bf7 live and healthy; primary users and complete configured projection verified; backoff and cursor advancement observed | Historical catch-up continues independently |

Public frontend: https://159.69.22.174. Live image: `staging-20260909e`, including attendance redesign and fresh picker discovery; production build and repository lint passed. Only the canonical staging homeserver `homeserver.staging.pubky.app` is configured for browser writes. The isolated staging projection uses `http://staging-nexus:8080`; its private source endpoints are not public.

Backend `dce35bf7` handles HTTP 429 before parsing a response as event data. The live log showed a 60-second backoff and a subsequent successful request; Redis confirmed historical cursor 25350, beyond the earlier 15600 checkpoint. This is ongoing catch-up, not complete homeserver history. The source projection's completeness is scoped to its configured Nexus sources.

Keep primary-user indexing enabled while global history trails delegated users. See the [backend rollback constraints](https://github.com/gillohner/pubky-nexus/blob/deploy/eventky-vps/docs/primary-user-indexing.md).

## Public staging fixtures

The owner key is `33z96rj5sgyodym3yf8j3jncecogmkssuzbuobprk7jts5j8swpy`.

- Calendar post: `0035P2T1EFT30`.
- Event post: `0035P2T1T0B20`.
- Guest key: `ybjyked1u5ktb37rhzq71ddogywq7dcwmjsdumdcrh7u8reuscxy`.

The event's series starts October 1, 2026 at 18:00 in `America/New_York`, ends at 20:00 and repeats weekly six times. Its first occurrence has now moved to October 2 at 18:00 New York (October 3 at midnight on a Zurich device); the original October 1 recurrence identity is retained. The October 8 occurrence is cancelled. Earlier screenshots of October 2 in Zurich describe the pre-edit first occurrence.

Public source/check evidence is in `/tmp/eventky-staging-fixtures.json`; projected overrides are in `/tmp/eventky-owner-edited-projection.json`. Guest evidence is `/tmp/eventky-staging-social/results.json`. These contain public staging fixture identifiers, never signing keys.

The owner harness creation, viewing, edit, main-event curation and all-day create/delete phases have passed. The guest-event exclusion/restoration phase passed on e. Persistent browser profiles must remain exclusive to their assigned worker.

## Final handoffs

- Attendance worker owns grouped attendee UI, event discussion pagination/counts and regression coverage.
- Composer worker owns owner curation of the held guest event and reviewed editor/attendee visuals.
- Calendar worker owns the final guest attendance harness, disposable contribution deletion and clean calendar captures.
- Lead owns integration review, production build/deployment, source commits, PR description and final evidence.

The held guest contribution is `ybjyked1u5ktb37rhzq71ddogywq7dcwmjsdumdcrh7u8reuscxy:0035P3DJ95JTG`. Owner exclusion/restoration is verified; the assigned guest worker now owns its native deletion and projected-removal check. The main demo event and calendar remain published. The owner all-day disposable event `0035P3DM6N5Q0` has already been deleted and removed from the projection.

Implementation checkouts: `/home/gil/Repositories/pubky/pubky-app-eventky` and `/home/gil/Repositories/pubky/pubky-nexus-eventky-vps`. Original user checkouts remain separate. Historical full-suite counts do not cover the final worktree; exact current evidence belongs in [verification](verification.md).
