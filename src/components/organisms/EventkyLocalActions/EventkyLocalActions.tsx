'use client';

import { Bell, BellOff, CalendarCheck, CalendarPlus, Copy } from 'lucide-react';
import { Button } from '@/atoms/Button/Button';
import { Container } from '@/atoms/Container/Container';
import { Typography } from '@/atoms/Typography/Typography';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard/useCopyToClipboard';
import { useEventkyPreferences } from '@/hooks/useEventkyPreferences/useEventkyPreferences';
import { eventkyReminderKey } from '@/stores/eventkyCalendar/eventkyCalendar.store';

export function EventkyLocalActions({
  kind,
  postUri,
  occurrenceKey,
  cancelled = false,
}: {
  kind: 'event' | 'calendar';
  postUri: string;
  occurrenceKey?: string;
  cancelled?: boolean;
}) {
  const preferences = useEventkyPreferences();
  const { copyToClipboard } = useCopyToClipboard({ successTitle: 'Calendar subscription link copied' });
  if (kind === 'calendar') {
    const shown = preferences.subscriptions.includes(postUri);
    return (
      <Container className="gap-2">
        <Container className="flex-row flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            aria-pressed={shown}
            onClick={(event) => {
              event.stopPropagation();
              preferences.toggleCalendar(postUri);
            }}
          >
            {shown ? <CalendarCheck aria-hidden="true" /> : <CalendarPlus aria-hidden="true" />}
            {shown ? 'Calendar shown' : 'Show this calendar'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            title="Copy the public subscription link for a calendar app"
            onClick={(event) => {
              event.stopPropagation();
              void copyToClipboard(
                `${window.location.origin}/api/eventky/calendar.ics?calendar=${encodeURIComponent(postUri)}`,
              );
            }}
          >
            <Copy aria-hidden="true" />
            Subscribe in calendar app
          </Button>
        </Container>
        <Typography size="xs" className="text-muted-foreground">
          Copies a public feed link that stays updated in your calendar app. Downloaded event files are snapshots.
        </Typography>
      </Container>
    );
  }
  const enabled = preferences.reminders.some(
    (reminder) => eventkyReminderKey(reminder) === eventkyReminderKey({ postUri, occurrenceKey }),
  );
  return (
    <Container className="gap-1">
      <Button
        variant="outline"
        size="sm"
        className="w-fit"
        aria-pressed={enabled}
        disabled={cancelled && !enabled}
        onClick={(event) => {
          event.stopPropagation();
          void preferences.toggleReminder(postUri, occurrenceKey);
        }}
      >
        {enabled ? <BellOff aria-hidden="true" /> : <Bell aria-hidden="true" />}
        {enabled ? 'Turn off reminder' : 'Remind me'}
      </Button>
      <Typography size="xs" className="text-muted-foreground">
        15 minutes before · while Pubky is open{occurrenceKey ? ' · this occurrence' : ''}
      </Typography>
    </Container>
  );
}
