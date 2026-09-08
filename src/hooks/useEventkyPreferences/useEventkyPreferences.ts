'use client';

import { useRequireAuth } from '@/hooks/useRequireAuth/useRequireAuth';
import { getNexusUrl } from '@/libs/runtime-config/runtime-config';
import { toast } from '@/molecules/Toaster/toast';
import { useAuthStore } from '@/stores/auth/auth.store';
import {
  type CalendarView,
  EMPTY_EVENTKY_PREFERENCES,
  eventkyPreferenceScope,
  type EventkyReminder,
  eventkyReminderKey,
  useEventkyCalendarStore,
} from '@/stores/eventkyCalendar/eventkyCalendar.store';

export function useEventkyPreferences() {
  const account = useAuthStore((state) => state.currentUserPubky);
  const { requireAuth } = useRequireAuth();
  const scope = eventkyPreferenceScope(account, getNexusUrl());
  const preferences = useEventkyCalendarStore((state) => state.scopes[scope] ?? EMPTY_EVENTKY_PREFERENCES);
  const update = (change: (current: typeof preferences) => typeof preferences) =>
    isCurrent() && useEventkyCalendarStore.getState().updateScope(scope, change);
  const isCurrent = () => scope === eventkyPreferenceScope(useAuthStore.getState().currentUserPubky, getNexusUrl());
  const toggleCalendar = (uri: string) =>
    requireAuth(() => {
      if (!isCurrent()) return;
      const saved = update((current) => ({
        ...current,
        subscriptions: current.subscriptions.includes(uri)
          ? current.subscriptions.filter((value) => value !== uri)
          : [...current.subscriptions, uri],
      }));
      if (!saved)
        toast({ variant: 'error', description: 'Could not save this calendar. You can show up to 8 calendars.' });
    });
  const removeReminder = (reminder: Pick<EventkyReminder, 'postUri' | 'occurrenceKey'>) =>
    update((current) => ({
      ...current,
      reminders: current.reminders.filter((value) => eventkyReminderKey(value) !== eventkyReminderKey(reminder)),
    }));
  const toggleReminder = (postUri: string, occurrenceKey?: string) =>
    requireAuth(async () => {
      if (!isCurrent()) return;
      const existing = preferences.reminders.find(
        (value) => eventkyReminderKey(value) === eventkyReminderKey({ postUri, occurrenceKey }),
      );
      if (existing) {
        removeReminder(existing);
        return;
      }
      if (typeof Notification === 'undefined') {
        toast({ variant: 'info', description: 'This browser does not support desktop notifications.' });
        return;
      }
      try {
        const permission =
          Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
        if (!isCurrent()) return;
        if (permission !== 'granted') {
          toast({ variant: 'info', description: 'Allow notifications in your browser to enable reminders.' });
          return;
        }
        const saved = update((current) => ({
          ...current,
          reminders: [
            ...current.reminders.filter(
              (value) => eventkyReminderKey(value) !== eventkyReminderKey({ postUri, occurrenceKey }),
            ),
            { postUri, occurrenceKey, minutesBefore: 15, enabledAt: Date.now() },
          ],
        }));
        if (!saved)
          toast({ variant: 'error', description: 'Could not save the reminder. You can enable up to 64 reminders.' });
      } catch {
        toast({ variant: 'error', description: 'Could not enable browser notifications.' });
      }
    });
  return {
    ...preferences,
    scope,
    account,
    setView: (view: CalendarView) => update((value) => ({ ...value, view })),
    setTimezone: (timezone: string) => update((value) => ({ ...value, timezone })),
    setWeekStart: (weekStart: 1 | 7) => update((value) => ({ ...value, weekStart })),
    toggleCalendar,
    toggleReminder,
    removeReminder,
    clearPreferences: () => {
      if (isCurrent()) useEventkyCalendarStore.getState().clearScope(scope);
    },
  };
}
