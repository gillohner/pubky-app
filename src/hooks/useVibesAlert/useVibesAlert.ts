'use client';

import { useEffect, useState } from 'react';
import { z } from 'zod';
import { buildFeatureDiscoveryStorageKey } from '@/config/featureDiscovery';
import { VIBES_ALERT_STORAGE_ID, VIBES_REMINDER_DELAYS_MS } from '@/config/vibes';
import { useAuthStore } from '@/stores/auth/auth.store';

const reminderSchema = z.object({
  tried: z.boolean(),
  laterCount: z.number().int().nonnegative(),
  nextShowAt: z.number().nonnegative(),
});

type Reminder = z.infer<typeof reminderSchema>;
const initialReminder: Reminder = { tried: false, laterCount: 0, nextShowAt: 0 };

function readReminder(storageKey: string): Reminder {
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return initialReminder;
  try {
    const parsed = reminderSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : initialReminder;
  } catch {
    return initialReminder;
  }
}

export function useVibesAlert() {
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const storageKey = currentUserPubky
    ? buildFeatureDiscoveryStorageKey(currentUserPubky, VIBES_ALERT_STORAGE_ID)
    : null;
  const [visibility, setVisibility] = useState<{ storageKey: string | null; show: boolean }>({
    storageKey: null,
    show: false,
  });

  useEffect(() => {
    const checkVisit = () => {
      if (!storageKey) return;
      try {
        const reminder = readReminder(storageKey);
        setVisibility({ storageKey, show: !reminder.tried && Date.now() >= reminder.nextShowAt });
      } catch {
        // Avoid repeatedly prompting when the browser cannot retain the user's choice.
        setVisibility({ storageKey, show: false });
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkVisit();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) checkVisit();
    };

    // Recheck on a visit or return to the tab, never on a timer during a visit.
    checkVisit();
    window.addEventListener('focus', checkVisit);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('focus', checkVisit);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('storage', onStorage);
    };
  }, [storageKey]);

  const showVibesAlert = Boolean(storageKey) && visibility.storageKey === storageKey && visibility.show;

  const dismiss = (tried: boolean) => {
    // Permanent sidebar links can record Try while the reminder is snoozed.
    if (!storageKey || (!tried && !showVibesAlert)) return;
    setVisibility({ storageKey, show: false });
    try {
      // Read again so an older tab cannot undo Try or shorten another tab's snooze.
      const previous = readReminder(storageKey);
      if (previous.tried || (!tried && Date.now() < previous.nextShowAt)) return;
      const delay = VIBES_REMINDER_DELAYS_MS[Math.min(previous.laterCount, VIBES_REMINDER_DELAYS_MS.length - 1)];
      const reminder: Reminder = tried
        ? { ...previous, tried: true }
        : {
            tried: false,
            laterCount: Math.min(previous.laterCount + 1, VIBES_REMINDER_DELAYS_MS.length - 1),
            nextShowAt: Date.now() + delay,
          };
      window.localStorage.setItem(storageKey, JSON.stringify(reminder));
    } catch {
      // Dismiss this render even if storage becomes unavailable after loading.
    }
  };

  return { showVibesAlert, tryVibes: () => dismiss(true), remindLater: () => dismiss(false) };
}
