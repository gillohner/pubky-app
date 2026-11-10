import { describe, expect, it } from 'vitest';
import { type AttendanceSource, parseAttendance, resolveAttendance } from './attendance';

const author = 'y'.repeat(52);
const eventUri = `pubky://${'b'.repeat(52)}/pub/pubky.app/posts/0000000000001`;
const recurrence = { type: 'date' as const, value: '2026-10-05' };
const body = {
  schema: 'eventky.attendance',
  schema_version: 1,
  event_uid: 'event-1',
  partstat: 'ACCEPTED',
  dtstamp: '2026-09-09T12:00:00Z',
};
function source(id: string, patch = {}, extra: Partial<AttendanceSource> = {}): AttendanceSource {
  return {
    id,
    author,
    uri: `pubky://${author}/pub/pubky.app/posts/${id}`,
    parent: eventUri,
    kind: 'attendance',
    content: JSON.stringify({ ...body, ...patch }),
    ...extra,
  };
}
describe('native attendance contract', () => {
  it('validates exact versions, statuses and bounded content', () => {
    expect(parseAttendance(JSON.stringify(body))?.partstat).toBe('ACCEPTED');
    for (const patch of [
      { schema_version: 2 },
      { partstat: 'OWNER' },
      { attendee: 'someone-else' },
      { dtstamp: 'not-a-date' },
    ])
      expect(parseAttendance(JSON.stringify({ ...body, ...patch }))).toBeNull();
    expect(parseAttendance('x'.repeat(8193))).toBeNull();
  });
  it('binds responses to source author, parent and event UID', () => {
    const good = source('0000000000001');
    const replies = [
      good,
      source('0000000000002', {}, { author: 'b'.repeat(52) }),
      source('0000000000003', {}, { parent: 'other' }),
      source('0000000000004', { event_uid: 'other' }),
    ];
    expect([...resolveAttendance(replies, eventUri, 'event-1').keys()]).toEqual([author]);
    expect(resolveAttendance(replies, eventUri, 'event-1').get(author)?.source.id).toBe(good.id);
  });
  it('uses newest native identity, not an attacker-controlled future timestamp', () => {
    const old = source('0000000000001', { dtstamp: '2999-01-01T00:00:00Z' });
    const recent = source('0000000000002', { partstat: 'DECLINED' });
    expect(resolveAttendance([recent, old], eventUri, 'event-1').get(author)?.response.partstat).toBe('DECLINED');
  });
  it('lets occurrence responses override series responses without leaking to another date', () => {
    const replies = [
      source('0000000000001', { recurrence_id: recurrence, partstat: 'TENTATIVE' }),
      source('0000000000002'),
    ];
    expect(resolveAttendance(replies, eventUri, 'event-1', recurrence).get(author)?.response.partstat).toBe(
      'TENTATIVE',
    );
    expect(
      resolveAttendance(replies, eventUri, 'event-1', { ...recurrence, value: '2026-10-06' }).get(author)?.response
        .partstat,
    ).toBe('ACCEPTED');
    expect(resolveAttendance(replies, eventUri, 'event-1').get(author)?.response.partstat).toBe('ACCEPTED');
  });
});
