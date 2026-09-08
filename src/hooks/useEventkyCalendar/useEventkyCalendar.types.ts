import type { EventContent } from '@eventky/contract';
import type { ProjectedOccurrence } from '@eventky-api/types';

export interface CalendarOccurrence {
  projection: ProjectedOccurrence;
  event: EventContent;
  sourceContent: string;
}
