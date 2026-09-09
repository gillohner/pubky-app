import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventkyAttendance } from './EventkyAttendance';

const { state } = vi.hoisted(() => ({
  state: {
    status: 'ACCEPTED',
    counts: { ACCEPTED: 2, TENTATIVE: 1, DECLINED: 1 },
    busy: false,
    loading: false,
    failed: false,
    complete: true,
    signedIn: true,
    respond: vi.fn(),
  },
}));
vi.mock('@/hooks/useEventkyAttendance/useEventkyAttendance', () => ({ useEventkyAttendance: () => state }));
beforeEach(() => {
  state.signedIn = true;
  state.complete = true;
  vi.clearAllMocks();
});
describe('native RSVP controls', () => {
  it('uses selected buttons and stops post-card navigation', () => {
    const navigate = vi.fn();
    render(
      <div onClick={navigate}>
        <EventkyAttendance postId="author:event" eventUid="uid" />
      </div>,
    );
    expect(screen.getByRole('button', { name: 'Going' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Maybe' }));
    expect(state.respond).toHaveBeenCalledWith('TENTATIVE');
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByText('Your response is public.')).toBeInTheDocument();
  });
  it('disables cancelled events and anonymous responses', () => {
    state.signedIn = false;
    render(<EventkyAttendance postId="author:event" eventUid="uid" cancelled />);
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    expect(screen.getByText('Sign in to respond.')).toBeInTheDocument();
  });
  it('clearly labels incomplete counts', () => {
    state.complete = false;
    render(<EventkyAttendance postId="author:event" eventUid="uid" />);
    expect(screen.getByText(/Partial results/)).toBeInTheDocument();
  });
});
