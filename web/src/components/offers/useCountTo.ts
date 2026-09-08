'use client';

/**
 * Count a chain value to its new value instead of swapping it.
 *
 * DESIGN.md allows exactly one loud moment: a fill landing, with the affected balance counting to
 * its new number while the bars move. This is that, and nothing else in the app uses it.
 *
 * Three rules keep it honest:
 *
 *  - **The endpoints are exact.** The tween runs on a `number` (a display quantity), but the value
 *    it lands on is the original bigint, byte for byte. No figure the chain did not produce is ever
 *    the resting state of the screen.
 *  - **It never runs on mount.** The first value renders immediately; only a *change* animates, so
 *    a page load does not count up from zero and imply a movement that did not happen.
 *  - **Reduced motion jumps.** Read from the same media query the rest of the system uses.
 *
 * Large values are tweened in the low digits only: interpolating an 18-decimal bigint through
 * `Number` would lose precision, so the animation happens on the ratio and is applied back to the
 * bigint with bigint arithmetic.
 */
import { useEffect, useRef, useState } from 'react';
import { DURATION_MS, EASE_OUT_QUART_POINTS, prefersReducedMotion } from '@/lib/ui';

const SCALE = BigInt(1_000_000);

/** The design system's ease-out-quart, evaluated as a cubic Bezier y(t) by bisection on x. */
function easeOutQuart(t: number): number {
  const [x1, y1, x2, y2] = EASE_OUT_QUART_POINTS;
  const bezier = (a: number, b: number, u: number) => 3 * a * (1 - u) ** 2 * u + 3 * b * (1 - u) * u ** 2 + u ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i += 1) {
    const mid = (lo + hi) / 2;
    if (bezier(x1, x2, mid) < t) lo = mid;
    else hi = mid;
  }
  return bezier(y1, y2, (lo + hi) / 2);
}

/** Interpolate between two bigints at `progress` in [0, 1], in bigint arithmetic throughout. */
function lerp(from: bigint, to: bigint, progress: number): bigint {
  const step = BigInt(Math.round(Math.min(1, Math.max(0, progress)) * Number(SCALE)));
  return from + ((to - from) * step) / SCALE;
}

/**
 * @param value the exact chain value
 * @param durationMs defaults to the system's `slow` step (200ms), the only place it is used
 * @returns the value to render this frame; equal to `value` at rest
 */
export function useCountTo(value: bigint, durationMs: number = DURATION_MS.slow): bigint {
  const [display, setDisplay] = useState(value);
  // What is actually on screen this frame. A ref rather than the state variable, so an interrupted
  // tween can resume from where the eye last saw the number instead of from a stale render's copy.
  const shown = useRef(value);
  const frame = useRef(0);

  useEffect(() => {
    const start = shown.current;
    if (start === value) return;

    const land = () => {
      shown.current = value;
      setDisplay(value);
    };

    if (prefersReducedMotion() || durationMs <= 0) {
      land();
      return;
    }

    const t0 = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - t0) / durationMs);
      if (progress >= 1) {
        land();
        return;
      }
      const next = lerp(start, value, easeOutQuart(progress));
      shown.current = next;
      setDisplay(next);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame.current);
  }, [value, durationMs]);

  return display;
}
