import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getResourceRoute } from '@/app/routes';
import type { TOtherLink, TOtherLinkTags } from '@/hooks/useOtherLinkTags/useOtherLinkTags.types';
import type { NexusTag } from '@/services/nexus/nexus.types';
import { OTHER_TAGS_LABEL, ResourceOtherTags } from './ResourceOtherTags';

const mocks = vi.hoisted(() => ({ reads: [] as TOtherLinkTags[], links: null as TOtherLink[] | null }));

vi.mock('@/hooks/useOtherLinkTags/useOtherLinkTags', () => ({
  useOtherLinkTags: (links: TOtherLink[]) => {
    mocks.links = links;
    return { reads: mocks.reads, isLoading: false };
  },
}));
vi.mock('@/hooks/useEnrichedTags/useEnrichedTags', () => ({
  useEnrichedTags: (tags: unknown[]) => ({ enrichedTags: tags, isLoading: false }),
}));
vi.mock('@/molecules/PostTagPopoverWrapper/TaggerAvatar/TaggerAvatar', () => ({
  TaggerAvatar: ({ tagger }: { tagger: { id: string } }) => <span data-testid="tagger-avatar">{tagger.id}</span>,
}));

const NETFLIX: TOtherLink = { uri: 'https://www.netflix.com/title/20557937', name: 'Netflix' };
const TMDB: TOtherLink = { uri: 'https://www.themoviedb.org/movie/603', name: 'TMDB' };

const tag = (label: string, taggers: string[]): NexusTag => ({
  label,
  taggers,
  taggers_count: taggers.length,
  relationship: false,
  tag_uri: null,
});

// Captured from Nexus staging `GET /v0/resource/by-uri` for The Matrix's Netflix and TMDB links on
// 2026-11-05 (taggers shortened; the TMDB `film` count trimmed to the taggers listed).
const MATRIX_READS: TOtherLinkTags[] = [
  { link: NETFLIX, tags: [tag('film', ['ann']), tag('movie', ['ann']), tag('netflix', ['ann'])] },
  {
    link: TMDB,
    tags: [tag('film', ['ann', 'bob', 'cy', 'dee', 'eve']), tag('scifi', ['bob', 'cy']), tag('tmdb', ['bob'])],
  },
];

const chips = () => within(screen.getByTestId('resource-other-tags')).getAllByTestId('resource-other-tag');

describe('ResourceOtherTags', () => {
  beforeEach(() => {
    mocks.reads = MATRIX_READS;
    mocks.links = null;
  });

  it('reads the links it is given and shows one chip per label, each tagger counted once', () => {
    const links = [NETFLIX, TMDB];
    render(<ResourceOtherTags links={links} />);

    expect(mocks.links).toBe(links);
    expect(screen.getByTestId('resource-other-tags-label')).toHaveTextContent(OTHER_TAGS_LABEL);
    expect(screen.getByRole('group', { name: OTHER_TAGS_LABEL })).toBeInTheDocument();
    expect(chips().map((chip) => chip.textContent)).toEqual(['film5', 'scifi2', 'movie1', 'netflix1', 'tmdb1']);
    expect(chips()[0]).toHaveAccessibleName('film, tagged by 5 people on TMDB, Netflix');
    expect(chips()[2]).toHaveAccessibleName('movie, tagged by 1 person on Netflix');
  });

  it('says when the count is a lower bound: Nexus listed fewer taggers than it counts', () => {
    mocks.reads = [{ link: TMDB, tags: [{ ...tag('film', ['ann', 'bob']), taggers_count: 9 }] }];
    render(<ResourceOtherTags links={[TMDB]} />);

    expect(chips()[0]).toHaveAccessibleName('film, tagged by at least 9 people on TMDB');
  });

  it('is display only: no add control, and a chip opens a popover rather than toggling', () => {
    render(<ResourceOtherTags links={[NETFLIX, TMDB]} />);

    expect(screen.queryByRole('button', { name: 'Add new tag' })).not.toBeInTheDocument();
    for (const chip of chips()) {
      expect(chip).not.toHaveAttribute('aria-pressed');
      expect(chip).toHaveAttribute('aria-haspopup', 'dialog');
      expect(chip).toHaveAttribute('aria-expanded', 'false');
    }
  });

  it('gives focus back to the chip when its popover is closed with Escape', async () => {
    render(<ResourceOtherTags links={[NETFLIX, TMDB]} />);

    const chip = chips()[0];
    chip.focus();
    fireEvent.click(chip);
    const menu = screen.getByTestId('resource-other-tag-menu');
    fireEvent.keyDown(menu, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByTestId('resource-other-tag-menu')).not.toBeInTheDocument());
    expect(chip).toHaveFocus();
    expect(chip).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens who tagged a chip and the services it is on, each opening that link’s page', () => {
    render(<ResourceOtherTags links={[NETFLIX, TMDB]} />);

    fireEvent.click(chips()[0]);
    const menu = screen.getByTestId('resource-other-tag-menu');
    expect(chips()[0]).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(menu)
        .getAllByTestId('tagger-avatar')
        .map((avatar) => avatar.textContent),
    ).toEqual(['ann', 'bob', 'cy', 'dee']);
    expect(within(menu).getByText('+1')).toBeInTheDocument();
    const sources = within(within(menu).getByTestId('resource-other-tag-sources')).getAllByRole('link');
    expect(sources.map((link) => link.textContent)).toEqual(['TMDB5', 'Netflix1']);
    expect(sources[0]).toHaveAttribute('href', getResourceRoute(TMDB.uri));
  });

  it('shows in a chip’s menu only the taggers and links of that label on the other links', () => {
    mocks.reads = [
      { link: NETFLIX, tags: [tag('film', ['ann']), tag('movie', ['dan'])] },
      { link: TMDB, tags: [tag('movie', ['eve'])] },
    ];
    render(<ResourceOtherTags links={[NETFLIX, TMDB]} />);

    fireEvent.click(chips().find((chip) => chip.textContent === 'film1')!);
    const menu = screen.getByTestId('resource-other-tag-menu');
    expect(
      within(menu)
        .getAllByTestId('tagger-avatar')
        .map((avatar) => avatar.textContent),
    ).toEqual(['ann']);
    expect(
      within(menu)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Netflix1']);
  });

  it('shows nothing when the other links have no tags', () => {
    mocks.reads = [];
    const { container } = render(<ResourceOtherTags links={[NETFLIX]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
