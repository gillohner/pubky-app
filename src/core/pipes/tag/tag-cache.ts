import type { TagCollectionModelSchema } from '@/models/shared/tag/tag.schema';
import type { NexusTag } from '@/services/nexus/nexus.types';

/** Reconcile a server window with local intent; absence from a full window removes old labels. */
export function reconcileTagWindow(
  incoming: NexusTag[],
  existing: TagCollectionModelSchema<string> | undefined,
  now: number,
  viewerId?: string,
) {
  const tags = new Map(incoming.map((tag) => [tag.label.toLowerCase(), tag]));
  const mutations: NonNullable<TagCollectionModelSchema<string>['mutations']> = {};
  for (const [label, mutation] of Object.entries(existing?.mutations ?? {})) {
    if (mutation.expiresAt <= now) continue;
    mutations[label] = mutation;
    if (mutation.viewerId !== viewerId) continue;
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

/** Keep counters consistent with local intent even when a preview omits the edited label. */
export function reconcileTagCounts(
  incoming: { tags: number; unique_tags: number },
  preview: NexusTag[],
  existing: TagCollectionModelSchema<string> | undefined,
  previous: { tags: number; unique_tags: number } | undefined,
  viewerId: string | undefined,
  now: number,
) {
  let tags = incoming.tags;
  let unique = incoming.unique_tags;
  const activeMutations = Object.entries(existing?.mutations ?? {}).filter(([, mutation]) => mutation.expiresAt > now);
  for (const [label, mutation] of activeMutations) {
    const remote = preview.find((tag) => tag.label.toLowerCase() === label);
    // A truncated preview (or another viewer's relationships) cannot acknowledge this edit.
    // Preserve optimistic totals only within what the fresh totals and active edits allow.
    // Otherwise an old low total could suppress pagination even after the server list grows.
    if (mutation.viewerId !== viewerId || (!remote && incoming.unique_tags > preview.length)) {
      if (!previous) return incoming;
      const additions = activeMutations.filter(([, intent]) => intent.relationship).length;
      const removals = activeMutations.length - additions;
      const bound = (total: number, previousTotal: number) =>
        Math.max(0, total - removals, Math.min(previousTotal, total + additions));
      return {
        tags: bound(incoming.tags, previous.tags),
        unique_tags: bound(incoming.unique_tags, previous.unique_tags),
      };
    }
    const delta = Number(mutation.relationship) - Number(remote?.relationship ?? false);
    tags += delta;
    unique += Number((remote?.taggers_count ?? 0) + delta > 0) - Number(!!remote);
  }
  return { tags: Math.max(0, tags), unique_tags: Math.max(0, unique) };
}
