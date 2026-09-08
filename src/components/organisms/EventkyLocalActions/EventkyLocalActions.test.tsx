import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectionPostUri } from '@/test/fixtures/eventkyProjection';
import { EventkyLocalActions } from './EventkyLocalActions';

const { preferences, copyToClipboard } = vi.hoisted(() => ({
  preferences: {
    subscriptions: [] as string[],
    reminders: [] as Array<{ postUri: string; occurrenceKey?: string }>,
    toggleCalendar: vi.fn(),
    toggleReminder: vi.fn(),
  },
  copyToClipboard: vi.fn(),
}));
vi.mock('@/hooks/useEventkyPreferences/useEventkyPreferences', () => ({ useEventkyPreferences: () => preferences }));
vi.mock('@/hooks/useCopyToClipboard/useCopyToClipboard', () => ({ useCopyToClipboard: () => ({ copyToClipboard }) }));

beforeEach(() => {
  vi.clearAllMocks();
  preferences.subscriptions = [];
  preferences.reminders = [];
});

describe('EventkyLocalActions', () => {
  it('keeps showing a calendar distinct from copying its public subscription link', () => {
    const onCardClick = vi.fn();
    render(
      <div onClick={onCardClick}>
        <EventkyLocalActions kind="calendar" postUri={projectionPostUri} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show this calendar' }));
    expect(preferences.toggleCalendar).toHaveBeenCalledWith(projectionPostUri);
    expect(copyToClipboard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe in calendar app' }));
    expect(copyToClipboard).toHaveBeenCalledWith(
      `${window.location.origin}/api/eventky/calendar.ics?calendar=${encodeURIComponent(projectionPostUri)}`,
    );
    expect(preferences.toggleCalendar).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/public feed link that stays updated/)).toBeInTheDocument();
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it('targets an explicit recurrence identity and allows turning off a cancelled reminder', () => {
    preferences.reminders = [{ postUri: projectionPostUri, occurrenceKey: 'original-occurrence' }];
    render(
      <EventkyLocalActions kind="event" postUri={projectionPostUri} occurrenceKey="original-occurrence" cancelled />,
    );
    const button = screen.getByRole('button', { name: 'Turn off reminder' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(preferences.toggleReminder).toHaveBeenCalledWith(projectionPostUri, 'original-occurrence');
    expect(screen.getByText(/this occurrence/)).toBeInTheDocument();
  });

  it('does not enable reminders for cancelled events', () => {
    render(<EventkyLocalActions kind="event" postUri={projectionPostUri} cancelled />);
    expect(screen.getByRole('button', { name: 'Remind me' })).toBeDisabled();
  });
});
