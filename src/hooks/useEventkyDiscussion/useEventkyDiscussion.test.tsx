import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useEventkyDiscussion } from './useEventkyDiscussion';

vi.mock('@/hooks/useEventkyReplies/useEventkyReplies', () => ({
  useEventkyReplies: () => ({
    sources: [
      { id: 'status', author: 'alice', kind: 'attendance' },
      { id: 'comment', author: 'bob', kind: 'short' },
      { id: 'comment', author: 'bob', kind: 'short' },
      { id: 'muted', author: 'muted', kind: 'short' },
    ],
    complete: true,
  }),
}));
vi.mock('@/hooks/useMutedUsers/useMutedUsers', () => ({
  useMutedUsers: () => ({ mutedUserIdSet: new Set(['muted']) }),
}));
it('keeps unique real comments while excluding all status history and muted replies', () => {
  const { result } = renderHook(() => useEventkyDiscussion('owner:event'));
  expect(result.current.replyIds).toEqual(['bob:comment']);
});
