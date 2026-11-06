'use client';

import { ChevronLeft, ChevronRight, X } from 'lucide-react';
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
 * not navigate away from the post being written. While the text holds several links that can be
 * embedded, the line also shows which one is embedded ("1 / 3") with ‹ › to embed another.
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

  const { url, onRemove, choice, onPrevious, onNext } = props;
  const position = choice && choice.count > 1 ? choice : null;

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
        <Typography size="sm" className="min-w-0 truncate text-muted-foreground" title={url}>
          Embedded link · {url.replace(/^https?:\/\//, '')}
        </Typography>
        {position && (
          <Container
            overrideDefaults
            role="group"
            aria-label={`Link ${position.index + 1} of ${position.count}`}
            data-testid="post-input-link-embed-choice"
            className="ml-auto flex shrink-0 items-center"
          >
            <Button
              variant="ghost"
              size="icon"
              onClick={onPrevious}
              disabled={disabled}
              aria-label="Embed the previous link"
              data-cy="post-input-link-embed-previous"
              className="size-8"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Typography
              as="span"
              size="xs"
              className="text-muted-foreground tabular-nums"
              aria-live="polite"
              aria-atomic="true"
              data-testid="post-input-link-embed-position"
            >
              {`${position.index + 1} / ${position.count}`}
            </Typography>
            <Button
              variant="ghost"
              size="icon"
              onClick={onNext}
              disabled={disabled}
              aria-label="Embed the next link"
              data-cy="post-input-link-embed-next"
              className="size-8"
            >
              <ChevronRight className="size-4" />
            </Button>
          </Container>
        )}
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
