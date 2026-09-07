import type { TagCollectionModelSchema } from './tag.schema';

/** Legacy collections use their loaded length until server pagination metadata exists. */
export function getTagCursor(record: TagCollectionModelSchema<unknown> | null | undefined): number {
  return record?.cache?.cursor ?? record?.tags.length ?? 0;
}
