# Eventky post-content contract

Pure TypeScript helpers for `PubkyAppPost` kinds `event` and `calendar`. Content is a versioned JSON **string** at the normal `/pub/pubky.app/posts/` path. This application JSON is not JSCalendar. The caller owns the outer post envelope, attachments, publication, authentication and moderation.

Public imports are concrete `@eventky/contract`, `@eventky/temporal`, `@eventky/recurrence`, `@eventky/ical` and `@eventky/migration`. Fallible helpers return `{ ok: true, value } | { ok: false, issues: string[] }`; parsers and preview functions return their documented discriminated report types. Builders require caller-supplied UID and UTC `now`; updates preserve identity/creation and advance sequence and modification timestamps. No helper fetches URLs, writes records, sends mail or schedules alarms.

`social: { version: 1, text }` is optional on network reads. Create/update/serialization derive it from title and human description only, bounded to `MAX_SOCIAL_TEXT_BYTES = 68 * 1024` UTF-8 bytes. Arbitrary kind strings remain unchanged; unsupported versions are distinguished from malformed known content.

## Temporal and recurrence behavior

The explicit date/UTC/zoned/floating union preserves original recurrence identities. DATE ends are exclusive. Missing DATE end means one day; missing timed end means a point event. DTSTART/DTEND preserves exact elapsed duration across repetitions, while DURATION adds nominal days/weeks before exact hours/minutes/seconds. A computed end in the second repeated hour uses UTC because an RFC local date-time selects the first occurrence of that hour.

`expandOccurrences(event, query)` returns `complete`, `incomplete`, `unsupported` or `invalid`; callers must expose incomplete coverage. Queries span at most 93 days. Limits bound candidates, iterations and returned occurrences. AbortSignal cancellation is checked between recurrence steps; callers should run expansion in a worker with an independent termination deadline.

The active engine uses pinned ical.js recurrence generation and Temporal for IANA conversions. Tested expansion supports DAILY/WEEKLY weekday filters, MONTHLY weekday/month-day/set-position filters, and YEARLY weekday/month/month-day/set-position filters. Other valid RRULE parts and subdaily frequencies remain stored but return `unsupported`. DTSTART must match the RRULE. RDATE periods, EXDATE precedence, moved/cancelled instance patches, COUNT, inclusive UNTIL, DST gaps and folds are covered. `RANGE=THISANDFUTURE` is not supported; splitting future series needs a separate explicit operation. `resolveOccurrenceEvent` resolves a known identity but does not independently prove that identity belongs to the recurrence set.

Per-event VTIMEZONE definitions take precedence over an identically named IANA zone and never enter a global registry. Fixed offsets (including seconds), DTSTART, multiple RDATE values, and productive yearly single-month observance rules are supported. Annual rules support a single month-day or an ordinal weekday from first through fourth/last through fourth-last, COUNT or UTC UNTIL. Unsupported observance combinations fail explicitly. Definition limits are 64 KiB, 64 observances, 20,000 transition work steps and calendar years 1–9997. Imported explicit gaps use the pre-gap offset; generated RRULE gaps are skipped without consuming COUNT. Authoring rejects ambiguous or nonexistent local times.

## Interchange and migration

`exportEventIcs` and `exportCalendarIcs` generate CRLF iCalendar with UTF-8-safe 75-octet folding, same-UID VEVENT exceptions, source post references, and needed VTIMEZONE definitions. Downloads omit scheduling METHOD. Calendar export rejects duplicate UIDs, conflicting timezone definitions, unsafe line breaks and limits instead of silently dropping events. Event export verifies bundled timezone data against explicit IANA event times; an unsupported historical definition requires accurate supplied data. Bundled data cannot guarantee that governments will not change future timezone rules.

`importCalendarIcs` produces a dry-run report, with source/UID/ownership conflict suggestions and exact-content fingerprints. **Any report or entry errors block publication.** Acknowledgement items require an explicit user decision. Private/confidential classification is flagged; attendees and email alarms are omitted. Unsupported rich descriptions, attachment references, structured subcomponents and alarm semantics remain inert extension metadata and are not automatically activated or re-emitted by exports. Unknown ordinary properties/parameters roundtrip subject to bounded metadata. Imported reminders never create local notification permission or jobs. This is an explicit import profile, not a claim of arbitrary lossless RFC component roundtripping.

`prepareLegacyMigration` accepts owner records plus a preallocated old-to-normal-post URI map. It converts microseconds exactly, preserves UIDs/revisions and explicit temporal modes, groups exceptions into their master social post, rewrites calendar references and retains provenance links. It never deletes old data or grants cross-account permissions. Missing mappings, unowned sources, ambiguous times, unsupported HTML and orphan/duplicate series require review. Callers persist a resumable manifest, publish calendars first, then events and attachments through native post APIs.

## Checks

Run `npx vitest run --config packages/eventky-contract/vitest.config.ts`. Fixtures cover DST, recurrence, custom zones, schema limits, social bytes, RFC import/export, malformed input and legacy migration. The package has no shared configuration edits or independent runtime installation step.
