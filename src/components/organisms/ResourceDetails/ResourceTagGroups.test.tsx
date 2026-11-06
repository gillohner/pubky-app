import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { TOtherLink, TOtherLinkTags } from '@/hooks/useOtherLinkTags/useOtherLinkTags.types';
import { useResourceTags } from '@/hooks/useResourceTags/useResourceTags';
import { ResourceTagBar } from '@/organisms/ResourceActions/ResourceTagBar';
import type { NexusTag } from '@/services/nexus/nexus.types';
import { ResourceOtherTags } from './ResourceOtherTags';

// The page's two tag groups side by side, with the same label on both: each decorates its chips
// with its own taggers only. A decorator keyed by label alone would show one link's taggers on the
// other group's chip.

const LETTERBOXD = 'https://letterboxd.com/film/the-matrix/';
const NETFLIX: TOtherLink = { uri: 'https://www.netflix.com/title/20557937', name: 'Netflix' };

const tag = (label: string, taggers: string[]): NexusTag => ({
  label,
  taggers,
  taggers_count: taggers.length,
  relationship: false,
  tag_uri: null,
});

const mocks = vi.hoisted(() => ({
  ownTags: [] as NexusTag[],
  otherReads: [] as TOtherLinkTags[],
  ownTagsUri: null as string | null,
}));

vi.mock('@/hooks/useRequireAuth/useRequireAuth', () => ({
  useRequireAuth: () => ({ isAuthenticated: true, requireAuth: (action: () => unknown) => action() }),
}));
vi.mock('@/hooks/useResourceTags/useResourceTags', () => ({
  useResourceTags: (uri: string) => {
    mocks.ownTagsUri = uri;
    return { tags: mocks.ownTags, isLoading: false, isError: false, addTag: vi.fn(), toggleTag: vi.fn() };
  },
}));
vi.mock('@/hooks/useOtherLinkTags/useOtherLinkTags', () => ({
  useOtherLinkTags: () => ({ reads: mocks.otherReads, isLoading: false }),
}));
vi.mock('@/hooks/useEnrichedTags/useEnrichedTags', () => ({
  useEnrichedTags: (tags: unknown[]) => ({ enrichedTags: tags, isLoading: false }),
}));
// The own bar's hover avatars, as the taggers it is given.
vi.mock('@/molecules/PostTagPopoverWrapper/PostTagPopoverWrapper', () => ({
  PostTagPopoverWrapper: ({ taggers, children }: { taggers: { id: string }[]; children: ReactNode }) => (
    <span data-testid="own-tag-taggers" data-ids={taggers.map((tagger) => tagger.id).join(',')}>
      {children}
    </span>
  ),
}));
vi.mock('@/molecules/PostTagPopoverWrapper/TaggerAvatar/TaggerAvatar', () => ({
  TaggerAvatar: ({ tagger }: { tagger: { id: string } }) => <span data-testid="tagger-avatar">{tagger.id}</span>,
}));
vi.mock('@/molecules/TagInput/TagInput', () => ({ TagInput: () => null }));

// The own bar as the card's footer renders it: the zone reads the link's tags and hands them down.
function OwnTagBar({ uri, label }: { uri: string; label: string }) {
  return (
    <ResourceTagBar
      resourceTags={useResourceTags(uri)}
      label={label}
      isExpanded={false}
      isAdding={false}
      onAddingChange={vi.fn()}
    />
  );
}

describe('the resource page’s two tag groups', () => {
  it('decorate the same label with each group’s own taggers', () => {
    mocks.ownTags = [tag('film', ['ann', 'ann2'])];
    mocks.otherReads = [{ link: NETFLIX, tags: [tag('film', ['bob'])] }];
    render(
      <>
        <OwnTagBar uri={LETTERBOXD} label="Tags on this movie" />
        <ResourceOtherTags links={[NETFLIX]} />
      </>,
    );

    expect(mocks.ownTagsUri).toBe(LETTERBOXD);
    const own = within(screen.getByTestId('resource-tag-bar'));
    expect(own.getByTestId('own-tag-taggers')).toHaveAttribute('data-ids', 'ann,ann2');
    expect(own.getByRole('button', { name: /^film tag/ })).toHaveTextContent('film2');

    const other = screen.getByTestId('resource-other-tags');
    expect(within(other).queryByTestId('own-tag-taggers')).not.toBeInTheDocument();
    const chip = within(other).getByTestId('resource-other-tag');
    expect(chip).toHaveTextContent('film1');
    fireEvent.click(chip);
    const menu = screen.getByTestId('resource-other-tag-menu');
    expect(
      within(menu)
        .getAllByTestId('tagger-avatar')
        .map((avatar) => avatar.textContent),
    ).toEqual(['bob']);
    expect(
      within(menu)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Netflix1']);
  });
});
