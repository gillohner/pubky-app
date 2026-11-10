import { occurrenceKey } from '@eventky/temporal';
import type { OccurrencePage, ProjectedOccurrence } from '@eventky-api/types';
import { eventkyEventFixture } from './eventky';

export const projectionPostId = `${'y'.repeat(52)}:0000000000001`;
export const projectionPostUri = `pubky://${'y'.repeat(52)}/pub/pubky.app/posts/0000000000001`;
export const projectionHash = 'a'.repeat(64);
export const projectedOccurrenceFixture: ProjectedOccurrence = {
  post_id: projectionPostId,
  post_uri: projectionPostUri,
  recurrence_id: eventkyEventFixture.dtstart,
  occurrence_key: occurrenceKey(eventkyEventFixture.dtstart),
  start: eventkyEventFixture.dtstart,
  end: eventkyEventFixture.dtend!,
  start_epoch_ms: Date.parse('2026-10-25T17:30:00Z'),
  end_epoch_ms: Date.parse('2026-10-25T19:30:00Z'),
  status: 'CONFIRMED',
  source_hash: projectionHash,
};

export function occurrencePageFixture(items: ProjectedOccurrence[] = [projectedOccurrenceFixture]): OccurrencePage {
  return {
    items,
    next_cursor: null,
    projection_revision: 4,
    coverage: {
      complete: true,
      reasons: [],
      scope: 'configured-nexus',
      last_reconciled_at: '2026-10-01T00:00:00Z',
      source_checkpoint: 'checkpoint',
      pending_changes: 0,
    },
  };
}
