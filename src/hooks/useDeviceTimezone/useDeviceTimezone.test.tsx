import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDeviceTimezone } from './useDeviceTimezone';

afterEach(() => vi.restoreAllMocks());
describe('automatic device timezone', () => {
  it('reads the device zone and refreshes after device settings change without a saved preference', () => {
    const original = new Intl.DateTimeFormat().resolvedOptions();
    const resolved = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockReturnValue({ ...original, timeZone: 'America/New_York' });
    const { result } = renderHook(() => useDeviceTimezone());
    expect(result.current).toBe('America/New_York');
    resolved.mockReturnValue({ ...original, timeZone: 'Europe/Zurich' });
    act(() => window.dispatchEvent(new Event('focus')));
    expect(result.current).toBe('Europe/Zurich');
  });
});
