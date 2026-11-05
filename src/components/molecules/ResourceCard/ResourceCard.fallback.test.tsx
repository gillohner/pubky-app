import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOgMetadata } from '@/hooks/useOgMetadata/useOgMetadata';
import { usePinakesGroup } from '@/hooks/usePinakesGroup/usePinakesGroup';
import mbArtistSparseFixture from '@/services/pinakes/fixtures/by-uri.mb-artist-sparse.json';
import musicRecordingFixture from '@/services/pinakes/fixtures/by-uri.music-recording.json';
import type { TPinakesCard, TPinakesGroupDetail, TPinakesResourceDetail } from '@/services/pinakes/pinakes.types';
import { ResourceCard } from './ResourceCard';

vi.mock('@/hooks/usePinakesGroup/usePinakesGroup', () => ({ usePinakesGroup: vi.fn() }));
vi.mock('@/hooks/useOgMetadata/useOgMetadata', () => ({ useOgMetadata: vi.fn() }));

const GROUP_ID = 'g1';
const SPARSE: TPinakesResourceDetail = { ...mbArtistSparseFixture, group: { id: GROUP_ID, size: 3 } };

function member(overrides: Partial<TPinakesCard>): TPinakesCard {
  return {
    id: 'm',
    uri: 'https://tidal.com/artist/7429906',
    status: 'ok',
    type: 'Person',
    type_path: ['Thing', 'Person'],
    site: 'TIDAL',
    also_on: [],
    open_in: [],
    refs: [],
    collections: 0,
    ...overrides,
  };
}

function group(members: TPinakesCard[]): TPinakesGroupDetail {
  return { id: GROUP_ID, curated: false, keys: [], members: [SPARSE, ...members] };
}

describe('ResourceCard: a sparse card borrows from its group', () => {
  const mockGroup = vi.mocked(usePinakesGroup);

  const mockOg = vi.mocked(useOgMetadata);

  beforeEach(() => {
    vi.clearAllMocks();
    mockGroup.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    mockOg.mockReturnValue({ metadata: null, isLoading: false, error: null });
  });

  it('never shows less than the link’s own preview: its image and title fill what the card lacks', () => {
    mockOg.mockReturnValue({
      metadata: {
        url: 'musicbrainz.org',
        title: 'Sefa - MusicBrainz',
        image: 'https://example.org/og.png',
        type: 'website',
      },
      isLoading: false,
      error: null,
    });
    render(<ResourceCard card={{ ...SPARSE, group: null, name: null }} />);

    expect(mockOg).toHaveBeenCalledWith(SPARSE.uri);
    expect(screen.getByTestId('resource-card-image')).toHaveAttribute('src', 'https://example.org/og.png');
    expect(screen.getByTestId('resource-card-title')).toHaveTextContent('Sefa - MusicBrainz');
  });

  const OG_IMAGE = 'https://example.org/og.png';
  const withOg = (title: string | null = 'Sefa - MusicBrainz') =>
    mockOg.mockReturnValue({
      metadata: { url: 'musicbrainz.org', title, image: OG_IMAGE, type: 'website' },
      isLoading: false,
      error: null,
    });

  it('prefers a group member’s image to the OG one, and waits for the group before asking for OG', () => {
    withOg();
    mockGroup.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { rerender } = render(<ResourceCard card={SPARSE} />);
    expect(mockOg).not.toHaveBeenCalledWith(expect.any(String));

    mockGroup.mockReturnValue({
      data: group([member({ id: 'b', image: 'https://resources.tidal.com/images/sefa.jpg' })]),
      isLoading: false,
      isError: false,
    });
    rerender(<ResourceCard card={SPARSE} />);
    expect(screen.getByTestId('resource-card-image')).toHaveAttribute(
      'src',
      'https://resources.tidal.com/images/sefa.jpg',
    );
    expect(mockOg).not.toHaveBeenCalledWith(expect.any(String));
  });

  it('shows the type icon when the OG image fails to load', () => {
    withOg();
    render(<ResourceCard card={{ ...SPARSE, group: null }} />);

    fireEvent.error(screen.getByTestId('resource-card-image'));

    expect(screen.queryByTestId('resource-card-image')).not.toBeInTheDocument();
    expect(screen.getByTestId('resource-card-type-tile')).toBeInTheDocument();
  });

  it('attaches no credit or “Image:” note to the OG image', () => {
    withOg();
    render(<ResourceCard card={{ ...SPARSE, group: null, credits: [] }} />);

    expect(screen.getByTestId('resource-card-image')).toHaveAttribute('src', OG_IMAGE);
    expect(screen.queryByTestId('resource-credits')).not.toBeInTheDocument();
  });

  it('titles a nameless card with its link when there is no OG title', () => {
    withOg(null);
    render(<ResourceCard card={{ ...SPARSE, group: null, name: '  ' }} />);

    expect(screen.getByTestId('resource-card-title')).toHaveTextContent(
      'musicbrainz.org/artist/b5416a54-4941-4fcf-b2a0-7f98da6f9344',
    );
  });

  it('shows its own Wikimedia image without a credit, reading no link preview for it', () => {
    const image = 'https://upload.wikimedia.org/wikipedia/commons/4/46/Bitcoin.svg';
    withOg(null);
    render(<ResourceCard card={{ ...SPARSE, group: null, image, credits: [] }} />);

    expect(screen.getByTestId('resource-card-image')).toHaveAttribute('src', image);
    expect(mockOg).toHaveBeenLastCalledWith(null);
  });

  it('does not read the preview of a card that has its title and image, or of a gone link', () => {
    const { unmount } = render(<ResourceCard card={{ ...musicRecordingFixture }} />);
    expect(mockOg).toHaveBeenLastCalledWith(null);
    unmount();

    render(<ResourceCard card={{ ...SPARSE, group: null, status: 'missing' }} />);
    expect(mockOg).toHaveBeenLastCalledWith(null);
  });

  it('shows another member’s image and description, each named by its service', () => {
    mockGroup.mockReturnValue({
      data: group([
        member({ id: 'a', uri: 'https://open.spotify.com/artist/x', site: 'Spotify', description: 'Dutch DJ.' }),
        member({ id: 'b', image: 'https://resources.tidal.com/images/sefa.jpg' }),
      ]),
      isLoading: false,
      isError: false,
    });
    render(<ResourceCard card={SPARSE} />);

    expect(mockGroup).toHaveBeenCalledWith(GROUP_ID);
    expect(screen.getByTestId('resource-card-image')).toHaveAttribute(
      'src',
      'https://resources.tidal.com/images/sefa.jpg',
    );
    expect(screen.getByTestId('resource-card-description')).toHaveTextContent('Dutch DJ.');
    expect(screen.getByTestId('resource-card-description')).toHaveAttribute('data-borrowed', 'true');
    expect(screen.getByTestId('resource-credits')).toHaveTextContent('Sources: Text: Spotify · Image: TIDAL');
    expect(screen.getByRole('link', { name: 'TIDAL' })).toHaveAttribute('href', 'https://tidal.com/artist/7429906');
  });

  it('prefers a member of its own type, and skips members that are not ok', () => {
    mockGroup.mockReturnValue({
      data: group([
        member({ id: 'x', type: 'MusicAlbum', site: 'Deezer', image: 'https://e-cdns-images.dzcdn.net/album.jpg' }),
        member({ id: 'y', status: 'missing', image: 'https://resources.tidal.com/images/gone.jpg' }),
        member({ id: 'z', image: 'https://resources.tidal.com/images/sefa.jpg' }),
      ]),
      isLoading: false,
      isError: false,
    });
    render(<ResourceCard card={SPARSE} />);

    expect(screen.getByTestId('resource-card-image')).toHaveAttribute(
      'src',
      'https://resources.tidal.com/images/sefa.jpg',
    );
  });

  it('borrows a Wikimedia image without its credit too', () => {
    mockGroup.mockReturnValue({
      data: group([member({ id: 'w', image: 'https://upload.wikimedia.org/wikipedia/commons/a/a.jpg' })]),
      isLoading: false,
      isError: false,
    });
    render(<ResourceCard card={SPARSE} />);

    expect(screen.getByTestId('resource-card-image')).toHaveAttribute(
      'src',
      'https://upload.wikimedia.org/wikipedia/commons/a/a.jpg',
    );
    expect(screen.queryByTestId('resource-card-type-tile')).not.toBeInTheDocument();
    expect(screen.getByTestId('resource-credits')).toHaveTextContent('Image: TIDAL');
  });

  it('takes a member’s image when its own fails to load, and the next one when that fails too', () => {
    mockGroup.mockReturnValue({
      data: group([
        member({ id: 'a', image: 'https://resources.tidal.com/images/one.jpg' }),
        member({ id: 'b', image: 'https://resources.tidal.com/images/two.jpg' }),
      ]),
      isLoading: false,
      isError: false,
    });
    const own = { ...SPARSE, image: 'https://example.org/own.jpg', description: 'Own text.' };
    render(<ResourceCard card={own} />);

    expect(screen.getByTestId('resource-card-image')).toHaveAttribute('src', own.image);
    fireEvent.error(screen.getByTestId('resource-card-image'));
    expect(screen.getByTestId('resource-card-image')).toHaveAttribute(
      'src',
      'https://resources.tidal.com/images/one.jpg',
    );
    fireEvent.error(screen.getByTestId('resource-card-image'));
    expect(screen.getByTestId('resource-card-image')).toHaveAttribute(
      'src',
      'https://resources.tidal.com/images/two.jpg',
    );
    fireEvent.error(screen.getByTestId('resource-card-image'));
    expect(screen.getByTestId('resource-card-type-tile')).toBeInTheDocument();
  });

  it('does not read a group of one', () => {
    render(<ResourceCard card={{ ...SPARSE, group: { id: GROUP_ID, size: 1 } }} />);

    expect(mockGroup).toHaveBeenCalledWith(null);
  });

  it('does not read the group of a card that has its own description and image', () => {
    render(<ResourceCard card={{ ...musicRecordingFixture, group: { id: GROUP_ID, size: 2 } }} />);

    expect(mockGroup).toHaveBeenCalledWith(null);
  });
});
