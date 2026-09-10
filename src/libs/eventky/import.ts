import { eventContentSchema } from '@eventky/schema';
import type { EventContent } from '@eventky/types';

/** Generated fallback timestamps do not turn a repeated file into a content update. */
export function importFingerprint(event: EventContent): string {
  const source: Record<string, unknown> = { ...event };
  delete source.created;
  delete source.dtstamp;
  delete source.last_modified;
  delete source.social;
  return JSON.stringify(source);
}

export const importRecordKey = (scope: string, source: string, kind: string, uid: string) =>
  JSON.stringify([scope, source, kind, uid]);
export const importPostUri = (postId: string) => `pubky://${postId.replace(':', '/pub/pubky.app/posts/')}`;

/** Imported snapshots replace optional fields; omitted properties must not inherit an older import. */
export function replaceImportedEvent(previous: EventContent, next: EventContent, now: string) {
  return eventContentSchema.safeParse({
    ...next,
    uid: previous.uid,
    created: previous.created,
    sequence: previous.sequence + 1,
    dtstamp: now,
    last_modified: now,
  });
}
