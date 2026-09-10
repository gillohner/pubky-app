# Eventky in Pubky App

Events and calendars are ordinary `PubkyAppPost` records at `/pub/pubky.app/posts/<id>`, using the exact kinds `event` and `calendar`. Their versioned JSON is serialized into the post's string `content`. Comments, tags, bookmarks, reposts, moderation, attachments and deletion use Pubky's existing post machinery.

The revised staging application is published at [https://159.69.22.174](https://159.69.22.174), using only the staging homeserver and isolated staging Nexus/projection. Frontend `staging-20260909e` is live and healthy. Backend `dce35bf7` is live with sticky primary-user indexing enabled; both staging users are indexed and the configured projection is complete. Live HTTP 429 handling paused for 60 seconds, then a successful request advanced the persisted global cursor to 25350. Historical catch-up continues; projection completeness covers configured Nexus sources, not all homeserver history. Owner authoring, all-day create/delete, guest contribution and owner exclusion/restoration have passed real staging checks. Grouped attendance and scope-specific reload checks also passed. Guest cleanup and clean captures remain pending; see [verification](verification.md).

## Native experience

Event and Calendar creation sit beside Article. The editor uses Pubky's Markdown, attachment and tag controls, ShadCN date popovers and styled time inputs. Events support all-day and timed schedules, an end or duration, recurrence presets/rules, individual occurrence moves/cancellations, physical/online locations, organizer details and named calendar membership. Authors can select a different event timezone; existing source time semantics survive editing.

Reading surfaces always use the device timezone. There is no display-timezone selector or saved timezone preference. Weeks start on Monday. The calendar page provides agenda, month, week and day views, named calendar selection and explicit incomplete/stale states. Occurrences hydrate ordinary posts and verify their source hash before display.

Calendars have names, descriptions, colors and contributor/exclusion policies. Native people and event pickers replace public-key and URI text entry. Calendar selection belongs to the current navigation state, with no local preference-management workflow. The native UI has no calendar import/export, subscription-link, alarm or reminder actions. Existing RFC interchange/protocol modules remain available internally; their presence does not make them part of this app experience.

Attendance uses ordinary `attendance` reply posts and Going, Maybe and Can't go controls. A compact avatar row opens a grouped current-attendee dialog. Series and occurrence-specific responses preserve native author identity; historical status replies stay out of event discussion. Read [attendance semantics and limits](attendance.md) and [device-timezone display](native-display.md).

## Run locally

```sh
npm ci
PUBKY_RUNTIME_EVENTKY_ENABLED=true PUBKY_RUNTIME_EVENTKY_CALENDAR_ENABLED=true npm run dev:webpack
```

Supply the app's required runtime network settings and server-only `EVENTKY_PROJECTION_URL` for the intended environment. Staging tests must use the staging homeserver and isolated staging Nexus, not production accounts or a production homeserver dataset. The projection receives no homeserver signing keys. See [deployment and recovery](deployment.md).

## Development records

- [Current decisions](decisions.md) and [task state](task-state.md) describe the revised requirements and worker handoffs.
- [Verification](verification.md) separates current checks, pending acceptance and historical baseline results.
- [Contract profile](../../packages/eventky-contract/README.md) documents supported RFC semantics, limits and unsupported cases.
- [Initial plan](plan.md) and [agent briefs](agent-briefs.md) are historical planning records; the current scope supersedes their import/reminder/preference work packages.
- Review branches remain [client PR #1](https://github.com/gillohner/pubky-app/pull/1) and [Nexus PR #15](https://github.com/gillohner/pubky-nexus/pull/15). Uncommitted revised-scope work and deployed images must be verified separately from those PR baselines.

The lead owns shared interfaces, integration and final evidence. Workers own bounded file sets and report exact tests and remaining gaps. A completed worker task does not establish completion of the complete staging journey.
