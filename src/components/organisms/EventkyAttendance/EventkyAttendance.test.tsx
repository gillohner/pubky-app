import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventkyAttendance } from './EventkyAttendance';

const { state } = vi.hoisted(() => ({
  state: {
    status: 'ACCEPTED',
    attendees: [
      { author: 'alice', status: 'ACCEPTED' },
      { author: 'bob', status: 'TENTATIVE' },
      { author: 'chris', status: 'DECLINED' },
    ],
    hasMore: false,
    loadMore: vi.fn(),
    refresh: vi.fn(),
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
vi.mock('@/hooks/useUserDetailsFromIds/useUserDetailsFromIds', () => ({
  useUserDetailsFromIds: () => ({
    users: [
      { id: 'alice', name: 'Alice' },
      { id: 'bob', name: 'Bob' },
      { id: 'chris', name: 'Chris' },
    ],
  }),
}));
vi.mock('@/organisms/AvatarWithFallback/AvatarWithFallback', () => ({
  AvatarWithFallback: ({ name }: { name: string }) => <span aria-hidden="true">{name}</span>,
}));
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
    for (const name of ['Going', 'Maybe', "Can't go"])
      expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'View attendees' })).not.toBeDisabled();
    expect(screen.getByText('Sign in to respond.')).toBeInTheDocument();
  });
  it('clearly labels incomplete counts', () => {
    state.complete = false;
    render(<EventkyAttendance postId="author:event" eventUid="uid" />);
    expect(screen.getByText(/Partial results/)).toBeInTheDocument();
  });
});

it('opens current attendees grouped by status without showing declined people on the card', () => {
  render(<EventkyAttendance postId="author:event" eventUid="uid" recurring />);
  expect(screen.getByText('Whole series')).toBeInTheDocument();
  expect(screen.queryByText('Chris')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View attendees' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByRole('list', { name: 'Going attendees' }).querySelectorAll('a')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: "Can't go (1)" }));
  expect(screen.getByRole('list', { name: "Can't go attendees" }).querySelectorAll('a')).toHaveLength(1);
});
