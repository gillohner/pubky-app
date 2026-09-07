import { afterEach, expect, it, vi } from 'vitest';
import { AUTH_PERSIST_KEY } from '@/stores/persistedKeys';
import { canonicalPubky, mockSession } from '@/test-utils/pubky';
import { subscribeAccountChanges } from './auth.cross-tab';
import { useAuthStore } from './auth.store';

afterEach(() => useAuthStore.getState().reset());

it('invalidates another window on account switches and logout, but not same-account updates', () => {
  const viewer = canonicalPubky(1);
  useAuthStore.getState().init({ currentUserPubky: viewer, session: mockSession(), hasProfile: true });
  const invalidate = vi.fn();
  const unsubscribe = subscribeAccountChanges(invalidate);
  const change = (pubky: string | null) =>
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: AUTH_PERSIST_KEY,
        newValue: JSON.stringify({ state: { currentUserPubky: pubky } }),
      }),
    );
  change(viewer);
  expect(invalidate).not.toHaveBeenCalled();
  change(canonicalPubky(2));
  change(null);
  expect(invalidate).toHaveBeenCalledTimes(2);
  unsubscribe();
  change(null);
  expect(invalidate).toHaveBeenCalledTimes(2);
  // Invalidating a window must not overwrite the other window's persisted session.
  expect(useAuthStore.getState().currentUserPubky).toBe(viewer);
});
