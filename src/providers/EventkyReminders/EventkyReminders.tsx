'use client';

import { useEventkyReminders } from '@/hooks/useEventkyReminders/useEventkyReminders';

/** Runs only reminders explicitly enabled by the current account while this app is open. */
export function EventkyReminders() {
  useEventkyReminders();
  return null;
}
