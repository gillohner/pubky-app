import { postUriSchema } from '@eventky/contract';
import { calendarTimeSchema } from '@eventky/schema';
import { z } from 'zod';

export const coverageSchema = z.object({
  complete: z.boolean(),
  reasons: z.array(z.string().max(128)).max(64),
  scope: z.enum(['configured-nexus', 'explicit-fixtures']),
  last_reconciled_at: z.string().max(64).nullable(),
  source_checkpoint: z.string().max(8192).nullable(),
  pending_changes: z.number().int().nonnegative(),
});
export const occurrenceSchema = z
  .object({
    post_uri: postUriSchema,
    post_id: z.string().max(100),
    recurrence_id: calendarTimeSchema,
    occurrence_key: z.string().max(512),
    start: calendarTimeSchema,
    end: calendarTimeSchema,
    start_epoch_ms: z.number().finite(),
    end_epoch_ms: z.number().finite(),
    status: z.enum(['CONFIRMED', 'TENTATIVE', 'CANCELLED']),
    source_hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .refine(
    (value) => value.post_id === `${value.post_uri.split('/')[2]}:${value.post_uri.split('/').at(-1)}`,
    'Mismatched post identity.',
  );
export const occurrencePageSchema = z.object({
  items: z.array(occurrenceSchema).max(200),
  next_cursor: z.string().max(2048).nullable(),
  projection_revision: z.number().int().nonnegative(),
  coverage: coverageSchema,
});
export const projectionStatusSchema = z.object({
  backend_id: z.string().max(2048),
  projection_revision: z.number().int().nonnegative(),
  engine_version: z.string().max(255),
  sources: z.number().int().nonnegative(),
  invalid_sources: z.number().int().nonnegative(),
  unavailable_sources: z.number().int().nonnegative(),
  coverage: coverageSchema,
});
export const projectionFailureSchema = z.object({
  ok: z.literal(false),
  code: z.enum(['INVALID_QUERY', 'STALE_CURSOR', 'NOT_READY', 'UNAVAILABLE']),
  message: z.string().max(1000),
});
export const occurrenceResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: occurrencePageSchema }),
  projectionFailureSchema,
]);
export const statusResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: projectionStatusSchema }),
  projectionFailureSchema,
]);
