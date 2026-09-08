import type { OccurrencePage, ProjectionResult, ProjectionStatus } from '@eventky-api/types';
import { EventkyProxyService } from '@/services/eventky-proxy/eventky-proxy';

export class EventkyProxyApplication {
  static async occurrences(query: string): Promise<ProjectionResult<OccurrencePage>> {
    try {
      return await EventkyProxyService.occurrences(query);
    } catch {
      return {
        ok: false,
        code: 'UNAVAILABLE',
        message: 'Calendar data is temporarily unavailable. Your event posts remain accessible.',
      };
    }
  }
  static async status(): Promise<ProjectionResult<ProjectionStatus>> {
    try {
      return await EventkyProxyService.status();
    } catch {
      return { ok: false, code: 'UNAVAILABLE', message: 'Calendar data is temporarily unavailable.' };
    }
  }
}
