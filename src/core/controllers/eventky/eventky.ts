import type { OccurrenceQuery } from '@eventky-api/types';
import { EventkyApplication } from '@/application/eventky/eventky';

export class EventkyController {
  static fetchOccurrences(query: OccurrenceQuery, signal?: AbortSignal) {
    return EventkyApplication.fetchOccurrences(query, signal);
  }
}
