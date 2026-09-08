import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScrollDirection } from './useScrollDirection';

describe('useScrollDirection', () => {
  // Controllable rAF queue: jsdom never paints, so we flush callbacks manually
  let rafCallbacks: FrameRequestCallback[] = [];

  const setScrollY = (value: number) => {
    Object.defineProperty(window, 'scrollY', { value, configurable: true, writable: true });
  };

  const scroll = (value: number) => {
    setScrollY(value);
    window.dispatchEvent(new Event('scroll'));
  };

  const flushRaf = () => {
    const pending = rafCallbacks;
    rafCallbacks = [];
    pending.forEach((cb) => cb(performance.now()));
  };

  beforeEach(() => {
    rafCallbacks = [];
    setScrollY(0);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
      rafCallbacks = rafCallbacks.filter((_, index) => index + 1 !== id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null before any scroll', () => {
    const { result } = renderHook(() => useScrollDirection());

    expect(result.current).toBeNull();
  });

  it('returns "down" when scrolling toward the bottom', () => {
    const { result } = renderHook(() => useScrollDirection());

    act(() => {
      scroll(200);
      flushRaf();
    });

    expect(result.current).toBe('down');
  });

  it('returns "up" when scrolling back toward the top', () => {
    const { result } = renderHook(() => useScrollDirection());

    act(() => {
      scroll(200);
      flushRaf();
    });
    expect(result.current).toBe('down');

    act(() => {
      scroll(80);
      flushRaf();
    });
    expect(result.current).toBe('up');
  });

  it('ignores deltas smaller than the threshold', () => {
    const { result } = renderHook(() => useScrollDirection());

    act(() => {
      scroll(4); // below default threshold of 8
      flushRaf();
    });
    expect(result.current).toBeNull();

    act(() => {
      scroll(7); // delta of 7 from the last accepted position (0), still ignored
      flushRaf();
    });
    expect(result.current).toBeNull();

    act(() => {
      scroll(30);
      flushRaf();
    });
    expect(result.current).toBe('down');
  });

  it('respects a custom threshold', () => {
    const { result } = renderHook(() => useScrollDirection({ threshold: 100 }));

    act(() => {
      scroll(80);
      flushRaf();
    });
    expect(result.current).toBeNull();

    act(() => {
      scroll(150);
      flushRaf();
    });
    expect(result.current).toBe('down');
  });

  it('coalesces multiple scroll events into one rAF update', () => {
    const { result } = renderHook(() => useScrollDirection());

    act(() => {
      scroll(100);
      scroll(200);
      scroll(300);
    });

    expect(rafCallbacks).toHaveLength(1);

    act(() => {
      flushRaf();
    });

    expect(result.current).toBe('down');
  });

  it('cleans up listeners and pending rAF on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useScrollDirection());

    act(() => {
      scroll(200); // schedules a rAF
    });
    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(rafCallbacks).toHaveLength(0); // pending rAF was cancelled
    removeEventListenerSpy.mockRestore();
  });
});
