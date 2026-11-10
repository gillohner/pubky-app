# Eventky in Pubky App

Eventky adds events, calendars and RSVPs to Pubky App without introducing new record types. Every Eventky object is an ordinary `PubkyAppPost` at `/pub/pubky.app/posts/<id>`; only the post `kind` and the JSON serialized into the string `content` differ. Comments, tags, bookmarks, reposts, attachments, moderation and deletion use the existing post machinery, and clients that do not know these kinds still see valid posts.

## Data model

| Post `kind`  | `content` schema     | Envelope fields used                                         |
| ------------ | -------------------- | ------------------------------------------------------------ |
| `event`      | `eventky.event`      | `attachments`; `content.calendar_uris` lists calendar posts  |
| `calendar`   | `eventky.calendar`   | none beyond `kind`/`content`                                 |
| `attendance` | `eventky.attendance` | `parent` = the event post URI (a normal reply)               |

Every payload carries `schema` and `schema_version: 1`. The schemas live in [`packages/eventky-contract`](../../packages/eventky-contract/README.md) and are validated on both write and read.

- **Event**: `uid`, `title`, `dtstart` (all-day date, floating time, UTC or IANA zone time), `dtend` or `duration`, optional `rrule`/`rdate`/`exdate`, per-occurrence `overrides`, `status` (`TENTATIVE`/`CONFIRMED`/`CANCELLED`), `locations`, `organizer`/`contact`, `calendar_uris`, bounded `extensions`, and an optional `social.text` mirror for text-only clients.
- **Calendar**: `uid`, `name`, `description`, `color`, `contributors` (public keys allowed to add events), `excluded_event_uris`, `week_start`, `extensions`, `social`.
- **Attendance**: `event_uid`, RFC 5545 `partstat` (`ACCEPTED`/`TENTATIVE`/`DECLINED`), `dtstamp`, optional `recurrence_id`. See [attendance.md](attendance.md).

Calendar membership is declared by the event (`calendar_uris`) and accepted by the calendar (author match or `contributors`, minus `excluded_event_uris`), so neither side can unilaterally place a post in someone else's calendar.

## User experience

Event and Calendar creation sit beside Article in the composer and reuse Pubky's Markdown, attachment and tag controls. Events support all-day and timed schedules, an end or duration, recurrence presets and raw rules, individual occurrence moves or cancellations, physical and online locations, organizer details and named calendar membership. Authors may pick an event timezone; reading surfaces always use the device timezone ([native-display.md](native-display.md)).

The `/calendar` page offers agenda, month, week and day views, named calendar selection and explicit incomplete/stale states. Occurrences come from the projection sidecar (below) and hydrate ordinary posts, verifying the source hash before display. Event posts render natively in feeds and on their post page, with Going/Maybe/Can't go controls and a grouped attendee dialog.

There is no import/export, subscription, alarm or preference UI in this revision. The contract package's iCalendar code is used only by the sidecar's `.ics` feed and by tests.

## Architecture

```
browser ──writes──▶ homeserver ──▶ Nexus (fork: custom kinds + projection API)
   │                                   │
   │  reads posts/streams (Nexus)      │ /v0/projection/posts/* (bearer token, private network)
   │                                   ▼
   └── /api/eventky/* ──▶ services/eventky-projection (SQLite) ── occurrences, status, calendar.ics
```

- The Nexus fork ([PR #14](https://github.com/gillohner/pubky-nexus/pull/14), [PR #15](https://github.com/gillohner/pubky-nexus/pull/15)) accepts arbitrary custom `kind` strings, indexes `parent`/`embed` for any kind, and exposes a private replication API for post revisions.
- `services/eventky-projection` replicates event/calendar posts from that API, expands recurrences and serves `/v1/occurrences`, `/v1/status`, `/v1/calendar.ics`. It never holds signing keys and is read-only with respect to homeservers.
- Next.js routes under `src/app/api/eventky/` proxy the sidecar through the server-only `EVENTKY_PROJECTION_URL`, so browsers only talk to the app origin and Nexus.

The calendar page requires the sidecar. Event posts and RSVPs work without it.

## Run locally

```sh
npm ci
PUBKY_RUNTIME_EVENTKY_ENABLED=true PUBKY_RUNTIME_EVENTKY_CALENDAR_ENABLED=true npm run dev:webpack
```

Point the usual `PUBKY_RUNTIME_*` settings at a homeserver and a Nexus that runs the fork, and set `EVENTKY_PROJECTION_URL` if you want the calendar page. Use the staging homeserver and test keys only. See [deployment.md](deployment.md) for the server side.

## Tests

```sh
npm run typecheck && npm run lint && npm test
npx vitest run --config packages/eventky-contract/vitest.config.ts
npx vitest run --config services/eventky-projection/vitest.config.mts
```
