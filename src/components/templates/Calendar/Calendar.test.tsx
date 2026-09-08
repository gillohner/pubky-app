import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCalendarRoute } from '@/app/routes';
import { useEventkyCalendar } from '@/hooks/useEventkyCalendar/useEventkyCalendar';
import type { CalendarOccurrence } from '@/hooks/useEventkyCalendar/useEventkyCalendar.types';
import { getNexusUrl } from '@/libs/runtime-config/runtime-config';
import { useEventkyOccurrence } from '@/organisms/EventkyPostContent/EventkyOccurrenceContext';
import { useAuthStore } from '@/stores/auth/auth.store';
import {
  EMPTY_EVENTKY_PREFERENCES,
  eventkyPreferenceScope,
  useEventkyCalendarStore,
} from '@/stores/eventkyCalendar/eventkyCalendar.store';
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
  search.current = '';
  mockEnabled.mockReturnValue(true);
  mockQuery.mockReturnValue(queryResult());
  useAuthStore.setState({ currentUserPubky: null });
  useEventkyCalendarStore.setState({ scopes: {} });
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
        from: '2026-10-25T00:00:00.000Z',
        to: '2026-11-24T00:00:00.000Z',
        timezone: 'UTC',
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

  it('changes date windows through the date control and navigation buttons', () => {
    render(<Calendar />);
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-12-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next date range' }));
    expect(screen.getByLabelText('Date')).toHaveValue('2027-01-01');
    expect(mockQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: '2027-01-01T00:00:00.000Z', to: '2027-01-02T00:00:00.000Z' }),
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
    expect(screen.getByRole('alert')).toHaveTextContent('valid calendar post URIs');
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
    fireEvent.click(screen.getByRole('button', { name: 'Remove calendar 1' }));
    expect(mockReplace).toHaveBeenCalledWith(getCalendarRoute([second]));
  });

  it('validates timezone input and retains prior query semantics on invalid input', async () => {
    render(<Calendar />);
    fireEvent.change(screen.getByLabelText('Display timezone'), { target: { value: 'Not/AZone' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(screen.getByText('Choose a supported timezone, such as Europe/Zurich.')).toBeInTheDocument(),
    );
    expect(
      (
        useEventkyCalendarStore.getState().scopes[eventkyPreferenceScope(null, getNexusUrl())] ??
        EMPTY_EVENTKY_PREFERENCES
      ).timezone,
    ).toBe('UTC');
    fireEvent.change(screen.getByLabelText('Display timezone'), { target: { value: 'Europe/Zurich' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(
        (
          useEventkyCalendarStore.getState().scopes[eventkyPreferenceScope(null, getNexusUrl())] ??
          EMPTY_EVENTKY_PREFERENCES
        ).timezone,
      ).toBe('Europe/Zurich'),
    );
    expect(mockQuery).toHaveBeenLastCalledWith(expect.objectContaining({ timezone: 'Europe/Zurich' }));
  });

  it('uses this account’s shown calendars by default while allowing an explicit all-events view', () => {
    const account = 'y'.repeat(52);
    useAuthStore.setState({ currentUserPubky: account });
    const scope = eventkyPreferenceScope(account, getNexusUrl());
    useEventkyCalendarStore.getState().updateScope(scope, () => ({
      ...EMPTY_EVENTKY_PREFERENCES,
      subscriptions: [projectionPostUri],
    }));
    const { rerender } = render(<Calendar />);
    expect(mockQuery).toHaveBeenLastCalledWith(expect.objectContaining({ calendars: [projectionPostUri] }));
    expect(screen.getByRole('button', { name: 'Shown calendars (1)' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Remove calendar 1' }));
    expect(mockReplace).toHaveBeenLastCalledWith('/calendar?all=1');
    expect(useEventkyCalendarStore.getState().scopes[scope].subscriptions).toEqual([projectionPostUri]);
    search.current = 'all=1';
    rerender(<Calendar />);
    expect(mockQuery).toHaveBeenLastCalledWith(expect.objectContaining({ calendars: [] }));
    fireEvent.click(screen.getByRole('button', { name: 'Shown calendars (1)' }));
    expect(mockReplace).toHaveBeenLastCalledWith('/calendar');
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
