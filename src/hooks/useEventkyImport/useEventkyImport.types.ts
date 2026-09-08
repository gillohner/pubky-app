import { z } from 'zod';

export const eventkyImportSchema = z.object({
  source: z.string().trim().min(1, 'Name this import source.').max(100, 'Use at most 100 characters.'),
  calendarName: z.string().trim().min(1, 'Name the calendar.').max(100, 'Use at most 100 characters.'),
  createCalendar: z.boolean(),
  publicAcknowledged: z.boolean(),
  missingAcknowledged: z.boolean(),
  selected: z.array(z.string()).max(500),
  acknowledged: z.array(z.string()).max(500),
  approvedUpdates: z.array(z.string()).max(500),
});
export type EventkyImportForm = z.infer<typeof eventkyImportSchema>;
export const EVENTKY_IMPORT_DEFAULTS: EventkyImportForm = {
  source: 'Calendar import',
  calendarName: 'Imported calendar',
  createCalendar: true,
  publicAcknowledged: false,
  missingAcknowledged: false,
  selected: [],
  acknowledged: [],
  approvedUpdates: [],
};
