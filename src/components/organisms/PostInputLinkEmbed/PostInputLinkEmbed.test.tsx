import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useIsPostPreviewNavigable } from '@/molecules/PostPreviewCard/PostPreviewNestingContext';
import { PostInputLinkEmbed } from './PostInputLinkEmbed';

// The link preview itself is covered by PostLinkEmbeds' own tests
vi.mock('@/molecules/PostLinkEmbeds/PostLinkEmbeds', () => ({
  PostLinkEmbeds: function MockPostLinkEmbeds({ url, isComposing }: { url?: string | null; isComposing?: boolean }) {
    const navigable = useIsPostPreviewNavigable();
    return (
      <div
        data-testid="post-link-embeds"
        data-url={url ?? ''}
        data-navigable={String(navigable)}
        data-composing={String(isComposing ?? false)}
      />
    );
  },
}));

const URL = 'https://en.wikipedia.org/wiki/Bitcoin';

describe('PostInputLinkEmbed', () => {
  it('shows the preview of the embedded link under a label', () => {
    render(<PostInputLinkEmbed url={URL} onRemove={vi.fn()} />);

    expect(screen.getByRole('group', { name: 'Embedded link' })).toBeInTheDocument();
    expect(screen.getByText('Embedded link · en.wikipedia.org/wiki/Bitcoin')).toBeInTheDocument();
    expect(screen.getByTestId('post-link-embeds')).toHaveAttribute('data-url', URL);
  });

  it('shows the card as the post will, not inside a second frame', () => {
    render(<PostInputLinkEmbed url={URL} onRemove={vi.fn()} />);

    const group = screen.getByRole('group', { name: 'Embedded link' });
    // Only the label line and the preview, with no Card or surface of its own around them
    expect(group.children).toHaveLength(2);
    expect(group.lastElementChild).toBe(screen.getByTestId('post-link-embeds'));
    expect(group.querySelector('[data-slot="card"]')).toBeNull();
    expect(group.className).not.toMatch(/\b(bg-|border|rounded|p-|px-|py-)/);
  });

  it('keeps the preview from navigating away from the composer', () => {
    render(<PostInputLinkEmbed url={URL} onRemove={vi.fn()} />);

    expect(screen.getByTestId('post-link-embeds')).toHaveAttribute('data-navigable', 'false');
  });

  it('shows the card without its action row and tag bar, as a post being written', () => {
    render(<PostInputLinkEmbed url={URL} onRemove={vi.fn()} />);

    expect(screen.getByTestId('post-link-embeds')).toHaveAttribute('data-composing', 'true');
  });

  it('removes the embed from its button', () => {
    const onRemove = vi.fn();
    render(<PostInputLinkEmbed url={URL} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove embedded link' }));

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('disables removing while the post is published', () => {
    const onRemove = vi.fn();
    render(<PostInputLinkEmbed url={URL} onRemove={onRemove} disabled />);

    const button = screen.getByRole('button', { name: 'Remove embedded link' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onRemove).not.toHaveBeenCalled();
  });

  describe('once removed', () => {
    it('says the link is not embedded, with no preview of its own', () => {
      render(<PostInputLinkEmbed isRemoved onRestore={vi.fn()} />);

      expect(screen.getByTestId('post-input-link-embed-removed')).toHaveTextContent('Link not embedded');
      expect(screen.queryByTestId('post-link-embeds')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Remove embedded link' })).not.toBeInTheDocument();
    });

    it('embeds the link again from its button', () => {
      const onRestore = vi.fn();
      render(<PostInputLinkEmbed isRemoved onRestore={onRestore} />);

      fireEvent.click(screen.getByRole('button', { name: 'Embed again' }));

      expect(onRestore).toHaveBeenCalledTimes(1);
    });

    it('disables embedding again while the post is published', () => {
      render(<PostInputLinkEmbed isRemoved onRestore={vi.fn()} disabled />);

      expect(screen.getByRole('button', { name: 'Embed again' })).toBeDisabled();
    });
  });
});
