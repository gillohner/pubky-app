import type { CalendarContent, EventContent } from './types';

// Generated through Pubky Keypair.random(); secrets were discarded and these identities have no records.
export const FIXTURE_OWNER = 'mbp74i3fcjnxs8tmers1m6mnmps74bauc96wiye5c7jgbduray4o';
export const FIXTURE_CONTRIBUTOR = 'bftq4uj73fwo5m9myerj8bhftfjjittukdje7qb7n1d6wddy33py';
export const FIXTURE_CALENDAR_URI = `pubky://${FIXTURE_OWNER}/pub/pubky.app/posts/0034A0X7NJ52A`;
export const FIXTURE_EVENT_URI = `pubky://${FIXTURE_CONTRIBUTOR}/pub/pubky.app/posts/0034A0X7NJ52B`;

export const CALENDAR_FIXTURE: CalendarContent = {
  schema: 'eventky.calendar',
  schema_version: 1,
  uid: 'urn:uuid:63a59806-5bf0-44f0-bf26-041f1d5a4a95',
  name: 'Pubky builders',
  timezone: 'Europe/Zurich',
  color: '#6757E8',
  contributors: [FIXTURE_CONTRIBUTOR],
  created: '2026-09-08T09:00:00Z',
  last_modified: '2026-09-08T09:00:00Z',
  sequence: 0,
};

export const EVENT_FIXTURE: EventContent = {
  schema: 'eventky.event',
  schema_version: 1,
  uid: 'urn:uuid:84194bcd-17a2-43ae-99b9-2212e8b791c8',
  summary: 'Pubky builders meetup',
  description: 'A native event with ordinary comments and tags.',
  dtstart: { type: 'zoned', value: '2026-10-01T18:00:00', tzid: 'Europe/Zurich' },
  duration: 'PT2H',
  dtstamp: '2026-09-08T09:00:00Z',
  created: '2026-09-08T09:00:00Z',
  last_modified: '2026-09-08T09:00:00Z',
  sequence: 0,
  status: 'CONFIRMED',
  rrule: 'FREQ=WEEKLY;BYDAY=TH;COUNT=6',
  calendar_uris: [FIXTURE_CALENDAR_URI],
};
