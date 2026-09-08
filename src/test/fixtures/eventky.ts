import type { CalendarContent, EventContent } from '@eventky/contract';

export const eventkyEventFixture: EventContent = {
  schema: 'eventky.event',
  schema_version: 1,
  uid: 'event-2026',
  created: '2026-09-08T10:00:00Z',
  last_modified: '2026-09-08T10:00:00Z',
  dtstamp: '2026-09-08T10:00:00Z',
  sequence: 0,
  summary: 'Pubky community meetup',
  dtstart: { type: 'zoned', value: '2026-10-25T18:30:00', tzid: 'Europe/Zurich' },
  dtend: { type: 'zoned', value: '2026-10-25T20:30:00', tzid: 'Europe/Zurich' },
  description: 'Discuss decentralized calendars.',
  status: 'CONFIRMED',
};

export const eventkyCalendarFixture: CalendarContent = {
  schema: 'eventky.calendar',
  schema_version: 1,
  uid: 'calendar-2026',
  created: '2026-09-08T10:00:00Z',
  last_modified: '2026-09-08T10:00:00Z',
  sequence: 0,
  name: 'Pubky gatherings',
  timezone: 'Europe/Zurich',
  color: '#8866ff',
  description: 'Community events around the world.',
};
