'use client';

import { useEffect, useRef, useState } from 'react';

interface UseScrollDirectionOptions {
  /**
   * Minimum scroll delta in pixels before the direction is updated.
   * Prevents flicker from tiny scroll adjustments.
   */
  threshold?: number;
}

export type ScrollDirection = 'up' | 'down' | null;

/**
 * useScrollDirection
 *
 * Hook that tracks the vertical scroll direction of the window.
 * Returns 'down' while the user scrolls toward the bottom, 'up' while they
 * scroll back toward the top, and null before the first scroll.
 *
 * Uses requestAnimationFrame throttling so updates are aligned to frame
 * painting and multiple scroll events within one frame collapse to one
 * state update.
 *
 * @param options.threshold - Minimum delta in pixels (default: 8)
 * @returns The current scroll direction, or null if not yet scrolled
 *
 * @example
 * ```tsx
 * const scrollDirection = useScrollDirection();
 * const isHidden = scrollDirection === 'down';
 * ```
 */
export function useScrollDirection(options: UseScrollDirectionOptions = {}): ScrollDirection {
  const { threshold = 8 } = options;
  const [direction, setDirection] = useState<ScrollDirection>(null);
  const lastYRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    lastYRef.current = window.scrollY;

    const handleScroll = () => {
      if (rafRef.current !== null) return;

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;

        const y = window.scrollY;
        const delta = y - lastYRef.current;

        if (Math.abs(delta) < threshold) return;

        lastYRef.current = y;
        setDirection(delta > 0 ? 'down' : 'up');
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [threshold]);

  return direction;
}
