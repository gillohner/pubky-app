import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnrichedPostDetails } from '@/application/moderation/moderation.types';
import { PostController } from '@/controllers/post/post';
import { useAuthStore } from '@/stores/auth/auth.store';
import {
  EMPTY_EVENTKY_PREFERENCES,
  eventkyPreferenceScope,
  useEventkyCalendarStore,
} from '@/stores/eventkyCalendar/eventkyCalendar.store';
import { eventkyEventFixture } from '@/test/fixtures/eventky';
import { projectionPostId, projectionPostUri } from '@/test/fixtures/eventkyProjection';
import { useEventkyReminders } from './useEventkyReminders';

const { backend, permission, requestPermission, constructed, closed } = vi.hoisted(() => ({
  backend: { value: 'https://nexus.example' },
  permission: { value: 'granted' as NotificationPermission },
  requestPermission: vi.fn(),
  constructed: vi.fn(),
  closed: vi.fn(),
}));
vi.mock('@/controllers/post/post', () => ({ PostController: { fetch: vi.fn(), getDetails: vi.fn() } }));
vi.mock('@/libs/eventky/sourceHash', () => ({ eventkySourceHash: async (_kind: string, content: string) => content }));
vi.mock('@/hooks/useMutedUsers/useMutedUsers', () => ({
  useMutedUsers: () => ({ mutedUserIdSet: new Set(), isLoading: false }),
}));
vi.mock('@/libs/runtime-config/runtime-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/libs/runtime-config/runtime-config')>()),
  getNexusUrl: () => backend.value,
  getEventkyCalendarEnabled: () => true,
}));
const account = 'y'.repeat(52);
const now = Date.parse('2026-10-25T17:15:00Z');
const post: EnrichedPostDetails = {
  id: projectionPostId,
  uri: projectionPostUri,
  kind: 'event',
  content: JSON.stringify(eventkyEventFixture),
  attachments: null,
  indexed_at: 1,
  is_blurred: false,
  is_moderated: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  permission.value = 'granted';
  backend.value = 'https://nexus.example';
  vi.stubGlobal(
    'Notification',
    class {
      static get permission() {
        return permission.value;
      }
      static requestPermission = requestPermission;
      close = closed;
      constructor(title: string) {
        constructed(title);
      }
    },
  );
  useAuthStore.setState({ currentUserPubky: account });
  useEventkyCalendarStore.setState({ scopes: {} });
  useEventkyCalendarStore.getState().updateScope(eventkyPreferenceScope(account, backend.value), () => ({
    ...EMPTY_EVENTKY_PREFERENCES,
    reminders: [{ postUri: projectionPostUri, minutesBefore: 15, enabledAt: now - 60000 }],
  }));
  vi.mocked(PostController.fetch).mockResolvedValue(post);
  vi.mocked(PostController.getDetails).mockResolvedValue(post);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('app-open reminder lifecycle', () => {
  it('never asks for browser permission on mount', async () => {
    permission.value = 'default';
    const { unmount } = renderHook(useEventkyReminders);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(requestPermission).not.toHaveBeenCalled();
    expect(PostController.fetch).not.toHaveBeenCalled();
    expect(constructed).not.toHaveBeenCalled();
    unmount();
  });

  it.each(['account', 'backend', 'settings'] as const)(
    'closes delivered notifications and stops polling after %s changes',
    async (change) => {
      const { rerender, unmount } = renderHook(useEventkyReminders);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(constructed).toHaveBeenCalledWith('Pubky community meetup');
      expect(requestPermission).not.toHaveBeenCalled();
      act(() => {
        if (change === 'account') useAuthStore.setState({ currentUserPubky: 'b'.repeat(52) });
        if (change === 'backend') backend.value = 'https://other.example';
        if (change === 'settings')
          useEventkyCalendarStore.getState().clearScope(eventkyPreferenceScope(account, backend.value));
      });
      rerender();
      const requests = vi.mocked(PostController.fetch).mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60000);
      });
      expect(closed).toHaveBeenCalledTimes(1);
      expect(PostController.fetch).toHaveBeenCalledTimes(requests);
      expect(constructed).toHaveBeenCalledTimes(1);
      unmount();
    },
  );

  it('discards an in-flight source read after sign-out', async () => {
    let finish: ((value: EnrichedPostDetails) => void) | undefined;
    vi.mocked(PostController.fetch).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { unmount } = renderHook(useEventkyReminders);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(PostController.fetch).toHaveBeenCalledTimes(1);
    act(() => useAuthStore.setState({ currentUserPubky: null }));
    await act(async () => {
      finish?.(post);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(constructed).not.toHaveBeenCalled();
    unmount();
  });
});
