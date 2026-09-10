import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EventkyDiscussion } from './EventkyDiscussion';

const state = vi.hoisted(() => ({
  replyIds: [] as string[],
  complete: false,
  hasMore: true,
  loading: false,
  failed: false,
  loadMore: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/hooks/useEventkyDiscussion/useEventkyDiscussion', () => ({ useEventkyDiscussion: () => state }));
vi.mock('@/hooks/usePostNavigation/usePostNavigation', () => ({
  usePostNavigation: () => ({ handlePostKeyDown: vi.fn() }),
}));
vi.mock('@/hooks/usePostListKeyboard/usePostListKeyboard', () => ({
  usePostListKeyboard: () => ({ setCardRef: () => vi.fn(), onListKeyDown: vi.fn() }),
}));
vi.mock('@/organisms/QuickReply/QuickReply', () => ({ QuickReply: () => <div>Native comment composer</div> }));
vi.mock('@/organisms/ReplyWithNested/ReplyWithNested', () => ({
  ReplyWithNested: ({ replyId }: { replyId: string }) => <div>{replyId}</div>,
}));
beforeEach(() => {
  state.replyIds = [];
  state.complete = false;
  state.hasMore = true;
  vi.clearAllMocks();
});
it('retains a continuation when the bounded scan found only attendance records', () => {
  render(<EventkyDiscussion postId="owner:event" />);
  expect(screen.getByText('Native comment composer')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Load more comments' }));
  expect(state.loadMore).toHaveBeenCalled();
  expect(screen.getByText('Some comments may not be loaded yet.')).toBeInTheDocument();
});
it('shows actual comments and never gives a false complete set size', () => {
  state.replyIds = ['author:comment'];
  render(<EventkyDiscussion postId="owner:event" />);
  expect(screen.getByText('author:comment')).toBeInTheDocument();
  expect(screen.getByRole('article')).toHaveAttribute('aria-setsize', '-1');
});
