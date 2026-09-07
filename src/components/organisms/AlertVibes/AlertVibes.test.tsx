import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VIBES_URL } from '@/config/vibes';
import { AlertVibes } from './AlertVibes';

const state = vi.hoisted(() => ({ showVibesAlert: true, tryVibes: vi.fn(), remindLater: vi.fn() }));
vi.mock('@/hooks/useVibesAlert/useVibesAlert', () => ({ useVibesAlert: () => state }));

beforeEach(() => {
  state.showVibesAlert = true;
  vi.clearAllMocks();
});

describe('AlertVibes', () => {
  it('opens Vibes in a new tab and records Try from either link', () => {
    render(<AlertVibes />);

    const links = [
      screen.getByRole('link', { name: 'vibes.pubky.app' }),
      screen.getByRole('link', { name: 'Try now' }),
    ];
    for (const link of links) {
      expect(link).toHaveAttribute('href', VIBES_URL);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }

    fireEvent.click(links[0]);
    expect(state.tryVibes).toHaveBeenCalledOnce();
    state.tryVibes.mockClear();
    fireEvent.click(links[1]);
    expect(state.tryVibes).toHaveBeenCalledOnce();
  });

  it('snoozes when Later is clicked', () => {
    render(<AlertVibes />);
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(state.remindLater).toHaveBeenCalledOnce();
    expect(state.tryVibes).not.toHaveBeenCalled();
  });

  it('renders nothing while dismissed', () => {
    state.showVibesAlert = false;
    const { container } = render(<AlertVibes />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('AlertVibes - Snapshots', () => {
  it('matches the visible alert', () => {
    const { container } = render(<AlertVibes />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
