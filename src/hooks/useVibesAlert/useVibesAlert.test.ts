import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFeatureDiscoveryStorageKey } from '@/config/featureDiscovery';
import { VIBES_ALERT_STORAGE_ID } from '@/config/vibes';
import { useVibesAlert } from './useVibesAlert';

const auth = vi.hoisted(() => ({ currentUserPubky: 'alice' as string | null }));
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: typeof auth) => unknown) => selector(auth),
}));

const storageKey = buildFeatureDiscoveryStorageKey('alice', VIBES_ALERT_STORAGE_ID);
const hour = 60 * 60 * 1000;

describe('useVibesAlert', () => {
  beforeEach(() => {
    localStorage.clear();
    auth.currentUserPubky = 'alice';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows on the first authenticated visit and keeps guests hidden', () => {
    const { result, rerender } = renderHook(useVibesAlert);
    expect(result.current.showVibesAlert).toBe(true);
    auth.currentUserPubky = null;
    rerender();
    expect(result.current.showVibesAlert).toBe(false);
  });

  it('persists 24h, then 72h, then repeating weekly delays across visits', () => {
    for (const hours of [24, 72, 168, 168, 168]) {
      const visit = renderHook(useVibesAlert);
      expect(visit.result.current.showVibesAlert).toBe(true);
      act(() => visit.result.current.remindLater());
      expect(visit.result.current.showVibesAlert).toBe(false);
      visit.unmount();

      vi.setSystemTime(Date.now() + hours * hour - 1);
      const earlyVisit = renderHook(useVibesAlert);
      expect(earlyVisit.result.current.showVibesAlert).toBe(false);
      earlyVisit.unmount();

      vi.setSystemTime(Date.now() + 1);
    }
    const { result } = renderHook(useVibesAlert);
    expect(result.current.showVibesAlert).toBe(true);
  });

  it('waits for a return to the tab instead of interrupting an ongoing visit', () => {
    const { result, rerender } = renderHook(useVibesAlert);
    act(() => result.current.remindLater());
    act(() => vi.advanceTimersByTime(24 * hour));
    rerender();
    expect(result.current.showVibesAlert).toBe(false);
    act(() => window.dispatchEvent(new Event('focus')));
    expect(result.current.showVibesAlert).toBe(true);
  });

  it('never shows again after Try, including after remount and later snooze attempts', () => {
    const first = renderHook(useVibesAlert);
    act(() => first.result.current.tryVibes());
    act(() => first.result.current.remindLater());
    expect(first.result.current.showVibesAlert).toBe(false);
    first.unmount();
    vi.setSystemTime(Date.now() + 365 * 24 * hour);
    const next = renderHook(useVibesAlert);
    expect(next.result.current.showVibesAlert).toBe(false);
  });

  it('keeps choices separate when switching accounts and restores them on return', () => {
    const { result, rerender } = renderHook(useVibesAlert);
    act(() => result.current.tryVibes());
    auth.currentUserPubky = 'bob';
    rerender();
    expect(result.current.showVibesAlert).toBe(true);
    auth.currentUserPubky = 'alice';
    rerender();
    expect(result.current.showVibesAlert).toBe(false);
  });

  it('records Try from a permanent link while the home reminder is snoozed', () => {
    const firstVisit = renderHook(useVibesAlert);
    act(() => firstVisit.result.current.remindLater());
    firstVisit.unmount();

    const sidebarVisit = renderHook(useVibesAlert);
    expect(sidebarVisit.result.current.showVibesAlert).toBe(false);
    act(() => sidebarVisit.result.current.tryVibes());
    sidebarVisit.unmount();

    vi.setSystemTime(Date.now() + 365 * 24 * hour);
    const returnVisit = renderHook(useVibesAlert);
    expect(returnVisit.result.current.showVibesAlert).toBe(false);
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toMatchObject({ tried: true });
  });

  it('honors Try from another tab and cannot overwrite it with a stale Later click', () => {
    const { result } = renderHook(useVibesAlert);
    localStorage.setItem(storageKey, JSON.stringify({ tried: true, laterCount: 0, nextShowAt: 0 }));
    act(() => result.current.remindLater());
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toMatchObject({ tried: true });
    expect(result.current.showVibesAlert).toBe(false);
  });

  it('hides an open alert when another tab dismisses it', () => {
    const { result } = renderHook(useVibesAlert);
    localStorage.setItem(storageKey, JSON.stringify({ tried: false, laterCount: 1, nextShowAt: Date.now() + hour }));
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: storageKey })));
    expect(result.current.showVibesAlert).toBe(false);
  });

  it.each(['{broken', 'null', '{"tried":false,"laterCount":-1,"nextShowAt":0}'])(
    'recovers from invalid saved data: %s',
    (raw) => {
      localStorage.setItem(storageKey, raw);
      const { result } = renderHook(useVibesAlert);
      expect(result.current.showVibesAlert).toBe(true);
      act(() => result.current.remindLater());
      expect(JSON.parse(localStorage.getItem(storageKey)!)).toMatchObject({ nextShowAt: Date.now() + 24 * hour });
    },
  );

  it('stays hidden when browser storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Unavailable');
    });
    const { result } = renderHook(useVibesAlert);
    expect(result.current.showVibesAlert).toBe(false);
  });

  it('still dismisses if saving fails', () => {
    const { result } = renderHook(useVibesAlert);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded');
    });
    act(() => result.current.tryVibes());
    expect(result.current.showVibesAlert).toBe(false);
  });
});
