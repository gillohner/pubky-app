import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCalendarRoute } from '@/app/routes';
import { useEventkyCalendar } from '@/hooks/useEventkyCalendar/useEventkyCalendar';
import type { CalendarOccurrence } from '@/hooks/useEventkyCalendar/useEventkyCalendar.types';
import { useEventkyOccurrence } from '@/organisms/EventkyPostContent/EventkyOccurrenceContext';
import { useAuthStore } from '@/stores/auth/auth.store';
import { eventkyEventFixture } from '@/test/fixtures/eventky';
import {
  occurrencePageFixture,
  projectedOccurrenceFixture,
  projectionPostId,
  projectionPostUri,
} from '@/test/fixtures/eventkyProjection';
import { Calendar } from './Calendar';

const { mockQuery, mockReplace, mockEnabled, search } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockReplace: vi.fn(),
  mockEnabled: vi.fn(() => true),
  search: { current: '' },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(search.current),
}));
vi.mock('@/hooks/useEventkyCalendar/useEventkyCalendar', () => ({ useEventkyCalendar: mockQuery }));
vi.mock('@/hooks/useEventkyCalendar/useEventkyCalendars', () => ({
  useEventkyCalendars: () => ({
    calendars: [{ uri: projectionPostUri, name: 'Builders' }],
    isLoading: false,
    hasMore: false,
  }),
}));
vi.mock('@/libs/eventky/calendarView', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/libs/eventky/calendarView')>()),
  calendarToday: () => '2026-10-25',
}));
vi.mock('@/libs/runtime-config/runtime-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/libs/runtime-config/runtime-config')>()),
  getEventkyCalendarEnabled: mockEnabled,
}));
vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/organisms/PostMain/PostMain', () => ({
  PostMain: ({ postId }: { postId: string }) => {
    const occurrence = useEventkyOccurrence();
    return (
      <article aria-label="Native event post" data-post-id={postId}>
        <h2>{occurrence?.event.summary}</h2>
        <span>{occurrence?.projection.occurrence_key}</span>
      </article>
    );
  },
}));

const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;

const occurrence: CalendarOccurrence = {
  projection: projectedOccurrenceFixture,
  event: eventkyEventFixture,
  sourceContent: JSON.stringify(eventkyEventFixture),
};
function queryResult(
  overrides: Partial<ReturnType<typeof useEventkyCalendar>> = {},
): ReturnType<typeof useEventkyCalendar> {
  return {
    items: [occurrence],
    hidden: 0,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    coverage: occurrencePageFixture().coverage,
    incomplete: false,
    stale: false,
    refresh: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...originalResolvedOptions.call(this), timeZone: 'Europe/Zurich' };
  });
  search.current = '';
  mockEnabled.mockReturnValue(true);
  mockQuery.mockReturnValue(queryResult());
  useAuthStore.setState({ currentUserPubky: null });
});

describe('Calendar', () => {
  it('renders agenda occurrences inside the shared native post identity and context', () => {
    render(<Calendar />);
    expect(screen.getByRole('heading', { name: 'Calendar' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Native event post' })).toHaveAttribute(
      'data-post-id',
      projectionPostId,
    );
    expect(screen.getByRole('heading', { name: 'Pubky community meetup' })).toBeInTheDocument();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '2026-10-24T22:00:00.000Z',
        to: '2026-11-23T23:00:00.000Z',
        timezone: 'Europe/Zurich',
        include_cancelled: true,
      }),
    );
  });

  it.each(['Month', 'Week', 'Day'])(
    'switches to %s view and opens the selected occurrence using native posts',
    (view) => {
      render(<Calendar />);
      fireEvent.click(screen.getByRole('button', { name: view }));
      const table = screen.getByRole('table', { name: `${view} calendar` });
      expect(screen.getByRole('button', { name: view })).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(within(table).getByRole('button', { name: /Pubky community meetup/ }));
      expect(screen.getByRole('region', { name: 'Selected event' })).toContainElement(
        screen.getByRole('article', { name: 'Native event post' }),
      );
      expect(screen.getByRole('article')).toHaveAttribute('data-post-id', projectionPostId);
    },
  );

  it('starts week columns on Monday without exposing week preferences', () => {
    render(<Calendar />);
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent('Mon');
    expect(screen.queryByLabelText('Week starts on')).not.toBeInTheDocument();
  });

  it('shows hourly positions, duration labels and separate overlapping events in day view', () => {
    mockQuery.mockReturnValue(
      queryResult({
        items: [
          occurrence,
          {
            ...occurrence,
            event: { ...occurrence.event, summary: 'Another meetup' },
            projection: { ...occurrence.projection, post_id: 'other:event' },
          },
        ],
      }),
    );
    render(<Calendar />);
    fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    expect(screen.getByText('18:00')).toBeInTheDocument();
    const event = within(screen.getByRole('table', { name: 'Day calendar' })).getByRole('button', {
      name: /Pubky community meetup/,
    });
    expect(event.parentElement).toHaveStyle({ width: '50%' });
    expect(event.parentElement).toHaveStyle({ height: '96px' });
    expect(within(screen.getByRole('table')).getByRole('button', { name: /Another meetup/ })).toBeInTheDocument();
  });

  it('keeps repeated daylight-saving hours independently selectable', () => {
    mockQuery.mockReturnValue(
      queryResult({
        items: [0, 1].map((hour) => ({
          ...occurrence,
          projection: {
            ...occurrence.projection,
            post_id: `repeat:${hour}`,
            start_epoch_ms: Date.parse(`2026-10-25T0${hour}:30:00Z`),
            end_epoch_ms: Date.parse(`2026-10-25T0${hour}:50:00Z`),
          },
        })),
      }),
    );
    render(<Calendar />);
    fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    const events = within(screen.getByRole('table', { name: 'Day calendar' })).getAllByRole('button', {
      name: /Pubky community meetup/,
    });
    expect(events).toHaveLength(2);
    expect(events[0].parentElement).toHaveStyle({ left: '0%', width: '50%' });
    expect(events[1].parentElement).toHaveStyle({ left: '50%', width: '50%' });
  });

  it('keeps all-day events above the hourly schedule', () => {
    mockQuery.mockReturnValue(
      queryResult({
        items: [
          {
            ...occurrence,
            projection: {
              ...occurrence.projection,
              start: { type: 'date', value: '2026-10-25' },
              end: { type: 'date', value: '2026-10-26' },
            },
          },
        ],
      }),
    );
    render(<Calendar />);
    fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    const heading = screen.getByRole('rowheader', { name: 'All day' });
    expect(within(heading.parentElement!).getByRole('button', { name: /Pubky community meetup/ })).toBeInTheDocument();
  });

  it('changes date windows through the date control and navigation buttons', () => {
    render(<Calendar />);
    fireEvent.click(screen.getByRole('button', { name: 'Date' }));
    fireEvent.click(screen.getByRole('button', { name: /October 31st, 2026/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next date range' }));
    expect(screen.getByRole('button', { name: 'Date' })).toHaveTextContent('Nov 1, 2026');
    expect(mockQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: '2026-10-31T23:00:00.000Z', to: '2026-11-01T23:00:00.000Z' }),
    );
  });

  it('does not call the query hook when disabled by the deployment', () => {
    mockEnabled.mockReturnValue(false);
    render(<Calendar />);
    expect(screen.getByRole('status')).toHaveTextContent('Calendar is not available on this instance.');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('fails closed for invalid calendar URI filters instead of querying all events', () => {
    search.current = 'calendar=invalid';
    mockQuery.mockReturnValue(queryResult({ items: [] }));
    render(<Calendar />);
    expect(mockQuery).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('alert')).toHaveTextContent('available calendars');
    expect(screen.queryByText('No visible events in this date range.')).not.toBeInTheDocument();
  });

  it('preserves exact selected URIs and removes only the chosen calendar', () => {
    const second = projectionPostUri.replace(/1$/, '2');
    search.current = new URLSearchParams([
      ['calendar', projectionPostUri],
      ['calendar', second],
    ]).toString();
    render(<Calendar />);
    expect(mockQuery).toHaveBeenCalledWith(expect.objectContaining({ calendars: [projectionPostUri, second] }));
    fireEvent.click(screen.getByRole('button', { name: 'Builders' }));
    expect(mockReplace).toHaveBeenCalledWith(getCalendarRoute([second]));
  });

  it('always uses device timezone without display settings, import or URI fields', () => {
    render(<Calendar />);
    expect(mockQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    );
    expect(screen.queryByLabelText('Display timezone')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Add a calendar post URI')).not.toBeInTheDocument();
    expect(screen.queryByText('Local calendar preferences')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import calendar' })).not.toBeInTheDocument();
  });

  it('selects discoverable calendars by name without saving local preferences', () => {
    render(<Calendar />);
    expect(mockQuery).toHaveBeenLastCalledWith(expect.objectContaining({ calendars: [] }));
    fireEvent.click(screen.getByRole('button', { name: 'Builders' }));
    expect(mockReplace).toHaveBeenLastCalledWith(getCalendarRoute([projectionPostUri]));
  });

  it('distinguishes incomplete, stale, hidden, unavailable and truly empty results', () => {
    mockQuery.mockReturnValue(queryResult({ items: [], incomplete: true, stale: true, hidden: 1 }));
    const { rerender } = render(<Calendar />);
    expect(screen.getByText('Calendar results are incomplete. Some events may be missing.')).toBeInTheDocument();
    expect(screen.getByText('Changed events are being refreshed.')).toBeInTheDocument();
    expect(screen.getByText('Some events are hidden by your moderation settings.')).toBeInTheDocument();
    expect(screen.queryByText('No visible events in this date range.')).not.toBeInTheDocument();
    mockQuery.mockReturnValue(queryResult({ items: [], error: 'Calendar results are unavailable. Try refreshing.' }));
    rerender(<Calendar />);
    expect(screen.getByRole('alert')).toHaveTextContent('unavailable');
    expect(screen.queryByText('No visible events in this date range.')).not.toBeInTheDocument();
    mockQuery.mockReturnValue(queryResult({ items: [] }));
    rerender(<Calendar />);
    expect(screen.getByRole('status')).toHaveTextContent('No visible events in this date range.');
  });

  it('keeps additional agenda occurrences reachable without mounting all cards initially', () => {
    mockQuery.mockReturnValue(
      queryResult({
        items: Array.from({ length: 26 }, (_, index) => ({
          ...occurrence,
          projection: { ...projectedOccurrenceFixture, occurrence_key: String(index) },
        })),
      }),
    );
    render(<Calendar />);
    expect(screen.getAllByRole('article')).toHaveLength(25);
    fireEvent.click(screen.getByRole('button', { name: 'Show more events' }));
    expect(screen.getAllByRole('article')).toHaveLength(26);
    expect(screen.queryByRole('button', { name: 'Show more events' })).not.toBeInTheDocument();
  });
});
