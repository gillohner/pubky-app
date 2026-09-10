import type { CalendarTime } from '@eventky/types';

export interface OccurrenceQuery {
  from: string;
  to: string;
  timezone: string;
  calendars?: string[];
  author?: string;
  include_cancelled?: boolean;
  limit?: number;
  cursor?: string;
}

export interface ProjectedOccurrence {
  post_uri: string;
  post_id: string;
  recurrence_id: CalendarTime;
  occurrence_key: string;
  start: CalendarTime;
  end: CalendarTime;
  start_epoch_ms: number;
  end_epoch_ms: number;
  status: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  source_hash: string;
}

export interface ProjectionCoverage {
  complete: boolean;
  reasons: string[];
  scope: 'configured-nexus' | 'explicit-fixtures';
  last_reconciled_at: string | null;
  source_checkpoint: string | null;
  pending_changes: number;
}

export interface ProjectionStatus {
  backend_id: string;
  projection_revision: number;
  engine_version: string;
  sources: number;
  invalid_sources: number;
  unavailable_sources: number;
  coverage: ProjectionCoverage;
}

export interface OccurrencePage {
  items: ProjectedOccurrence[];
  next_cursor: string | null;
  projection_revision: number;
  coverage: ProjectionCoverage;
}

export type ProjectionErrorCode = 'INVALID_QUERY' | 'STALE_CURSOR' | 'NOT_READY' | 'UNAVAILABLE';
export type ProjectionResult<T> = { ok: true; value: T } | { ok: false; code: ProjectionErrorCode; message: string };
