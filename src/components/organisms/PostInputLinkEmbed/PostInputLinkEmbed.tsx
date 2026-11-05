'use client';

import { X } from 'lucide-react';
import { Button } from '@/atoms/Button/Button';
import { Container } from '@/atoms/Container/Container';
import { Typography } from '@/atoms/Typography/Typography';
import { PostLinkEmbeds } from '@/molecules/PostLinkEmbeds/PostLinkEmbeds';
import { PostPreviewNavigableProvider } from '@/molecules/PostPreviewCard/PostPreviewNestingContext';
import type { PostInputLinkEmbedProps } from './PostInputLinkEmbed.types';

/**
 * The link a new post embeds, shown in the composer as the post will show it: the same external
 * resource card (or the link's own preview) in the same frame, without its action row and tag bar,
 * since there is nothing to act on yet. A line above it names the link and holds the button that
 * removes the embed; on the card's corner that button would cover the card's source. The card must
 * not navigate away from the post being written.
 *
 * Once removed, the composer shows the plain website preview readers get from the text (no resource
 * card, since the post no longer references the resource), under a line that says the link is not
 * embedded and offers to embed it again.
 */
export function PostInputLinkEmbed(props: PostInputLinkEmbedProps) {
  const disabled = props.disabled ?? false;

  if (props.isRemoved) {
    return (
      <Container
        overrideDefaults
        data-testid="post-input-link-embed-removed"
        className="flex min-w-0 items-center justify-between gap-2"
      >
        <Typography size="sm" className="min-w-0 truncate text-muted-foreground">
          Link not embedded
        </Typography>
        <Button
          variant="ghost"
          size="sm"
          onClick={props.onRestore}
          disabled={disabled}
          data-cy="post-input-link-embed-restore"
          className="shrink-0"
        >
          Embed again
        </Button>
      </Container>
    );
  }

  const { url, onRemove } = props;

  return (
    <Container
      overrideDefaults
      data-testid="post-input-link-embed"
      role="group"
      aria-label="Embedded link"
      className="flex w-full max-w-full min-w-0 flex-col gap-1"
    >
      <Container overrideDefaults className="flex min-w-0 items-center justify-between gap-2">
        {/* The link names the embed even when its preview renders nothing */}
        <Typography size="sm" className="min-w-0 truncate text-muted-foreground">
          Embedded link · {url.replace(/^https?:\/\//, '')}
        </Typography>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          disabled={disabled}
          aria-label="Remove embedded link"
          data-cy="post-input-link-embed-remove"
          className="size-8 shrink-0"
        >
          <X className="size-4" />
        </Button>
      </Container>
      <PostPreviewNavigableProvider navigable={false}>
        <PostLinkEmbeds url={url} isComposing />
      </PostPreviewNavigableProvider>
    </Container>
  );
}
