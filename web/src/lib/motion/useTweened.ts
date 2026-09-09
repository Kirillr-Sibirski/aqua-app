'use client';

/**
 * A figure that moves to its new value instead of being replaced by it.
 *
 * The rule these hooks exist to keep is "animate the VALUE, never the layout". They return a
 * quantity, not a class name and not a style: the call site renders the returned bigint through
 * exactly the formatter it already used, so the token's decimal convention, its grouping and its
 * tabular figures are unchanged and the only difference is which number is on the screen this
 * frame. Nothing is wrapped, nothing is positioned, and no element is added to the DOM.
 *
 * Three cases are deliberately not animated:
 *
 *   - **The first value.** A figure arriving from a skeleton has nowhere to travel from; counting
 *     it up from zero would invent a reading the chain never returned.
 *   - **`undefined` in either direction.** A read going away, or arriving, is a state change and
 *     belongs to the cross-fade, not to a tween.
 *   - **`prefers-reduced-motion: reduce`.** The target is committed on the same render.
 *
 * Because intermediate frames lie between the two endpoints, and because every figure on this
 * screen is printed at a fixed number of fraction digits, a transition can widen a figure by at
 * most the difference between its own two ends, once, in a column that is right-aligned. Nothing
 * beside it moves.
 *
 * `from` exists for one situation and it is a real one on this screen: a component that is
 * **remounted** between the two readings. The positions strip swaps its rows for skeletons while a
 * re-read is in flight, so a row that a fill just changed is a different React element than the row
 * that held the old figure, and a hook inside it has no memory to travel from. Its parent does, and
 * `from` is how the parent lends it — read once, when the tween mounts, and ignored afterwards.
 */
import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './reducedMotion';
import { durationMs, lerpBigInt, lerpNumber, type DurationToken } from './tween';

export interface TweenOptions<T> {
  /**
   * Where to start, when the component holding this hook did not exist for the previous reading.
   * Read on mount only: a later change to it does nothing, because by then this hook has its own
   * memory of what is on the screen.
   */
  from?: T;
  /** Which duration token to run for. `--duration-base` unless a call site has a reason. */
  token?: DurationToken;
}

/** The chain's integer, moving. Returns `target` unchanged on the server and on first paint. */
export function useTweenedBigInt(
  target: bigint | undefined,
  options?: TweenOptions<bigint>,
): bigint | undefined {
  return useTweened(target, lerpBigInt, options);
}

/** The one ratio on the screen that is genuinely a float: how much of an offer is still backed. */
export function useTweenedNumber(
  target: number | undefined,
  options?: TweenOptions<number>,
): number | undefined {
  return useTweened(target, lerpNumber, options);
}

function useTweened<T extends bigint | number>(
  target: T | undefined,
  lerp: (from: T, to: T, t: number) => T,
  options?: TweenOptions<T>,
): T | undefined {
  const token = options?.token ?? '--duration-base';
  const [shown, setShown] = useState<T | undefined>(() => options?.from ?? target);
  /* What is on the screen right now, readable synchronously when a new target arrives mid-flight:
     a transition interrupted halfway starts from the frame the reader is actually looking at. */
  const current = useRef<T | undefined>(options?.from ?? target);
  const frame = useRef<number | undefined>(undefined);

  useEffect(() => {
    const from = current.current;

    if (from === undefined || target === undefined || from === target || prefersReducedMotion()) {
      current.current = target;
      setShown(target);
      return;
    }

    const ms = durationMs(token);
    const started = performance.now();

    const step = (now: number) => {
      const t = ms <= 0 ? 1 : (now - started) / ms;
      const next = lerp(from, target, t);
      current.current = next;
      setShown(next);
      frame.current = t < 1 ? requestAnimationFrame(step) : undefined;
    };

    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
    };
    // `lerp` is a module-level function per instantiation and never changes identity, and `from` is
    // by contract read only at mount — re-running this on it would restart a settled figure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, token]);

  return shown;
}
