import { eventOverrideSchema } from '@eventky/schema';
import { z } from 'zod';

export const eventkyPostFormSchema = z.object({
  title: z.string().trim().min(1, 'A title is required.').max(500, 'Use at most 500 characters.'),
  description: z.string().max(65536, 'The description is too long.'),
  startDate: z.string(),
  startTime: z.string(),
  endDate: z.string(),
  endTime: z.string(),
  allDay: z.boolean(),
  useDuration: z.boolean(),
  duration: z.string(),
  timeMode: z.enum(['zoned', 'utc', 'floating']),
  timezone: z.string().min(1, 'Choose a timezone.'),
  status: z.enum(['CONFIRMED', 'TENTATIVE', 'CANCELLED']),
  recurrence: z.string(),
  overrides: z.array(eventOverrideSchema).max(500, 'Use at most 500 occurrence changes.'),
  location: z.string().max(1000, 'The location is too long.'),
  locationUrl: z.union([z.literal(''), z.url('Enter a valid location URL.')]),
  onlineUrl: z.union([z.literal(''), z.url('Enter a valid meeting URL.')]),
  website: z.union([z.literal(''), z.url('Enter a valid website URL.')]),
  calendarUris: z.string(),
  contributors: z.string(),
  excludedEventUris: z.string(),
  weekStart: z.enum(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']),
  defaultDuration: z.string(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex color.'),
  organizerName: z.string().max(500),
  organizerUrl: z.union([z.literal(''), z.url('Enter a valid organizer URL.')]),
  categories: z.string(),
  transparent: z.boolean(),
});

export type EventkyPostFormData = z.infer<typeof eventkyPostFormSchema>;
export type EventkyPostKind = 'event' | 'calendar';
