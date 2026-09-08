'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { postUriSchema } from '@eventky/contract';
import { zodResolver } from '@hookform/resolvers/zod';
import { Temporal } from '@js-temporal/polyfill';
import { ArrowLeft, ArrowRight, CalendarDays, RefreshCw, X } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { getCalendarRoute } from '@/app/routes';
import { Button } from '@/atoms/Button/Button';
import { Card } from '@/atoms/Card/Card';
import { Container } from '@/atoms/Container/Container';
import { Input } from '@/atoms/Input/Input';
import { Label } from '@/atoms/Label/Label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/atoms/Select/Select';
import { Skeleton } from '@/atoms/Skeleton/Skeleton';
import { Typography } from '@/atoms/Typography/Typography';
import { type CalendarFilters, calendarFiltersSchema } from '@/hooks/useEventkyCalendar/useCalendarFilters.types';
import { useEventkyCalendar } from '@/hooks/useEventkyCalendar/useEventkyCalendar';
import type { CalendarOccurrence } from '@/hooks/useEventkyCalendar/useEventkyCalendar.types';
import { useEventkyPreferences } from '@/hooks/useEventkyPreferences/useEventkyPreferences';
import { useRequireAuth } from '@/hooks/useRequireAuth/useRequireAuth';
import {
  calendarToday,
  getCalendarWindow,
  moveCalendarAnchor,
  occurrenceOverlapsDay,
} from '@/libs/eventky/calendarView';
import { getEventkyCalendarEnabled, getEventkyEnabled } from '@/libs/runtime-config/runtime-config';
import { cn } from '@/libs/utils/utils';
import { ContentLayout } from '@/organisms/ContentLayout/ContentLayout';
import { DialogEventkyImport } from '@/organisms/DialogEventkyImport/DialogEventkyImport';
import { EventkyOccurrenceProvider } from '@/organisms/EventkyPostContent/EventkyOccurrenceContext';
import { PostMain } from '@/organisms/PostMain/PostMain';
import { type CalendarView } from '@/stores/eventkyCalendar/eventkyCalendar.store';

function OccurrencePost({ occurrence }: { occurrence: CalendarOccurrence }) {
  return (
    <EventkyOccurrenceProvider occurrence={occurrence}>
      <PostMain postId={occurrence.projection.post_id} showFullContentInListLayout />
    </EventkyOccurrenceProvider>
  );
}

function CalendarBody() {
  const preferences = useEventkyPreferences();
  const { requireAuth, isAuthenticated } = useRequireAuth();
  const [importOpen, setImportOpen] = useState(false);
  const { view, timezone, weekStart, setView, setTimezone, setWeekStart } = preferences;
  const [anchor, setAnchor] = useState(() => calendarToday('UTC'));
  const [visibleCount, setVisibleCount] = useState(25);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const router = useRouter();
  const search = useSearchParams();
  const explicitSelection = search.has('calendar') || search.has('all');
  const calendars = [...new Set(explicitSelection ? search.getAll('calendar') : preferences.subscriptions)];
  const validFilter = calendars.length <= 8 && calendars.every((uri) => postUriSchema.safeParse(uri).success);
  const window = getCalendarWindow(anchor, view, timezone, weekStart);
  const calendar = useEventkyCalendar(
    validFilter ? { from: window.from, to: window.to, timezone, calendars, include_cancelled: true } : null,
  );
  const form = useForm<CalendarFilters>({
    resolver: zodResolver(calendarFiltersSchema),
    defaultValues: { timezone, calendarUri: '' },
  });
  useEffect(() => {
    form.setValue('timezone', timezone);
  }, [form, timezone]);
  const keyFor = (item: CalendarOccurrence) => `${item.projection.post_id}:${item.projection.occurrence_key}`;
  const selected = calendar.items.find((item) => keyFor(item) === selectedKey);
  const setDate = (date: string) => {
    try {
      setAnchor(Temporal.PlainDate.from(date).toString());
      setVisibleCount(25);
      setSelectedKey(null);
    } catch {
      /* Keep the previous range while the date field is incomplete. */
    }
  };
  const changeView = (next: CalendarView) => {
    setView(next);
    setVisibleCount(25);
    setSelectedKey(null);
  };
  const submitFilters = form.handleSubmit(({ timezone: nextZone, calendarUri }) => {
    setTimezone(nextZone);
    setVisibleCount(25);
    setSelectedKey(null);
    if (calendarUri && !calendars.includes(calendarUri)) {
      if (calendars.length >= 8) {
        form.setError('calendarUri', { message: 'Choose up to eight calendars.' });
        return;
      }
      router.replace(getCalendarRoute([...calendars, calendarUri]));
      form.setValue('calendarUri', '');
    }
  });
  const compactTime = (item: CalendarOccurrence) =>
    item.projection.start.type === 'date'
      ? 'All day'
      : new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(
          item.projection.start_epoch_ms,
        );

  return (
    <Container className="gap-6">
      {importOpen && isAuthenticated && getEventkyEnabled() && (
        <DialogEventkyImport open onOpenChange={setImportOpen} />
      )}
      <Container overrideDefaults className="flex flex-wrap items-center justify-between gap-3">
        <Typography as="h1" size="lg" className="flex items-center gap-2">
          <CalendarDays aria-hidden="true" />
          Calendar
        </Typography>
        {getEventkyEnabled() && (
          <Button variant="outline" onClick={() => requireAuth(() => setImportOpen(true))}>
            Import calendar
          </Button>
        )}
        <Button variant="outline" onClick={calendar.refresh} disabled={calendar.isRefreshing}>
          <RefreshCw aria-hidden="true" className={cn('size-4', calendar.isRefreshing && 'animate-spin')} />
          Refresh
        </Button>
      </Container>
      <Container overrideDefaults role="group" aria-label="Calendar view" className="flex flex-wrap gap-2">
        {(['agenda', 'month', 'week', 'day'] as const).map((value) => (
          <Button
            key={value}
            variant={view === value ? 'default' : 'ghost'}
            aria-pressed={view === value}
            onClick={() => changeView(value)}
          >
            {value[0].toUpperCase() + value.slice(1)}
          </Button>
        ))}
      </Container>
      <Container overrideDefaults className="flex flex-wrap items-end gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Previous date range"
          onClick={() => setDate(moveCalendarAnchor(anchor, view, -1))}
        >
          <ArrowLeft />
        </Button>
        <Container className="mx-0 w-fit gap-2">
          <Label htmlFor="calendar-date">Date</Label>
          <Input id="calendar-date" type="date" value={anchor} onChange={(event) => setDate(event.target.value)} />
        </Container>
        <Button
          variant="outline"
          size="icon"
          aria-label="Next date range"
          onClick={() => setDate(moveCalendarAnchor(anchor, view, 1))}
        >
          <ArrowRight />
        </Button>
        <Button variant="outline" onClick={() => setDate(calendarToday(timezone))}>
          Today
        </Button>
        <Container className="mx-0 w-fit gap-2">
          <Label htmlFor="calendar-week-start">Week starts on</Label>
          <Select value={String(weekStart)} onValueChange={(value) => setWeekStart(value === '7' ? 7 : 1)}>
            <SelectTrigger id="calendar-week-start">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Monday</SelectItem>
              <SelectItem value="7">Sunday</SelectItem>
            </SelectContent>
          </Select>
        </Container>
      </Container>
      <form onSubmit={submitFilters} className="flex flex-wrap items-end gap-3">
        <Container className="min-w-48 flex-1 gap-2">
          <Label htmlFor="calendar-timezone">Display timezone</Label>
          <Controller
            control={form.control}
            name="timezone"
            render={({ field }) => (
              <Input
                {...field}
                id="calendar-timezone"
                aria-invalid={!!form.formState.errors.timezone}
                aria-describedby="calendar-timezone-error"
              />
            )}
          />
          <span id="calendar-timezone-error" className="text-sm text-destructive">
            {form.formState.errors.timezone?.message}
          </span>
        </Container>
        <Container className="min-w-60 flex-1 gap-2">
          <Label htmlFor="calendar-uri">Add a calendar post URI</Label>
          <Controller
            control={form.control}
            name="calendarUri"
            render={({ field }) => (
              <Input
                {...field}
                id="calendar-uri"
                placeholder="pubky://…/pub/pubky.app/posts/…"
                aria-invalid={!!form.formState.errors.calendarUri}
                aria-describedby="calendar-uri-error"
              />
            )}
          />
          <span id="calendar-uri-error" className="text-sm text-destructive">
            {form.formState.errors.calendarUri?.message}
          </span>
        </Container>
        <Button type="submit" variant="outline">
          Apply
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            form.setValue('timezone', zone);
            setTimezone(zone);
          }}
        >
          Use device timezone
        </Button>
      </form>
      <Container overrideDefaults className="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          aria-pressed={search.has('all') || calendars.length === 0}
          onClick={() => router.replace(`${getCalendarRoute()}?all=1`)}
        >
          All events
        </Button>
        <Button
          variant="ghost"
          disabled={!preferences.subscriptions.length}
          aria-pressed={!explicitSelection && preferences.subscriptions.length > 0}
          onClick={() => router.replace(getCalendarRoute())}
        >
          Shown calendars ({preferences.subscriptions.length})
        </Button>
      </Container>
      <details className="rounded-lg border border-input p-3">
        <summary className="cursor-pointer text-sm font-medium">Local calendar preferences</summary>
        <Container className="gap-3 pt-3">
          <Typography size="sm" className="text-muted-foreground">
            Saved on this browser for this account and server. Published alarms do not turn on reminders.
          </Typography>
          {preferences.reminders.map((reminder, index) => (
            <Container
              overrideDefaults
              key={`${reminder.postUri}:${reminder.occurrenceKey ?? ''}`}
              className="flex items-center gap-2"
            >
              <Typography size="sm" className="min-w-0 truncate">
                {reminder.postUri}
              </Typography>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove reminder ${index + 1}`}
                onClick={() => preferences.removeReminder(reminder)}
              >
                Remove reminder
              </Button>
            </Container>
          ))}
          {preferences.reminders.length > 0 && (
            <Typography size="xs" className="text-muted-foreground">
              Reminders are delivered only while Pubky is open.
            </Typography>
          )}
          <Button variant="outline" size="sm" className="w-fit" onClick={preferences.clearPreferences}>
            Clear local calendar preferences
          </Button>
        </Container>
      </details>
      {calendars.length > 0 && (
        <Container className="gap-2">
          <Typography size="sm">Selected calendars ({calendars.length})</Typography>
          {calendars.map((uri, index) => (
            <Container overrideDefaults key={uri} className="flex items-center gap-2">
              <Typography size="sm" className="min-w-0 truncate">
                {uri}
              </Typography>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Show calendar ${index + 1}`}
                aria-pressed={preferences.subscriptions.includes(uri)}
                onClick={() => preferences.toggleCalendar(uri)}
              >
                {preferences.subscriptions.includes(uri) ? 'Shown' : 'Show'}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove calendar ${index + 1}`}
                onClick={() => {
                  const remaining = calendars.filter((item) => item !== uri);
                  router.replace(remaining.length ? getCalendarRoute(remaining) : `${getCalendarRoute()}?all=1`);
                }}
              >
                <X />
              </Button>
            </Container>
          ))}
        </Container>
      )}
      {!validFilter && (
        <Typography role="alert" className="text-destructive">
          Choose up to eight valid calendar post URIs.
        </Typography>
      )}
      {calendar.error && (
        <Typography role="alert" className="text-destructive">
          {calendar.error}
        </Typography>
      )}
      {calendar.incomplete && (
        <Card className="gap-1 p-4" role="status">
          <Typography size="sm">Calendar results are incomplete. Some events may be missing.</Typography>
          {calendar.stale && (
            <Typography size="sm" className="text-muted-foreground">
              Changed events are being refreshed.
            </Typography>
          )}
        </Card>
      )}
      {calendar.coverage?.scope === 'explicit-fixtures' && (
        <Typography size="sm" role="status" className="text-muted-foreground">
          This calendar shows a limited selection of events.
        </Typography>
      )}
      {calendar.hidden > 0 && (
        <Typography size="sm" className="text-muted-foreground">
          Some events are hidden by your moderation settings.
        </Typography>
      )}
      {calendar.isLoading ? (
        <Container aria-label="Loading calendar" className="gap-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </Container>
      ) : (
        !calendar.error &&
        validFilter && (
          <>
            {calendar.items.length === 0 && (
              <Typography role="status" className="text-muted-foreground">
                {calendar.incomplete
                  ? 'No events are available to display yet.'
                  : 'No visible events in this date range.'}
              </Typography>
            )}
            {view === 'agenda' ? (
              <Container className="gap-6">
                {calendar.items.slice(0, visibleCount).map((item) => (
                  <OccurrencePost key={keyFor(item)} occurrence={item} />
                ))}
                {calendar.items.length > visibleCount && (
                  <Button variant="outline" onClick={() => setVisibleCount((count) => count + 25)}>
                    Show more events
                  </Button>
                )}
              </Container>
            ) : (
              <>
                <Container overrideDefaults className="overflow-x-auto rounded-lg border border-input">
                  <table
                    className={cn('w-full table-fixed border-collapse', view !== 'day' && 'min-w-3xl')}
                    aria-label={`${view[0].toUpperCase() + view.slice(1)} calendar`}
                  >
                    <thead>
                      <tr>
                        {window.days.slice(0, view === 'day' ? 1 : 7).map((day) => (
                          <th
                            scope="col"
                            key={day.date}
                            className="border-b border-input p-2 text-sm text-muted-foreground"
                          >
                            {day.weekday}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: Math.ceil(window.days.length / (view === 'day' ? 1 : 7)) }, (_, row) => (
                        <tr key={row}>
                          {window.days
                            .slice(row * (view === 'day' ? 1 : 7), (row + 1) * (view === 'day' ? 1 : 7))
                            .map((day) => (
                              <td key={day.date} className="h-32 border border-input p-2 align-top">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="mb-1 h-auto px-1 text-xs"
                                  aria-label={`Show ${day.label}`}
                                  onClick={() => {
                                    setDate(day.date);
                                    changeView('day');
                                  }}
                                >
                                  {day.label}
                                </Button>
                                <Container className="gap-1">
                                  {calendar.items
                                    .filter((item) => occurrenceOverlapsDay(item.projection, day))
                                    .map((item) => (
                                      <Button
                                        key={keyFor(item)}
                                        variant={selectedKey === keyFor(item) ? 'default' : 'secondary'}
                                        overrideDefaults
                                        className={cn(
                                          'w-full cursor-pointer rounded-md bg-muted p-2 text-left text-xs focus-visible:ring-2 focus-visible:ring-ring',
                                          item.projection.status === 'CANCELLED' && 'line-through',
                                          selectedKey === keyFor(item) && 'ring-2 ring-brand',
                                        )}
                                        aria-pressed={selectedKey === keyFor(item)}
                                        onClick={() => setSelectedKey(keyFor(item))}
                                      >
                                        <span className="block text-muted-foreground">
                                          {compactTime(item)}
                                          {item.projection.status === 'CANCELLED' && ' · Cancelled'}
                                        </span>
                                        <span className="block truncate">{item.event.summary}</span>
                                      </Button>
                                    ))}
                                </Container>
                              </td>
                            ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Container>
                {selected && (
                  <section aria-label="Selected event">
                    <OccurrencePost occurrence={selected} />
                  </section>
                )}
              </>
            )}
          </>
        )
      )}
    </Container>
  );
}

export function Calendar() {
  return (
    <ContentLayout
      showLeftSidebar={false}
      showRightSidebar={false}
      showLeftMobileButton={false}
      showRightMobileButton={false}
      hasGradientBackground={false}
      disableWideShellLayout
      className="pb-24"
      classNameWrapperContent="mx-auto max-w-6xl"
    >
      {getEventkyCalendarEnabled() ? (
        <CalendarBody />
      ) : (
        <Typography role="status">Calendar is not available on this instance.</Typography>
      )}
    </ContentLayout>
  );
}
