import { postUriSchema } from '@eventky/contract';
import { isSupportedTimeZone } from '@eventky/temporal';
import { z } from 'zod';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CalendarView = 'agenda' | 'month' | 'week' | 'day';
const reminderSchema = z.object({
  postUri: postUriSchema,
  occurrenceKey: z.string().max(512).optional(),
  minutesBefore: z.number().int().min(0).max(10080),
  enabledAt: z.number().finite(),
  sourceSeen: z.boolean().optional(),
  observedSequence: z.number().int().nonnegative().optional(),
  observedModifiedAt: z.number().finite().optional(),
});
export type EventkyReminder = z.infer<typeof reminderSchema>;
const preferencesSchema = z.object({
  view: z.enum(['agenda', 'month', 'week', 'day']),
  timezone: z.string().refine(isSupportedTimeZone),
  weekStart: z.union([z.literal(1), z.literal(7)]),
  subscriptions: z.array(postUriSchema).max(8),
  reminders: z.array(reminderSchema).max(64),
  delivered: z.record(z.string().max(1024), z.number().finite()),
});
export type EventkyPreferences = z.infer<typeof preferencesSchema>;
export const EMPTY_EVENTKY_PREFERENCES: EventkyPreferences = {
  view: 'agenda',
  timezone: 'UTC',
  weekStart: 1,
  subscriptions: [],
  reminders: [],
  delivered: {},
};
export const EVENTKY_PREFERENCES_KEY = 'eventky-personal-preferences-v1';

/** Exact account/backend separation; guest scope carries view choices only. */
export function eventkyPreferenceScope(account: string | null, backend: string): string {
  return JSON.stringify([account, backend]);
}
export function eventkyReminderKey(reminder: Pick<EventkyReminder, 'postUri' | 'occurrenceKey'>): string {
  return JSON.stringify([reminder.postUri, reminder.occurrenceKey ?? null]);
}
interface EventkyCalendarStore {
  scopes: Record<string, EventkyPreferences>;
  updateScope: (scope: string, update: (current: EventkyPreferences) => EventkyPreferences) => boolean;
  clearScope: (scope: string) => void;
  claimDelivery: (scope: string, key: string, now: number) => boolean;
}

export const useEventkyCalendarStore = create<EventkyCalendarStore>()(
  persist(
    (set, get) => ({
      scopes: {},
      updateScope: (scope, update) => {
        const parsed = preferencesSchema.safeParse(update(get().scopes[scope] ?? EMPTY_EVENTKY_PREFERENCES));
        if (!parsed.success) return false;
        set((state) => ({ scopes: { ...state.scopes, [scope]: parsed.data } }));
        return true;
      },
      clearScope: (scope) =>
        set((state) => ({ scopes: Object.fromEntries(Object.entries(state.scopes).filter(([key]) => key !== scope)) })),
      claimDelivery: (scope, key, now) => {
        const current = get().scopes[scope] ?? EMPTY_EVENTKY_PREFERENCES;
        if (current.delivered[key] !== undefined) return false;
        const recent = Object.entries(current.delivered)
          .filter(([, time]) => now - time < 8 * 86400000)
          .slice(-511);
        return get().updateScope(scope, (value) => ({
          ...value,
          delivered: { ...Object.fromEntries(recent), [key]: now },
        }));
      },
    }),
    {
      name: EVENTKY_PREFERENCES_KEY,
      partialize: ({ scopes }) => ({ scopes }),
      merge: (saved, current) => {
        const decoded = z.object({ scopes: z.record(z.string().max(4096), preferencesSchema) }).safeParse(saved);
        return decoded.success ? { ...current, scopes: decoded.data.scopes } : current;
      },
    },
  ),
);
