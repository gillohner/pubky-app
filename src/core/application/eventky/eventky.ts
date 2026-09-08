import type { OccurrencePage, OccurrenceQuery, ProjectionResult } from '@eventky-api/types';
import { EventkyService } from '@/services/eventky/eventky';

export class EventkyApplication {
  /** Bound pagination and preserve the projection revision across a calendar query. */
  static async fetchOccurrences(
    query: OccurrenceQuery,
    signal?: AbortSignal,
  ): Promise<ProjectionResult<OccurrencePage>> {
    let page: OccurrencePage | undefined;
    const seen = new Set<string>();
    for (let index = 0; index < 10; index++) {
      const result = await EventkyService.fetchOccurrences(
        { ...query, limit: 100, cursor: page?.next_cursor ?? undefined },
        signal,
      );
      if (!result.ok) return result;
      if (page && page.projection_revision !== result.value.projection_revision)
        return { ok: false, code: 'STALE_CURSOR', message: 'Calendar results changed. Refresh to continue.' };
      const next = result.value;
      const items = next.items.filter((item) => {
        const key = `${item.post_uri}\0${item.occurrence_key}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      page = {
        ...next,
        items: [...(page?.items ?? []), ...items],
        coverage: {
          ...next.coverage,
          complete: next.coverage.complete && (page?.coverage.complete ?? true),
          reasons: [...new Set([...(page?.coverage.reasons ?? []), ...next.coverage.reasons])],
        },
      };
      if (!page.next_cursor) return { ok: true, value: page };
    }
    return {
      ok: true,
      value: {
        ...page!,
        coverage: {
          ...page!.coverage,
          complete: false,
          reasons: [...page!.coverage.reasons, 'Result limit reached. Narrow the date range.'],
        },
      },
    };
  }
}
