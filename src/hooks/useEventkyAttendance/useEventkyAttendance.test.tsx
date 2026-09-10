import type { AttendanceSource } from '@eventky/attendance';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEventkyAttendance } from './useEventkyAttendance';

const { auth, create, prepare, commit, fetchResponses, replyState } = vi.hoisted(() => ({
  auth: { currentUserPubky: 'y'.repeat(52) },
  create: vi.fn(),
  prepare: vi.fn(),
  commit: vi.fn(),
  fetchResponses: vi.fn(),
  replyState: { sources: [] as AttendanceSource[] },
}));
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: Object.assign((selector: (state: typeof auth) => unknown) => selector(auth), { getState: () => auth }),
}));
vi.mock('@/controllers/post/post', () => ({
  PostController: { createPostId: create, prepareCreate: prepare, commitPreparedCreate: commit },
}));
vi.mock('@/controllers/eventkyAttendance/eventkyAttendance', () => ({
  EventkyAttendanceController: { fetch: fetchResponses },
}));
vi.mock('@/hooks/useEventkyReplies/useEventkyReplies', () => ({
  useEventkyReplies: () => ({
    sources: replyState.sources,
    loading: false,
    failed: false,
    complete: true,
    hasMore: false,
    loadMore: vi.fn(),
    refresh: vi.fn(),
  }),
}));
vi.mock('@/molecules/Toaster/toast', () => ({ toast: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  replyState.sources = [];
  auth.currentUserPubky = 'y'.repeat(52);
  create.mockReturnValue('0000000000002');
  prepare.mockResolvedValue({ stable: 'prepared' });
  commit.mockResolvedValue({});
  fetchResponses.mockResolvedValue({ sources: [], complete: true });
});
describe('attendance publication', () => {
  it('publishes a native reply and immediately updates the current author status', async () => {
    const { result } = renderHook(() => useEventkyAttendance(`${'b'.repeat(52)}:0000000000001`, 'event-uid'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      expect(await result.current.respond('ACCEPTED')).toBe(true);
    });
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        authorId: auth.currentUserPubky,
        customKind: 'attendance',
        parentPostId: `${'b'.repeat(52)}:0000000000001`,
      }),
    );
    expect(JSON.parse(prepare.mock.calls[0][0].content)).toMatchObject({
      event_uid: 'event-uid',
      partstat: 'ACCEPTED',
    });
    expect(result.current.status).toBe('ACCEPTED');
    expect(result.current.counts.ACCEPTED).toBe(1);
  });
  it('retries an uncertain write with identical prepared identity and payload', async () => {
    commit.mockRejectedValueOnce(new Error('uncertain'));
    const { result } = renderHook(() => useEventkyAttendance(`${'b'.repeat(52)}:0000000000001`, 'event-uid'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      expect(await result.current.respond('TENTATIVE')).toBe(false);
    });
    await act(async () => {
      expect(await result.current.respond('DECLINED')).toBe(false);
    });
    await act(async () => {
      expect(await result.current.respond('TENTATIVE')).toBe(true);
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenNthCalledWith(2, commit.mock.calls[0][0]);
  });
  it('does not commit after the account changes during preparation', async () => {
    prepare.mockImplementation(async () => {
      auth.currentUserPubky = 'b'.repeat(52);
      return {};
    });
    const { result } = renderHook(() => useEventkyAttendance(`${'b'.repeat(52)}:0000000000001`, 'event-uid'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      expect(await result.current.respond('ACCEPTED')).toBe(false);
    });
    expect(commit).not.toHaveBeenCalled();
  });
  it('never reuses an uncertain reply for a different event or occurrence', async () => {
    commit.mockRejectedValueOnce(new Error('uncertain'));
    const first = `${'b'.repeat(52)}:0000000000001`;
    const second = `${'b'.repeat(52)}:0000000000003`;
    const { result, rerender } = renderHook(({ eventId }) => useEventkyAttendance(eventId, 'event-uid'), {
      initialProps: { eventId: first },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      expect(await result.current.respond('ACCEPTED')).toBe(false);
    });
    rerender({ eventId: second });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      expect(await result.current.respond('TENTATIVE')).toBe(true);
    });
    expect(prepare).toHaveBeenNthCalledWith(2, expect.objectContaining({ parentPostId: second }));
    expect(result.current.status).toBe('TENTATIVE');
  });
});

it('exposes one current attendee per author and preserves occurrence overrides', async () => {
  const eventId = `${'b'.repeat(52)}:0000000000001`;
  const parent = `pubky://${'b'.repeat(52)}/pub/pubky.app/posts/0000000000001`;
  const author = 'y'.repeat(52);
  const response = (id: string, status: string, occurrence = false): AttendanceSource => ({
    id, author, parent, uri: `pubky://${author}/pub/pubky.app/posts/${id}`, kind: 'attendance',
    content: JSON.stringify({ schema: 'eventky.attendance', schema_version: 1, event_uid: 'event-uid', partstat: status, dtstamp: '2026-09-09T00:00:00Z', ...(occurrence ? { recurrence_id: { type: 'date', value: '2026-10-01' } } : {}) }),
  });
  replyState.sources = [response('0000000000002', 'ACCEPTED'), response('0000000000003', 'TENTATIVE'), response('0000000000004', 'DECLINED', true)];
  const series = renderHook(() => useEventkyAttendance(eventId, 'event-uid'));
  expect(series.result.current.attendees).toEqual([{ author, status: 'TENTATIVE' }]);
  expect(series.result.current.counts.ACCEPTED).toBe(0);
  const occurrence = renderHook(() => useEventkyAttendance(eventId, 'event-uid', { type: 'date', value: '2026-10-01' }));
  expect(occurrence.result.current.attendees).toEqual([{ author, status: 'DECLINED' }]);
});
