# Native event display

Reading surfaces display UTC and zoned event times in the device timezone. The conversion uses the shared calendar engine, including the event's own VTIMEZONE definitions; named source zones are never parsed by appending `Z`. A missing or unresolved zone shows an unavailable label instead of an invented instant. Timezone abbreviations describe displayed instants; there is no display-zone selector or saved timezone preference.

All-day dates remain civil dates and retain exclusive DTEND semantics. Floating times retain their civil wall time. Recurrence authoring is a distinct operation: its labels keep the source wall time and zone so selecting or moving an occurrence does not silently change its identity.

The native event renderer uses an automatic device-zone hook. Server rendering and the hydration snapshot use UTC consistently, then React updates to the actual device zone. Focus and visibility changes refresh the zone after device settings change. No preference is persisted.

Native event/calendar surfaces have no import, export, subscription-link, alarm or local calendar-preference actions. RFC interchange functions and backend ICS endpoints remain available as protocol capabilities; the native app does not expose them as competing calendar workflows.

Regression tests cover Zurich/New York DST differences, cross-date conversions in both directions, UTC, floating dates, unshifted all-day dates, a custom VTIMEZONE, unknown-zone failure, device-zone changes, native rendering and the absence of the event export action.
