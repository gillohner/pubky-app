import type { CalendarFeedRequest, CalendarFeedResponse } from '@eventky-api/feed';
import type { OccurrencePage, OccurrenceQuery, ProjectionResult } from '@eventky-api/types';
import type { ProjectionMetadata, StoredSource } from './types';

export const MAX_SNAPSHOT_SOURCES = 5000;
export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
export const MAX_WORK_RESULT_BYTES = 4 * 1024 * 1024 + 16384;

export type ProjectionSnapshot = {
  metadata: ProjectionMetadata;
  stats: { bytes: number; total: number; invalid: number; unavailable: number };
  pending: number;
  lastModified: string | null;
  sources: StoredSource[] | null;
  cursorKey: string;
};
export type ProjectionWork =
  | { operation: 'query'; query: OccurrenceQuery }
  | { operation: 'subscription'; calendarUri: string; request: CalendarFeedRequest };
export type ProjectionWorkOutput =
  | { operation: 'query'; result: ProjectionResult<OccurrencePage> }
  | { operation: 'subscription'; result: CalendarFeedResponse };
export type WorkOutcome =
  | { ok: true; value: ProjectionWorkOutput }
  | { ok: false; reason: 'overloaded' | 'timeout' | 'cancelled' | 'unavailable' | 'stale' };
export type WorkerInput = { snapshot: ProjectionSnapshot; work: ProjectionWork; heapMb: number };
