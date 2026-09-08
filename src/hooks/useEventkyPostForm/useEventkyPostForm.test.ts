import { CALENDAR_FIXTURE, EVENT_FIXTURE, FIXTURE_OWNER } from '@eventky/fixtures';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientErrorCode, ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { useEventkyPostForm } from './useEventkyPostForm';

const mocks = vi.hoisted(() => ({
  createPostId: vi.fn(),
  prepareCreate: vi.fn(),
  commitPreparedCreate: vi.fn(),
  prepareEdit: vi.fn(),
  commitPreparedEdit: vi.fn(),
  fetchSource: vi.fn(),
  enabled: true,
  toast: vi.fn(),
  author: 'y'.repeat(52) as string | null,
}));
vi.mock('@/controllers/post/post', () => ({ PostController: mocks }));
vi.mock('@/libs/runtime-config/runtime-config', () => ({ getEventkyEnabled: () => mocks.enabled }));
vi.mock('@/molecules/Toaster/toast', () => ({ toast: mocks.toast }));
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: Object.assign(
    (selector: (value: { currentUserPubky: string | null }) => unknown) => selector({ currentUserPubky: mocks.author }),
    { getState: () => ({ currentUserPubky: mocks.author }) },
  ),
}));
vi.mock('@/hooks/useEventkyAttachments/useEventkyAttachments', () => ({
  useEventkyAttachments: () => ({ ready: true, changed: false, attachments: [], editChanges: undefined }),
}));

describe('Eventky publish lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled = true;
    mocks.author = FIXTURE_OWNER;
    mocks.createPostId.mockReturnValue('0034A0X7NJ52A');
    mocks.prepareCreate.mockResolvedValue({
      compositePostId: `${FIXTURE_OWNER}:0034A0X7NJ52A`,
      fixedFiles: ['fixed-id'],
    });
    mocks.commitPreparedCreate.mockResolvedValue({
      compositePostId: `${FIXTURE_OWNER}:0034A0X7NJ52A`,
      tagsFailed: false,
    });
    mocks.prepareEdit.mockResolvedValue({ existing: 'prepared-edit' });
    mocks.commitPreparedEdit.mockResolvedValue(undefined);
    mocks.fetchSource.mockResolvedValue({ kind: 'calendar', content: JSON.stringify(CALENDAR_FIXTURE) });
  });

  it('validates before allocating or preparing a post', async () => {
    const { result } = renderHook(() => useEventkyPostForm({ kind: 'calendar' }));
    await act(async () => {
      expect(await result.current.submit()).toBeNull();
    });
    expect(mocks.createPostId).not.toHaveBeenCalled();
    expect(mocks.prepareCreate).not.toHaveBeenCalled();
  });

  it('reads current calendar policy from its source before publishing an event', async () => {
    const { result } = renderHook(() => useEventkyPostForm({ kind: 'event', source: EVENT_FIXTURE }));
    await act(async () => {
      expect(await result.current.submit()).not.toBeNull();
    });
    expect(mocks.fetchSource).toHaveBeenCalledWith({ compositeId: `${FIXTURE_OWNER}:0034A0X7NJ52A` });
    expect(mocks.prepareCreate).toHaveBeenCalledWith(expect.objectContaining({ customKind: 'event' }));
  });

  it('preserves the draft and blocks publication when the calendar excludes its post', async () => {
    mocks.fetchSource.mockResolvedValue({
      kind: 'calendar',
      content: JSON.stringify({
        ...CALENDAR_FIXTURE,
        excluded_event_uris: [`pubky://${FIXTURE_OWNER}/pub/pubky.app/posts/0034A0X7NJ52A`],
      }),
    });
    const { result } = renderHook(() => useEventkyPostForm({ kind: 'event', source: EVENT_FIXTURE }));
    await act(async () => {
      expect(await result.current.submit()).toBeNull();
    });
    expect(mocks.prepareCreate).not.toHaveBeenCalled();
    expect(result.current.form.getValues('title')).toBe(EVENT_FIXTURE.summary);
  });

  it('reuses the exact prepared payload and file identities after an uncertain save', async () => {
    mocks.commitPreparedCreate.mockRejectedValueOnce(new Error('connection interrupted'));
    const { result } = renderHook(() => useEventkyPostForm({ kind: 'calendar' }));
    act(() => result.current.form.setValue('title', 'Builders'));
    await act(async () => {
      expect(await result.current.submit()).toBeNull();
    });
    expect(result.current.pendingRetry).toBe(true);
    const firstPrepared = mocks.commitPreparedCreate.mock.calls[0][0];
    await act(async () => {
      expect(await result.current.submit()).toBe(`${FIXTURE_OWNER}:0034A0X7NJ52A`);
    });
    expect(mocks.createPostId).toHaveBeenCalledTimes(1);
    expect(mocks.prepareCreate).toHaveBeenCalledTimes(1);
    expect(mocks.commitPreparedCreate.mock.calls[1][0]).toBe(firstPrepared);
    expect(result.current.pendingRetry).toBe(false);
    expect(mocks.prepareCreate.mock.calls[0][0].customKind).toBe('calendar');
  });

  it('allows correcting a rejected draft and retains its allocated post ID', async () => {
    mocks.prepareCreate.mockRejectedValueOnce(
      Err.validation(ValidationErrorCode.INVALID_INPUT, 'Rejected', { service: ErrorService.Local, operation: 'test' }),
    );
    const { result } = renderHook(() => useEventkyPostForm({ kind: 'calendar' }));
    act(() => result.current.form.setValue('title', 'Initial'));
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.pendingRetry).toBe(false);
    act(() => result.current.form.setValue('title', 'Corrected'));
    await act(async () => {
      await result.current.submit();
    });
    expect(mocks.createPostId).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mocks.prepareCreate.mock.calls[1][0].content).name).toBe('Corrected');
  });

  it('reports tag failure as successful publication', async () => {
    mocks.commitPreparedCreate.mockResolvedValue({ compositePostId: 'published', tagsFailed: true });
    const { result } = renderHook(() => useEventkyPostForm({ kind: 'calendar' }));
    act(() => result.current.form.setValue('title', 'Builders'));
    await act(async () => {
      expect(await result.current.submit()).toBe('published');
    });
    expect(result.current.pendingRetry).toBe(false);
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining('Some tags could not be added') }),
    );
  });

  it('keeps the original edit revision when background refresh changes the supplied source', async () => {
    const initial = {
      kind: 'calendar' as const,
      source: CALENDAR_FIXTURE,
      originalContent: JSON.stringify(CALENDAR_FIXTURE),
      postId: 'owner:post',
    };
    const { result, rerender } = renderHook((options) => useEventkyPostForm(options), { initialProps: initial });
    act(() => result.current.form.setValue('title', 'My changes'));
    rerender({ ...initial, source: { ...CALENDAR_FIXTURE, sequence: 9 }, originalContent: 'newer source' });
    await act(async () => {
      await result.current.submit();
    });
    expect(mocks.prepareEdit).toHaveBeenCalledWith(
      expect.objectContaining({ expectedContent: initial.originalContent }),
    );
    const payload = JSON.parse(mocks.prepareEdit.mock.calls[0][0].content);
    expect(payload.sequence).toBe(1);
    expect(payload.uid).toBe(CALENDAR_FIXTURE.uid);
  });

  it('retains a conflicting edit without retrying over the remote changes', async () => {
    mocks.prepareEdit.mockRejectedValue(
      Err.client(ClientErrorCode.CONFLICT, 'Conflict', { service: ErrorService.Homeserver, operation: 'test' }),
    );
    const { result } = renderHook(() =>
      useEventkyPostForm({
        kind: 'calendar',
        source: CALENDAR_FIXTURE,
        originalContent: 'original',
        postId: 'owner:post',
      }),
    );
    act(() => result.current.form.setValue('title', 'My changes'));
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.hasConflict).toBe(true);
    expect(result.current.form.getValues('title')).toBe('My changes');
    await act(async () => {
      expect(await result.current.submit()).toBeNull();
    });
    expect(mocks.commitPreparedEdit).not.toHaveBeenCalled();
  });

  it('does not publish when authoring is disabled for the current backend', async () => {
    mocks.enabled = false;
    const { result } = renderHook(() => useEventkyPostForm({ kind: 'calendar' }));
    act(() => result.current.form.setValue('title', 'Builders'));
    await act(async () => {
      expect(await result.current.submit()).toBeNull();
    });
    expect(mocks.prepareCreate).not.toHaveBeenCalled();
  });

  it.each(['create', 'edit'] as const)(
    'preserves the prepared %s when the account changes before commit',
    async (kind) => {
      const prepare = kind === 'create' ? mocks.prepareCreate : mocks.prepareEdit;
      const commit = kind === 'create' ? mocks.commitPreparedCreate : mocks.commitPreparedEdit;
      const prepared = { retained: `${kind}-intent` };
      let finish: ((value: typeof prepared) => void) | undefined;
      prepare.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const options =
        kind === 'edit'
          ? {
              kind: 'calendar' as const,
              source: CALENDAR_FIXTURE,
              originalContent: JSON.stringify(CALENDAR_FIXTURE),
              postId: `${FIXTURE_OWNER}:0034A0X7NJ52A`,
            }
          : { kind: 'calendar' as const };
      const { result, rerender } = renderHook(() => useEventkyPostForm(options));
      act(() => result.current.form.setValue('title', 'Retained draft'));
      expect(result.current.form.formState.errors.root).toBeUndefined();
      let pending: Promise<string | null> | undefined;
      act(() => {
        pending = result.current.submit();
      });
      await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
      mocks.author = 'b'.repeat(52);
      rerender();
      await act(async () => {
        finish?.(prepared);
        expect(await pending).toBeNull();
      });
      expect(commit).not.toHaveBeenCalled();
      expect(result.current.pendingRetry).toBe(true);
      expect(result.current.form.formState.errors.root?.message).toBe(
        'Your account changed. Switch back to the original account to retry this draft.',
      );
      expect(result.current.form.getValues('title')).toBe('Retained draft');
      await act(async () => {
        expect(await result.current.submit()).toBeNull();
      });
      expect(commit).not.toHaveBeenCalled();
      mocks.author = FIXTURE_OWNER;
      rerender();
      await act(async () => {
        expect(await result.current.submit()).toBe(`${FIXTURE_OWNER}:0034A0X7NJ52A`);
      });
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenCalledWith(prepared);
      expect(result.current.pendingRetry).toBe(false);
    },
  );

  it('stops before preparation if sign-out happens during the calendar policy read', async () => {
    let finish: ((value: { kind: string; content: string }) => void) | undefined;
    mocks.fetchSource.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result, rerender } = renderHook(() => useEventkyPostForm({ kind: 'event', source: EVENT_FIXTURE }));
    let pending: Promise<string | null> | undefined;
    act(() => {
      pending = result.current.submit();
    });
    await waitFor(() => expect(mocks.fetchSource).toHaveBeenCalledTimes(1));
    mocks.author = null;
    // The old callback must check the store even before React renders the new account.
    await act(async () => {
      finish?.({ kind: 'calendar', content: JSON.stringify(CALENDAR_FIXTURE) });
      expect(await pending).toBeNull();
    });
    expect(mocks.prepareCreate).not.toHaveBeenCalled();
    expect(mocks.commitPreparedCreate).not.toHaveBeenCalled();
    expect(result.current.pendingRetry).toBe(false);
    mocks.author = FIXTURE_OWNER;
    rerender();
    act(() => result.current.form.setValue('title', 'Updated after sign-in'));
    await act(async () => {
      expect(await result.current.submit()).not.toBeNull();
    });
    expect(mocks.createPostId).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mocks.prepareCreate.mock.calls[0][0].content).summary).toBe('Updated after sign-in');
  });

  it('ignores double clicks throughout preparation and commit', async () => {
    const prepared = { retained: 'single-intent' };
    let finishPrepare: ((value: typeof prepared) => void) | undefined;
    let finishCommit: ((value: { compositePostId: string; tagsFailed: boolean }) => void) | undefined;
    mocks.prepareCreate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPrepare = resolve;
        }),
    );
    mocks.commitPreparedCreate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCommit = resolve;
        }),
    );
    const { result } = renderHook(() => useEventkyPostForm({ kind: 'calendar' }));
    act(() => result.current.form.setValue('title', 'Single publication'));
    let pending: Promise<string | null> | undefined;
    act(() => {
      pending = result.current.submit();
    });
    await act(async () => {
      expect(await result.current.submit()).toBeNull();
    });
    await waitFor(() => expect(mocks.prepareCreate).toHaveBeenCalledTimes(1));
    await act(async () => {
      expect(await result.current.submit()).toBeNull();
      finishPrepare?.(prepared);
    });
    await waitFor(() => expect(mocks.commitPreparedCreate).toHaveBeenCalledTimes(1));
    await act(async () => {
      expect(await result.current.submit()).toBeNull();
    });
    await act(async () => {
      finishCommit?.({ compositePostId: 'published', tagsFailed: false });
      expect(await pending).toBe('published');
    });
    expect(mocks.createPostId).toHaveBeenCalledTimes(1);
    expect(mocks.prepareCreate).toHaveBeenCalledTimes(1);
    expect(mocks.commitPreparedCreate).toHaveBeenCalledTimes(1);
  });

  it('keeps an uncertain prepared intent after an account switch during commit failure', async () => {
    let rejectCommit: ((reason: unknown) => void) | undefined;
    mocks.commitPreparedCreate.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectCommit = reject;
        }),
    );
    const { result, rerender } = renderHook(() => useEventkyPostForm({ kind: 'calendar' }));
    act(() => result.current.form.setValue('title', 'Retained uncertain draft'));
    let pending: Promise<string | null> | undefined;
    act(() => {
      pending = result.current.submit();
    });
    await waitFor(() => expect(mocks.commitPreparedCreate).toHaveBeenCalledTimes(1));
    const prepared = mocks.commitPreparedCreate.mock.calls[0][0];
    mocks.author = null;
    await act(async () => {
      rejectCommit?.(new TypeError('connection interrupted'));
      expect(await pending).toBeNull();
    });
    expect(result.current.pendingRetry).toBe(true);
    mocks.author = FIXTURE_OWNER;
    rerender();
    await act(async () => {
      expect(await result.current.submit()).not.toBeNull();
    });
    expect(mocks.prepareCreate).toHaveBeenCalledTimes(1);
    expect(mocks.commitPreparedCreate.mock.calls[1][0]).toBe(prepared);
  });
});
