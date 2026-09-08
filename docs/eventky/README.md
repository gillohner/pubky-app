# Eventky in Pubky App

Review: [client PR #1](https://github.com/gillohner/pubky-app/pull/1) and [optional Nexus extension PR #15](https://github.com/gillohner/pubky-nexus/pull/15).

Events and calendars are ordinary `PubkyAppPost` records at `/pub/pubky.app/posts/<id>`, using the exact custom kinds `event` and `calendar`. The versioned JSON profile is serialized into the post's string `content`. Comments, tags, bookmarks, reposts, moderation, attachments and deletion use the existing Pubky post machinery.

The event button appears beside Article in post creation. The native editor supports timed/all-day events, UTC/named/floating time, end or duration, recurrence presets and rules, individual occurrence changes, physical/online locations, Markdown, attachments, categories, organizer information and calendar membership. Calendars are posts with their own descriptions, colors, timezone, contributors and exclusions. Their owner's policy decides which claimed events appear in a calendar.

The calendar page offers agenda/month/week/day views and overlays, with explicit incomplete/stale states. It hydrates ordinary posts and verifies the exact source hash before applying an occurrence's display context. Local subscriptions and app-open reminders are scoped to the account and Nexus backend. Published alarm suggestions never activate a reminder automatically.

iCalendar import previews public/private source mismatches and retained metadata before publication. A durable local ledger reserves post IDs before writes, confirms uncertain responses against the authoritative homeserver, and protects subsequent manual edits. Imports retain series UID and original exception identities. A public read-only subscription feed provides complete current-calendar masters and exceptions with HTTP validators; it fails closed when coverage or resource limits prevent a complete result.

## Enable locally

```sh
npm ci
PUBKY_RUNTIME_EVENTKY_ENABLED=true npm run dev:webpack
```

Point the app's normal runtime network settings at a Nexus with universal post kinds (PR #14 or its compatible extension). The calendar query UI additionally needs `PUBKY_RUNTIME_EVENTKY_CALENDAR_ENABLED=true`, a server-only `EVENTKY_PROJECTION_URL`, and the optional sidecar. See [deployment and recovery](deployment.md) for complete configuration and resource requirements. These flags are off by default.

## Development records

- [Implementation plan](plan.md) and [subagent work packages](agent-briefs.md): full feature scope, dependencies, acceptance gates and further work.
- [Current decisions](decisions.md) and [task state](task-state.md): authoritative interface updates and coordination handoff. These supersede historical baseline observations in the plan.
- [Content profile and supported RFC semantics](../../packages/eventky-contract/README.md): exact schemas, limits, recurrence, timezone and interoperability behavior.
- [Subscription policy](../../services/eventky-projection/SUBSCRIPTIONS.md): completeness, membership and HTTP caching rules.
- [Verification evidence](verification.md): what was actually tested and any open release gates.

The calendar projection is derived data and receives no authoring commands or homeserver signing keys. Its optional Nexus extension supplies generic source revisions and explicit social text for mention handling; production Nexus has no Eventky event/calendar parser. The original Eventky namespace is only an import/migration input.

## Coordination pattern

The lead owns shared interfaces and integration. Workers receive a bounded file set, a baseline commit, the relevant contract and acceptance checks. They report evidence and interface changes into the shared task record, then send a handoff before another worker edits that boundary. Fresh reviews verify suspected bugs with fixtures before changes are accepted. The lead reruns checks across boundaries and distinguishes a worker's completion from end-to-end delivery.

This makes context explicit through committed artifacts rather than depending on agents automatically sharing their entire conversations. The same workflow can be resumed by another coding agent using this directory, the repository's AGENTS.md, and the recorded feature branches.
