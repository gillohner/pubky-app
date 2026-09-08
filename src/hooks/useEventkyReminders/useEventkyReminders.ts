'use client';

import { useEffect } from 'react';
import { parseEventkyContent } from '@eventky/contract';
import { expandOccurrences } from '@eventky/recurrence';
import { POST_ROUTES } from '@/app/routes';
import { PostController } from '@/controllers/post/post';
import { useEventkyPreferences } from '@/hooks/useEventkyPreferences/useEventkyPreferences';
import { useMutedUsers } from '@/hooks/useMutedUsers/useMutedUsers';
import { eventkySourceHash } from '@/libs/eventky/sourceHash';
import { getEventkyCalendarEnabled, getNexusUrl } from '@/libs/runtime-config/runtime-config';
import { isPostDeleted } from '@/libs/utils/utils';
import { useAuthStore } from '@/stores/auth/auth.store';
import {
  EMPTY_EVENTKY_PREFERENCES,
  eventkyPreferenceScope,
  eventkyReminderKey,
  useEventkyCalendarStore,
} from '@/stores/eventkyCalendar/eventkyCalendar.store';

interface ReminderTickOptions {
  scope: string;
  account: string;
  now: number;
  muted: ReadonlySet<string>;
  isActive: () => boolean;
  notify: (title: string, postId: string, deliveryKey: string) => void;
}

/** Fresh source reads plus bounded expansion; published alarms never opt a viewer into reminders. */
export async function runEventkyReminderTick({
  scope,
  account,
  now,
  muted,
  isActive,
  notify,
}: ReminderTickOptions): Promise<void> {
  // Honor changes made in another tab before reading any opted-in sources.
  await useEventkyCalendarStore.persist.rehydrate();
  if (!isActive()) return;
  const preferences = useEventkyCalendarStore.getState().scopes[scope] ?? EMPTY_EVENTKY_PREFERENCES;
  const reminders = preferences.reminders;
  for (const postUri of new Set(reminders.map((value) => value.postUri))) {
    if (!isActive()) return;
    const parts = postUri.split('/');
    const author = parts[2];
    const postId = `${author}:${parts.at(-1)}`;
    if (muted.has(author)) continue;
    try {
      const before = await PostController.getDetails({ compositeId: postId });
      if (!isActive()) return;
      const prior = before ? parseEventkyContent(before.kind, before.content) : null;
      if (prior?.status === 'supported' && prior.kind === 'event') {
        useEventkyCalendarStore.getState().updateScope(scope, (value) => ({
          ...value,
          reminders: value.reminders.map((reminder) =>
            reminder.postUri === postUri
              ? {
                  ...reminder,
                  observedSequence: Math.max(reminder.observedSequence ?? 0, prior.value.sequence),
                  observedModifiedAt: Math.max(reminder.observedModifiedAt ?? 0, Date.parse(prior.value.last_modified)),
                }
              : reminder,
          ),
        }));
      }
      const refreshed = await PostController.fetch({ compositeId: postId, viewerId: account });
      // A reminder may have been removed in another tab while the source request was pending.
      await useEventkyCalendarStore.persist.rehydrate();
      if (!isActive()) return;
      const currentReminders = useEventkyCalendarStore.getState().scopes[scope]?.reminders ?? [];
      const wasIndexed = currentReminders.some((reminder) => reminder.postUri === postUri && reminder.sourceSeen);
      if (isPostDeleted(before?.content) || isPostDeleted(refreshed?.content) || (!refreshed && wasIndexed)) {
        useEventkyCalendarStore.getState().updateScope(scope, (value) => ({
          ...value,
          reminders: value.reminders.filter((reminder) => reminder.postUri !== postUri),
        }));
        continue;
      }
      // A just-published post may not have reached Nexus yet. Keep the explicit choice and retry.
      if (!refreshed) continue;
      const post = await PostController.getDetails({ compositeId: postId });
      if (!post || post.is_blurred || !isActive()) continue;
      const parsed = parseEventkyContent(post.kind, post.content);
      if (parsed.status !== 'supported' || parsed.kind !== 'event') continue;
      if (
        currentReminders.some(
          (reminder) =>
            reminder.postUri === postUri &&
            ((reminder.observedSequence ?? 0) > parsed.value.sequence ||
              (reminder.observedModifiedAt ?? 0) > Date.parse(parsed.value.last_modified)),
        )
      )
        continue;
      const sourceHash = await eventkySourceHash(post.kind, post.content);
      if ((await eventkySourceHash(refreshed.kind, refreshed.content)) !== sourceHash) continue;
      useEventkyCalendarStore.getState().updateScope(scope, (value) => ({
        ...value,
        reminders: value.reminders.map((reminder) =>
          reminder.postUri === postUri ? { ...reminder, sourceSeen: true } : reminder,
        ),
      }));
      for (const reminder of reminders.filter((value) => value.postUri === postUri)) {
        const offset = reminder.minutesBefore * 60000;
        const expanded = expandOccurrences(parsed.value, {
          from: new Date(now - 60000).toISOString(),
          to: new Date(now + offset + 60000).toISOString(),
          timezone: preferences.timezone,
          maxOccurrences: 256,
          maxIterations: 5000,
        });
        if (expanded.status !== 'complete') continue;
        for (const occurrence of expanded.occurrences) {
          if (reminder.occurrenceKey && reminder.occurrenceKey !== occurrence.key) continue;
          const due = occurrence.start_epoch_ms - offset;
          if (due > now || due < now - 60000 || due < reminder.enabledAt || occurrence.event.status === 'CANCELLED')
            continue;
          const deliveryKey = JSON.stringify([postUri, occurrence.key, due]);
          const deliver = async () => {
            // Web Locks serialize delivery across tabs; refresh the persisted ledger inside the lock.
            await useEventkyCalendarStore.persist.rehydrate();
            const latest = await PostController.getDetails({ compositeId: postId });
            if (
              !isActive() ||
              !latest ||
              latest.is_blurred ||
              (await eventkySourceHash(latest.kind, latest.content)) !== sourceHash
            )
              return;
            const current = useEventkyCalendarStore.getState().scopes[scope];
            if (
              !current?.reminders.some(
                (value) =>
                  eventkyReminderKey(value) === eventkyReminderKey(reminder) && value.enabledAt === reminder.enabledAt,
              )
            )
              return;
            if (!useEventkyCalendarStore.getState().claimDelivery(scope, deliveryKey, now)) return;
            try {
              notify(occurrence.event.summary, postId, deliveryKey);
            } catch {
              useEventkyCalendarStore.getState().updateScope(scope, (value) => ({
                ...value,
                delivered: Object.fromEntries(Object.entries(value.delivered).filter(([key]) => key !== deliveryKey)),
              }));
            }
          };
          if (typeof navigator !== 'undefined' && navigator.locks)
            await navigator.locks.request(`eventky-reminder:${scope}`, deliver);
          else await deliver();
        }
      }
    } catch {
      // A failed source refresh is retried later; stale cached content must never trigger a reminder.
    }
  }
}

export function useEventkyReminders() {
  const { scope, account, reminders } = useEventkyPreferences();
  const { mutedUserIdSet, isLoading } = useMutedUsers();
  const reminderKey = JSON.stringify(
    reminders.map(({ postUri, occurrenceKey, minutesBefore, enabledAt }) => ({
      postUri,
      occurrenceKey,
      minutesBefore,
      enabledAt,
    })),
  );
  const mutedKey = JSON.stringify([...mutedUserIdSet].sort());
  const enabled = getEventkyCalendarEnabled();
  useEffect(() => {
    if (
      !enabled ||
      !account ||
      reminderKey === '[]' ||
      isLoading ||
      typeof Notification === 'undefined' ||
      Notification.permission !== 'granted'
    )
      return;
    let stopped = false;
    let running = false;
    const notifications: Notification[] = [];
    const isActive = () =>
      !stopped &&
      scope === eventkyPreferenceScope(useAuthStore.getState().currentUserPubky, getNexusUrl()) &&
      Notification.permission === 'granted';
    const tick = async () => {
      if (!isActive() || running) return;
      running = true;
      try {
        await runEventkyReminderTick({
          scope,
          account,
          now: Date.now(),
          muted: new Set<string>(JSON.parse(mutedKey)),
          isActive,
          notify: (title, postId, deliveryKey) => {
            if (!isActive()) return;
            const notification = new Notification(title, {
              body: 'You asked to be reminded about this event.',
              tag: deliveryKey,
            });
            notifications.push(notification);
            notification.onclick = () => {
              if (isActive()) {
                window.focus();
                window.location.assign(`${POST_ROUTES.POST}/${postId.replace(':', '/')}`);
              }
              notification.close();
            };
          },
        });
      } finally {
        running = false;
      }
    };
    void tick();
    const interval = window.setInterval(() => void tick(), 30000);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      notifications.forEach((notification) => notification.close());
    };
  }, [account, scope, reminderKey, mutedKey, enabled, isLoading]);
}
