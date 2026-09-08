import { occurrenceResponseSchema } from '@eventky-api/schema';
import type { OccurrencePage, OccurrenceQuery, ProjectionResult } from '@eventky-api/types';

export class EventkyService {
  /** The optional projection API reports expected availability/query failures as a Result. */
  static async fetchOccurrences(
    query: OccurrenceQuery,
    signal?: AbortSignal,
  ): Promise<ProjectionResult<OccurrencePage>> {
    const params = new URLSearchParams({ from: query.from, to: query.to, timezone: query.timezone });
    for (const calendar of query.calendars ?? []) params.append('calendar', calendar);
    if (query.author) params.set('author', query.author);
    if (query.cursor) params.set('cursor', query.cursor);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.include_cancelled !== undefined) params.set('include_cancelled', String(query.include_cancelled));
    try {
      const response = await fetch(`/api/eventky/occurrences?${params}`, { signal, cache: 'no-store' });
      const parsed = occurrenceResponseSchema.safeParse(await response.json());
      if (parsed.success && (response.ok || !parsed.data.ok)) return parsed.data;
    } catch {
      // Network/aborted requests have no trustworthy response body to surface.
    }
    return { ok: false, code: 'UNAVAILABLE', message: 'Calendar results are unavailable.' };
  }
}
