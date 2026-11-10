import { z } from 'zod';
import { calendarTimeSchema, postUriSchema } from './schema';
import { occurrenceKey } from './temporal';
import type { CalendarTime } from './types';

/** An author-owned native reply, following RFC 5545 PARTSTAT values. The envelope parent identifies the event. */
export const attendanceSchema = z.strictObject({
  schema: z.literal('eventky.attendance'),
  schema_version: z.literal(1),
  event_uid: z.string().min(1).max(1024),
  partstat: z.enum(['ACCEPTED', 'TENTATIVE', 'DECLINED']),
  dtstamp: z.iso.datetime(),
  recurrence_id: calendarTimeSchema.optional(),
});
export type AttendanceContent = z.infer<typeof attendanceSchema>;
export type AttendanceStatus = AttendanceContent['partstat'];
export const attendanceLabels: Record<AttendanceStatus, string> = {
  ACCEPTED: 'Going',
  TENTATIVE: 'Maybe',
  DECLINED: "Can't go",
};
export function parseAttendance(content: string): AttendanceContent | null {
  if (content.length > 8192) return null;
  try {
    const result = attendanceSchema.safeParse(JSON.parse(content));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
export type AttendanceSource = {
  id: string;
  author: string;
  uri: string;
  parent?: string | null;
  kind: string;
  content: string;
};

/** Only the authenticated source author can speak for themselves. Occurrence replies override series replies.
 * Latest native post identity wins within a scope; a supplied DTSTAMP never changes ordering.
 * Input must include every available reply before the caller presents definitive counts.
 */
export function resolveAttendance(
  sources: AttendanceSource[],
  eventUri: string,
  eventUid: string,
  recurrenceId?: CalendarTime,
) {
  const series = new Map<string, { source: AttendanceSource; response: AttendanceContent }>();
  const instances = new Map<string, { source: AttendanceSource; response: AttendanceContent }>();
  for (const source of sources) {
    if (
      source.kind !== 'attendance' ||
      !postUriSchema.safeParse(source.uri).success ||
      source.parent !== eventUri ||
      source.uri !== `pubky://${source.author}/pub/pubky.app/posts/${source.id}`
    )
      continue;
    const response = parseAttendance(source.content);
    if (!response || response.event_uid !== eventUid) continue;
    if (
      response.recurrence_id &&
      (!recurrenceId || occurrenceKey(response.recurrence_id) !== occurrenceKey(recurrenceId))
    )
      continue;
    const target = response.recurrence_id ? instances : series;
    const previous = target.get(source.author);
    if (!previous || source.id > previous.source.id) target.set(source.author, { source, response });
  }
  return new Map([...series, ...instances]);
}
