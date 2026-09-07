import type { TagCollectionModelSchema } from '@/models/shared/tag/tag.schema';
import type { NexusTag } from '@/services/nexus/nexus.types';

/** Reconcile a server window with local intent; absence from a full window removes old labels. */
export function reconcileTagWindow(
  incoming: NexusTag[],
  existing: TagCollectionModelSchema<string> | undefined,
  now: number,
) {
  const tags = new Map(incoming.map((tag) => [tag.label.toLowerCase(), tag]));
  const mutations: NonNullable<TagCollectionModelSchema<string>['mutations']> = {};
  for (const [label, mutation] of Object.entries(existing?.mutations ?? {})) {
    if (mutation.expiresAt <= now) continue;
    mutations[label] = mutation;
    const tag = tags.get(label);
    if (!tag) {
      const local = existing?.tags.find((t) => t.label.toLowerCase() === label);
      if (mutation.relationship && local) tags.set(label, local);
      continue;
    }
    const count = Math.max(0, tag.taggers_count + Number(mutation.relationship) - Number(tag.relationship));
    if (!count) {
      tags.delete(label);
      continue;
    }
    const taggers = tag.taggers.filter((tagger) => tagger !== mutation.viewerId);
    if (mutation.relationship) taggers.push(mutation.viewerId);
    tags.set(label, { ...tag, taggers, taggers_count: count, relationship: mutation.relationship });
  }
  return { tags: [...tags.values()], mutations };
}
