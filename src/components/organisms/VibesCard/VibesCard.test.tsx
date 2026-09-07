import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFeatureDiscoveryStorageKey } from '@/config/featureDiscovery';
import { VIBES_ALERT_STORAGE_ID, VIBES_URL } from '@/config/vibes';
import { VibesCard } from './VibesCard';

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string }) => unknown) =>
    selector({ currentUserPubky: 'vibes-test-user' }),
}));

beforeEach(() => localStorage.clear());

describe('VibesCard', () => {
  it('renders the exact copy and opens Vibes in a new tab', () => {
    render(<VibesCard />);
    expect(screen.getByRole('heading', { name: 'Experimental' })).toBeInTheDocument();
    expect(screen.getByText('Get a taste of the future.')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Pubky Vibes' });
    expect(link).toHaveAttribute('href', VIBES_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('stops home reminders after opening Vibes but keeps the sidebar entry available', () => {
    const { unmount } = render(<VibesCard />);
    fireEvent.click(screen.getByRole('link', { name: 'Pubky Vibes' }));
    const saved = localStorage.getItem(buildFeatureDiscoveryStorageKey('vibes-test-user', VIBES_ALERT_STORAGE_ID));
    expect(JSON.parse(saved!)).toMatchObject({ tried: true });
    expect(screen.getByRole('link', { name: 'Pubky Vibes' })).toBeInTheDocument();
    unmount();
    render(<VibesCard />);
    expect(screen.getByRole('link', { name: 'Pubky Vibes' })).toBeInTheDocument();
  });
});

describe('VibesCard - Snapshots', () => {
  it('matches the permanent sidebar entry', () => {
    const { container } = render(<VibesCard />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
