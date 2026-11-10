import { postUriSchema } from '@eventky/contract';
import { isSupportedTimeZone } from '@eventky/temporal';
import { z } from 'zod';

export const calendarFiltersSchema = z.object({
  timezone: z.string().refine(isSupportedTimeZone, 'Choose a supported timezone, such as Europe/Zurich.'),
  calendarUri: z.union([z.literal(''), postUriSchema]),
});
export type CalendarFilters = z.infer<typeof calendarFiltersSchema>;
