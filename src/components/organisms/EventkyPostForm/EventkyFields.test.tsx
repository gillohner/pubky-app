import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useForm, useWatch } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import type { EventkyPostFormData } from '@/hooks/useEventkyPostForm/useEventkyPostForm.types';
import { getEventkyFormDefaults } from '@/hooks/useEventkyPostForm/useEventkyPostForm.utils';
import { EventkyCalendarPicker } from './EventkyCalendarPicker';
import { EventkyDateField } from './EventkyDateField';
import { EventkyDurationField } from './EventkyDurationField';
import { EventkyTimezoneField } from './EventkyTimezoneField';

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string }) => unknown) => selector({ currentUserPubky: 'owner' }),
}));
vi.mock('@/hooks/useEventkyCalendar/useEventkyCalendars', () => ({
  useEventkyCalendars: () => ({
    calendars: [
      { id: 'owner:one', uri: 'pubky://owner/one', name: 'Community', calendar: {} },
      { id: 'other:two', uri: 'pubky://other/two', name: 'Workshops', calendar: { contributors: ['owner'] } },
      { id: 'other:three', uri: 'pubky://other/three', name: 'Private curation', calendar: {} },
    ],
    isLoading: false,
    hasMore: false,
    loadMore: vi.fn(),
  }),
}));
function Harness({ kind }: { kind: 'date' | 'timezone' | 'calendars' | 'duration' }) {
  const form = useForm<EventkyPostFormData>({
    defaultValues: { ...getEventkyFormDefaults('event'), startDate: '2026-09-09', timezone: 'Europe/Zurich' },
  });
  const state = { form };
  const values = useWatch({ control: form.control });
  return (
    <>
      {kind === 'duration' ? (
        <EventkyDurationField state={state} />
      ) : kind === 'date' ? (
        <EventkyDateField state={state} name="startDate" label="Start date" type="date" />
      ) : kind === 'timezone' ? (
        <EventkyTimezoneField state={state} />
      ) : (
        <EventkyCalendarPicker state={state} />
      )}
      <output data-testid="value">{JSON.stringify(values)}</output>
    </>
  );
}
describe('Eventky authoring fields', () => {
  it('serializes friendly hours and minutes as an RFC duration', () => {
    render(<Harness kind="duration" />);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Hours' }), { target: { value: '2' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Minutes' }), { target: { value: '30' } });
    expect(screen.getByTestId('value')).toHaveTextContent('"duration":"PT2H30M0S"');
  });

  it('selects a civil date without shifting it through UTC', async () => {
    render(<Harness kind="date" />);
    fireEvent.click(screen.getByRole('button', { name: 'Start date' }));
    fireEvent.click(screen.getByRole('button', { name: /Thursday, September 10th, 2026/ }));
    await waitFor(() => expect(screen.getByTestId('value')).toHaveTextContent('"startDate":"2026-09-10"'));
  });
  it('searches and selects the event timezone', async () => {
    render(<Harness kind="timezone" />);
    fireEvent.click(screen.getByRole('button', { name: 'Event timezone' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search timezones' }), { target: { value: 'Tokyo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Asia/Tokyo' }));
    await waitFor(() => expect(screen.getByTestId('value')).toHaveTextContent('"timezone":"Asia/Tokyo"'));
  });
  it('offers only owned or contributed calendars and stores their selected identity', () => {
    render(<Harness kind="calendars" />);
    expect(screen.queryByText('Private curation')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Workshops' }));
    expect(screen.getByTestId('value')).toHaveTextContent('pubky://other/two');
    expect(screen.queryByPlaceholderText(/pubky:\/\//)).not.toBeInTheDocument();
  });
});
