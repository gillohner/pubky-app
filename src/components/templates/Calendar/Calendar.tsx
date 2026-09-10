'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { postUriSchema } from '@eventky/contract';
import { Temporal } from '@js-temporal/polyfill';
import { ArrowLeft, ArrowRight, CalendarDays, RefreshCw, X } from 'lucide-react';
import { getCalendarRoute } from '@/app/routes';
import { Button } from '@/atoms/Button/Button';
import { Card } from '@/atoms/Card/Card';
import { Container } from '@/atoms/Container/Container';
import { Label } from '@/atoms/Label/Label';
import { Skeleton } from '@/atoms/Skeleton/Skeleton';
import { Typography } from '@/atoms/Typography/Typography';
import { useEventkyCalendar } from '@/hooks/useEventkyCalendar/useEventkyCalendar';
import type { CalendarOccurrence } from '@/hooks/useEventkyCalendar/useEventkyCalendar.types';
import { useEventkyCalendars } from '@/hooks/useEventkyCalendar/useEventkyCalendars';
import {
  calendarToday,
  type CalendarView,
  getCalendarWindow,
  moveCalendarAnchor,
  occurrenceOverlapsDay,
} from '@/libs/eventky/calendarView';
import { getEventkyCalendarEnabled } from '@/libs/runtime-config/runtime-config';
import { cn } from '@/libs/utils/utils';
import { EventkyDatePicker } from '@/molecules/EventkyDatePicker/EventkyDatePicker';
import { ContentLayout } from '@/organisms/ContentLayout/ContentLayout';
import { EventkyOccurrenceProvider } from '@/organisms/EventkyPostContent/EventkyOccurrenceContext';
import { PostMain } from '@/organisms/PostMain/PostMain';

function OccurrencePost({ occurrence }: { occurrence: CalendarOccurrence }) {
  return (
    <EventkyOccurrenceProvider occurrence={occurrence}>
      <PostMain postId={occurrence.projection.post_id} showFullContentInListLayout />
    </EventkyOccurrenceProvider>
  );
}

/** Timed views share a civil-time axis; exact local start/end labels remain authoritative across DST changes. */
function CalendarSchedule({
  days,
  items,
  timezone,
  view,
  selectedKey,
  anchor,
  onSelect,
  onDay,
}: {
  days: ReturnType<typeof getCalendarWindow>['days'];
  items: CalendarOccurrence[];
  timezone: string;
  view: 'week' | 'day';
  selectedKey: string | null;
  anchor: string;
  onSelect: (key: string) => void;
  onDay: (date: string) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const minute = (epoch: number) => {
    const local = Temporal.Instant.fromEpochMilliseconds(epoch).toZonedDateTimeISO(timezone);
    return local.hour * 60 + local.minute;
  };
  const timed = items.filter((item) => item.projection.start.type !== 'date');
  const firstMinute = timed.length ? Math.min(...timed.map((item) => minute(item.projection.start_epoch_ms))) : 480;
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = Math.max(0, Math.floor(firstMinute / 60) - 1) * 48;
  }, [firstMinute, view]);
  useEffect(() => {
    const container = scroll.current;
    if (!container || view !== 'week') return;
    const revealSelectedDay = () => {
      const selectedDay = container.querySelector<HTMLElement>(`[data-date="${anchor}"]`);
      if (selectedDay && container.scrollWidth > container.clientWidth) {
        container.scrollLeft = Math.max(0, selectedDay.offsetLeft - 56);
      }
    };
    revealSelectedDay();
    const resize = new ResizeObserver(revealSelectedDay);
    resize.observe(container);
    return () => resize.disconnect();
  }, [anchor, view]);
  const time = (epoch: number) =>
    new Intl.DateTimeFormat(undefined, { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(epoch);
  const keyFor = (item: CalendarOccurrence) => `${item.projection.post_id}:${item.projection.occurrence_key}`;
  const eventButton = (item: CalendarOccurrence) => (
    <Button
      variant="secondary"
      overrideDefaults
      className={cn(
        'flex h-full w-full flex-col items-start justify-start overflow-hidden rounded-md border border-input bg-muted p-2 text-left text-xs focus-visible:ring-2 focus-visible:ring-brand',
        selectedKey === keyFor(item) && 'ring-2 ring-brand',
        item.projection.status === 'CANCELLED' && 'line-through',
      )}
      aria-pressed={selectedKey === keyFor(item)}
      onClick={() => onSelect(keyFor(item))}
    >
      <span className="block font-medium">{item.event.summary}</span>
      <span className="block text-muted-foreground">
        {item.projection.start.type === 'date'
          ? 'All day'
          : `${time(item.projection.start_epoch_ms)} – ${time(item.projection.end_epoch_ms)}`}
      </span>
      {item.projection.status === 'CANCELLED' && <span>Cancelled</span>}
    </Button>
  );
  return (
    <div className="min-w-0">
      {view === 'week' && (
        <p className="mb-2 flex items-center gap-2 text-xs text-muted-foreground md:hidden">
          <ArrowLeft className="size-3" aria-hidden="true" />
          Swipe to see the other days
          <ArrowRight className="size-3" aria-hidden="true" />
        </p>
      )}
      <div
        ref={scroll}
        className="max-h-[420px] overflow-auto rounded-lg border border-input md:max-h-[640px]"
        tabIndex={0}
        aria-label="Event schedule"
      >
        <table
          className={cn('w-full table-fixed border-collapse', view === 'week' && 'min-w-3xl')}
          aria-label={`${view === 'week' ? 'Week' : 'Day'} calendar`}
        >
          <thead className="sticky top-0 z-10 bg-background">
            <tr>
              <td className="sticky left-0 z-30 w-14 border-b border-input bg-background" />
              {days.map((day) => (
                <th key={day.date} data-date={day.date} scope="col" className="border-b border-input py-2 text-xs">
                  <Button variant="ghost" size="sm" aria-label={`Show ${day.label}`} onClick={() => onDay(day.date)}>
                    <span>
                      {day.weekday}
                      <span className="block font-normal text-muted-foreground">{day.label}</span>
                    </span>
                  </Button>
                </th>
              ))}
            </tr>
            {items.some((item) => item.projection.start.type === 'date') && (
              <tr>
                <th
                  scope="row"
                  className="sticky left-0 z-30 bg-background p-1 text-xs font-normal text-muted-foreground"
                >
                  All day
                </th>
                {days.map((day) => (
                  <td key={day.date} className="border border-input p-1 align-top">
                    <div className="space-y-1">
                      {items
                        .filter(
                          (item) =>
                            item.projection.start.type === 'date' && occurrenceOverlapsDay(item.projection, day),
                        )
                        .map((item) => (
                          <div key={keyFor(item)}>{eventButton(item)}</div>
                        ))}
                    </div>
                  </td>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            <tr>
              <td className="sticky left-0 z-10 h-[1152px] bg-background align-top">
                {Array.from({ length: 24 }, (_, hour) => (
                  <span
                    key={hour}
                    className="absolute right-2 text-[10px] text-muted-foreground"
                    style={{ top: hour * 48 }}
                  >
                    {String(hour).padStart(2, '0')}:00
                  </span>
                ))}
              </td>
              {days.map((day) => {
                const dayItems = timed
                  .filter((item) => occurrenceOverlapsDay(item.projection, day))
                  .sort((a, b) => a.projection.start_epoch_ms - b.projection.start_epoch_ms);
                // Overlapping events retain separate columns and independent native-post targets.
                const columns: number[] = [];
                const positioned = dayItems.map((item) => {
                  const start =
                    item.projection.start_epoch_ms <= day.start ? 0 : minute(item.projection.start_epoch_ms);
                  const end = item.projection.end_epoch_ms >= day.end ? 1440 : minute(item.projection.end_epoch_ms);
                  const duration =
                    end > start
                      ? end - start
                      : Math.max(30, (item.projection.end_epoch_ms - item.projection.start_epoch_ms) / 60000);
                  // Compare drawn intervals too: repeated DST hours and short touch targets must not cover one another.
                  let column = columns.findIndex((end) => end <= start);
                  if (column < 0) column = columns.length;
                  columns[column] = start + Math.max(40, duration);
                  return { item, column, start, duration };
                });
                return (
                  <td
                    key={day.date}
                    className="relative h-[1152px] border-l border-input align-top"
                    style={{
                      backgroundImage:
                        'repeating-linear-gradient(to bottom, transparent 0, transparent 47px, var(--input) 47px, var(--input) 48px)',
                    }}
                  >
                    {positioned.map(({ item, column, start, duration }) => (
                      <div
                        key={keyFor(item)}
                        className="absolute px-0.5 py-px"
                        style={{
                          top: start * 0.8,
                          height: Math.max(32, Math.min(duration, 1440 - start) * 0.8),
                          left: `${(column * 100) / columns.length}%`,
                          width: `${100 / columns.length}%`,
                        }}
                      >
                        {eventButton(item)}
                      </div>
                    ))}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CalendarBody() {
  const [view, setView] = useState<CalendarView>('agenda');
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const weekStart = 1;
  const discovery = useEventkyCalendars();
  const [anchor, setAnchor] = useState(() => calendarToday(timezone));
  const [visibleCount, setVisibleCount] = useState(25);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const router = useRouter();
  const search = useSearchParams();
  const calendars = [...new Set(search.getAll('calendar'))];
  const validFilter = calendars.length <= 8 && calendars.every((uri) => postUriSchema.safeParse(uri).success);
  const window = getCalendarWindow(anchor, view, timezone, weekStart);
  const calendar = useEventkyCalendar(
    validFilter ? { from: window.from, to: window.to, timezone, calendars, include_cancelled: true } : null,
  );
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
  const compactTime = (item: CalendarOccurrence) =>
    item.projection.start.type === 'date'
      ? 'All day'
      : new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(
          item.projection.start_epoch_ms,
        );

  return (
    <Container className="gap-6">
      <Container overrideDefaults className="flex flex-wrap items-center justify-between gap-3">
        <Typography as="h1" size="lg" className="flex items-center gap-2">
          <CalendarDays aria-hidden="true" />
          Calendar
        </Typography>
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
          <EventkyDatePicker id="calendar-date" value={anchor} onChange={setDate} />
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
      </Container>
      <Container className="gap-3" aria-label="Calendar selection">
        <Typography size="sm" className="font-medium">
          Calendars
        </Typography>
        <Container overrideDefaults className="flex flex-wrap gap-2">
          <Button
            variant={calendars.length === 0 ? 'default' : 'outline'}
            aria-pressed={calendars.length === 0}
            onClick={() => router.replace(getCalendarRoute())}
          >
            All events
          </Button>
          {discovery.calendars.map((option) => (
            <Button
              key={option.uri}
              variant={calendars.includes(option.uri) ? 'default' : 'outline'}
              aria-pressed={calendars.includes(option.uri)}
              disabled={!calendars.includes(option.uri) && calendars.length >= 8}
              onClick={() =>
                router.replace(
                  getCalendarRoute(
                    calendars.includes(option.uri)
                      ? calendars.filter((uri) => uri !== option.uri)
                      : [...calendars, option.uri],
                  ),
                )
              }
            >
              {option.name}
            </Button>
          ))}
          {calendars
            .filter((uri) => !discovery.calendars.some((option) => option.uri === uri))
            .map((uri, index) => (
              <Button
                key={uri}
                variant="outline"
                aria-label={`Remove calendar ${index + 1}`}
                onClick={() => router.replace(getCalendarRoute(calendars.filter((value) => value !== uri)))}
              >
                Selected calendar {index + 1}
                <X className="size-4" />
              </Button>
            ))}
          {(discovery.hasMore || discovery.error) && (
            <Button variant="ghost" disabled={discovery.isLoading} onClick={discovery.loadMore}>
              {discovery.error ? 'Try again' : 'More calendars'}
            </Button>
          )}
        </Container>
        {discovery.isLoading && (
          <Typography size="sm" className="text-muted-foreground">
            Loading calendars…
          </Typography>
        )}
        {discovery.error && (
          <Typography size="sm" role="status">
            {discovery.error}
          </Typography>
        )}
      </Container>
      {!validFilter && (
        <Typography role="alert" className="text-destructive">
          Choose up to eight available calendars.
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
                {view === 'week' || view === 'day' ? (
                  <CalendarSchedule
                    days={window.days}
                    items={calendar.items}
                    timezone={timezone}
                    view={view}
                    selectedKey={selectedKey}
                    anchor={anchor}
                    onSelect={setSelectedKey}
                    onDay={(date) => {
                      setDate(date);
                      changeView('day');
                    }}
                  />
                ) : (
                  <Container overrideDefaults className="overflow-x-auto rounded-lg border border-input">
                    <table
                      className="w-full table-fixed border-collapse"
                      aria-label={`${view[0].toUpperCase() + view.slice(1)} calendar`}
                    >
                      <thead>
                        <tr>
                          {window.days.slice(0, 7).map((day) => (
                            <th
                              scope="col"
                              key={day.date}
                              className="border-b border-input px-0.5 py-2 text-xs text-muted-foreground md:p-2 md:text-sm"
                            >
                              {day.weekday}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from({ length: Math.ceil(window.days.length / 7) }, (_, row) => (
                          <tr key={row}>
                            {window.days.slice(row * 7, (row + 1) * 7).map((day) => (
                              <td key={day.date} className="h-24 border border-input p-0.5 align-top md:h-32 md:p-2">
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
                                  <span className="md:hidden">{Number(day.date.slice(-2))}</span>
                                  <span className="hidden md:inline">{day.label}</span>
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
                                          'w-full min-w-0 cursor-pointer overflow-hidden rounded-md bg-muted px-0.5 py-1 text-left text-[10px] focus-visible:ring-2 focus-visible:ring-ring md:p-2 md:text-xs',
                                          item.projection.status === 'CANCELLED' && 'line-through',
                                          selectedKey === keyFor(item) && 'ring-2 ring-brand',
                                        )}
                                        aria-label={`${item.event.summary}, ${compactTime(item)}`}
                                        aria-pressed={selectedKey === keyFor(item)}
                                        onClick={() => setSelectedKey(keyFor(item))}
                                      >
                                        <span className="block truncate text-muted-foreground">
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
                )}
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
