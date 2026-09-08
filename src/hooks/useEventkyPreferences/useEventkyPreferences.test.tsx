import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth/auth.store';
import {
  EMPTY_EVENTKY_PREFERENCES,
  eventkyPreferenceScope,
  useEventkyCalendarStore,
} from '@/stores/eventkyCalendar/eventkyCalendar.store';
import { projectionPostUri } from '@/test/fixtures/eventkyProjection';
import { useEventkyPreferences } from './useEventkyPreferences';

const { backend, permission, requestPermission } = vi.hoisted(() => ({
  backend: { value: 'https://nexus.example' },
  permission: { value: 'default' as NotificationPermission },
  requestPermission: vi.fn<() => Promise<NotificationPermission>>(),
}));
vi.mock('@/libs/runtime-config/runtime-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/libs/runtime-config/runtime-config')>()),
  getNexusUrl: () => backend.value,
}));
vi.mock('@/molecules/Toaster/toast');
const account = 'y'.repeat(52);

beforeEach(() => {
  vi.clearAllMocks();
  backend.value = 'https://nexus.example';
  permission.value = 'default';
  useAuthStore.setState({ currentUserPubky: account, showSignInDialog: false });
  useEventkyCalendarStore.setState({ scopes: {} });
  requestPermission.mockResolvedValue('granted');
  vi.stubGlobal(
    'Notification',
    class {
      static get permission() {
        return permission.value;
      }
      static requestPermission = requestPermission;
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('local Eventky preferences', () => {
  it('separates subscriptions and view settings by account and backend', () => {
    const { result, rerender } = renderHook(useEventkyPreferences);
    act(() => {
      result.current.toggleCalendar(projectionPostUri);
      result.current.setTimezone('Europe/Zurich');
    });
    expect(result.current.subscriptions).toEqual([projectionPostUri]);
    const firstScope = result.current.scope;
    act(() => useAuthStore.setState({ currentUserPubky: 'b'.repeat(52) }));
    expect(result.current.subscriptions).toEqual([]);
    expect(result.current.timezone).toBe('UTC');
    act(() => useAuthStore.setState({ currentUserPubky: account }));
    backend.value = 'https://other-nexus.example';
    rerender();
    expect(result.current.subscriptions).toEqual([]);
    expect(result.current.scope).not.toBe(firstScope);
    backend.value = 'https://nexus.example';
    rerender();
    expect(result.current.subscriptions).toEqual([projectionPostUri]);
    expect(result.current.timezone).toBe('Europe/Zurich');
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('requires an explicit authenticated click before permission or reminder activation', async () => {
    useAuthStore.setState({ currentUserPubky: null });
    const { result } = renderHook(useEventkyPreferences);
    expect(requestPermission).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.toggleReminder(projectionPostUri);
    });
    expect(useAuthStore.getState().showSignInDialog).toBe(true);
    expect(requestPermission).not.toHaveBeenCalled();
    expect(result.current.reminders).toEqual([]);
    act(() => useAuthStore.setState({ currentUserPubky: account }));
    await act(async () => {
      await result.current.toggleReminder(projectionPostUri);
    });
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(result.current.reminders).toEqual([
      expect.objectContaining({ postUri: projectionPostUri, minutesBefore: 15 }),
    ]);
    await act(async () => {
      await result.current.toggleReminder(projectionPostUri);
    });
    expect(result.current.reminders).toEqual([]);
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it.each(['account', 'backend'])('does not save an old %s scope after a delayed permission prompt', async (change) => {
    let finish: ((permission: NotificationPermission) => void) | undefined;
    requestPermission.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result, rerender } = renderHook(useEventkyPreferences);
    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.toggleReminder(projectionPostUri);
    });
    if (change === 'account') act(() => useAuthStore.setState({ currentUserPubky: 'b'.repeat(52) }));
    else {
      backend.value = 'https://other.example';
      rerender();
    }
    await act(async () => {
      finish?.('granted');
      await pending;
    });
    expect(result.current.reminders).toEqual([]);
    expect(Object.values(useEventkyCalendarStore.getState().scopes).flatMap((value) => value.reminders)).toEqual([]);
  });

  it('does not activate denied notifications and clears only the active scope', async () => {
    permission.value = 'denied';
    const otherScope = eventkyPreferenceScope('b'.repeat(52), backend.value);
    useEventkyCalendarStore
      .getState()
      .updateScope(otherScope, () => ({ ...EMPTY_EVENTKY_PREFERENCES, subscriptions: [projectionPostUri] }));
    const { result } = renderHook(useEventkyPreferences);
    act(() => result.current.toggleCalendar(projectionPostUri));
    await act(async () => {
      await result.current.toggleReminder(projectionPostUri);
    });
    expect(result.current.reminders).toEqual([]);
    expect(requestPermission).not.toHaveBeenCalled();
    act(() => result.current.clearPreferences());
    expect(result.current.subscriptions).toEqual([]);
    expect(useEventkyCalendarStore.getState().scopes[otherScope].subscriptions).toEqual([projectionPostUri]);
  });
});
