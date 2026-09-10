'use client';
import { useState } from 'react';
import { Button } from '@/atoms/Button/Button';
import { Container } from '@/atoms/Container/Container';
import { PostThreadSpacer } from '@/atoms/PostThreadSpacer/PostThreadSpacer';
import { Typography } from '@/atoms/Typography/Typography';
import { useEventkyDiscussion } from '@/hooks/useEventkyDiscussion/useEventkyDiscussion';
import { usePostListKeyboard } from '@/hooks/usePostListKeyboard/usePostListKeyboard';
import { usePostNavigation } from '@/hooks/usePostNavigation/usePostNavigation';
import { QuickReply } from '@/organisms/QuickReply/QuickReply';
import { ReplyWithNested } from '@/organisms/ReplyWithNested/ReplyWithNested';

export function EventkyDiscussion({ postId, showQuickReply = true }: { postId: string; showQuickReply?: boolean }) {
  const discussion = useEventkyDiscussion(postId);
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? discussion.replyIds : discussion.replyIds.slice(0, 3);
  const { handlePostKeyDown } = usePostNavigation();
  const { setCardRef, onListKeyDown } = usePostListKeyboard({ cardSelector: '[data-post-list-card="true"]' });
  const moreLoaded = discussion.replyIds.length > visible.length;
  return (
    <Container overrideDefaults role="feed" aria-label="Event comments" onKeyDown={onListKeyDown}>
      {showQuickReply && (
        <>
          <PostThreadSpacer />
          <QuickReply parentPostId={postId} />
        </>
      )}
      {visible.map((id, index) => (
        <Container
          key={id}
          ref={setCardRef(index)}
          overrideDefaults
          data-post-list-card="true"
          role="article"
          aria-posinset={index + 1}
          aria-setsize={discussion.complete ? discussion.replyIds.length : -1}
          tabIndex={0}
          onKeyDown={(event) => handlePostKeyDown(id, event)}
          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ReplyWithNested
            replyId={id}
            isLastReply={index === visible.length - 1 && !moreLoaded && !discussion.hasMore}
          />
        </Container>
      ))}
      {discussion.loading && (
        <Typography size="sm" className="p-3 text-muted-foreground">
          Loading comments…
        </Typography>
      )}
      {discussion.failed && (
        <Typography size="sm" className="p-3 text-muted-foreground">
          Comments are temporarily unavailable.
        </Typography>
      )}
      {!discussion.loading && !discussion.failed && !discussion.complete && (
        <Typography size="xs" className="p-3 text-muted-foreground">
          Some comments may not be loaded yet.
        </Typography>
      )}
      {moreLoaded && (
        <Button variant="ghost" onClick={() => setExpanded(true)}>
          Show {discussion.replyIds.length - visible.length} more comments
        </Button>
      )}
      {!moreLoaded && discussion.hasMore && (
        <Button
          variant="ghost"
          disabled={discussion.loading}
          onClick={() => {
            setExpanded(true);
            void discussion.loadMore();
          }}
        >
          Load more comments
        </Button>
      )}
      {!discussion.hasMore && !discussion.complete && !discussion.loading && (
        <Button variant="ghost" onClick={discussion.refresh}>
          Retry loading comments
        </Button>
      )}
    </Container>
  );
}
