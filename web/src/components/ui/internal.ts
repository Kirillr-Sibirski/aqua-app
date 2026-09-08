'use client';

/**
 * Shared machinery for the primitives. Not exported from the barrel: these are implementation
 * details of `components/ui`, not part of the app's vocabulary.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

/** `useLayoutEffect` that does not warn during SSR. Positioning only ever runs in the browser. */
export const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Call the consumer's handler first, then ours. Ours still runs if theirs called preventDefault. */
export function composeHandlers<E>(
  theirs: ((event: E) => void) | undefined,
  ours: (event: E) => void,
): (event: E) => void {
  return (event: E) => {
    theirs?.(event);
    ours(event);
  };
}

/**
 * A value that is controlled when `value` is passed and self-managed otherwise. Both shapes are
 * needed: the kitchen sink and simple menus want uncontrolled, the wizard wants controlled.
 */
export function useControllableState<T>(
  value: T | undefined,
  defaultValue: T,
  onChange?: (next: T) => void,
): [T, (next: T) => void] {
  const [uncontrolled, setUncontrolled] = useState<T>(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : uncontrolled;

  const set = useCallback(
    (next: T) => {
      if (!controlled) setUncontrolled(next);
      onChange?.(next);
    },
    [controlled, onChange],
  );

  return [current, set];
}

/** False during SSR and the first client render, true afterwards. Gate portals on it. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/** Run `handler` on Escape, at the document level, while `enabled`. */
export function useEscapeKey(enabled: boolean, handler: () => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') ref.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

/** Restore focus to whatever was focused when `active` became true. */
export function useReturnFocus(active: boolean): void {
  const previous = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (active) {
      previous.current = document.activeElement as HTMLElement | null;
      return;
    }
    const node = previous.current;
    previous.current = null;
    if (node && document.contains(node)) node.focus({ preventScroll: true });
  }, [active]);
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Every tabbable node inside `container`, in DOM order. */
export function focusables(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (node) => node.offsetParent !== null || node === document.activeElement,
  );
}

/**
 * Keep Tab and Shift+Tab inside `container` while `active`, and move focus into it on open.
 *
 * A body portal is what lets an overlay escape an `overflow: hidden` ancestor, but it also puts the
 * overlay after the page in DOM order, so without this a Tab from the last control walks into the
 * page behind the scrim. The container itself is given `tabIndex={-1}` by the caller so there is
 * always somewhere to land, even for an overlay whose body is pure text.
 */
export function useFocusTrap(
  active: boolean,
  container: RefObject<HTMLElement | null>,
  initialFocus?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!active) return;
    const node = container.current;
    if (!node) return;

    const first = initialFocus?.current ?? focusables(node)[0] ?? node;
    first.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusables(node);
      if (items.length === 0) {
        event.preventDefault();
        node.focus({ preventScroll: true });
        return;
      }
      const activeEl = document.activeElement as HTMLElement | null;
      const index = activeEl ? items.indexOf(activeEl) : -1;
      const last = items.length - 1;

      if (!event.shiftKey && (index === last || index === -1)) {
        event.preventDefault();
        items[0].focus();
      } else if (event.shiftKey && (index === 0 || index === -1)) {
        event.preventDefault();
        items[last].focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [active, container, initialFocus]);
}

/**
 * Freeze the page behind an overlay while `active`, compensating for the scrollbar so the layout
 * does not jump sideways as it disappears. Nested overlays are counted, so closing an inner dialog
 * does not unlock the page under the outer one.
 */
let scrollLocks = 0;

export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    scrollLocks += 1;
    const { body } = document;
    if (scrollLocks === 1) {
      const gutter = window.innerWidth - document.documentElement.clientWidth;
      body.dataset.uiScrollLock = `${body.style.overflow}|${body.style.paddingRight}`;
      body.style.overflow = 'hidden';
      if (gutter > 0) body.style.paddingRight = `${gutter}px`;
    }
    return () => {
      scrollLocks -= 1;
      if (scrollLocks > 0) return;
      const [overflow = '', paddingRight = ''] = (body.dataset.uiScrollLock ?? '').split('|');
      body.style.overflow = overflow;
      body.style.paddingRight = paddingRight;
      delete body.dataset.uiScrollLock;
    };
  }, [active]);
}

// ---------------------------------------------------------------------------
// Anchored positioning
// ---------------------------------------------------------------------------

export type Side = 'top' | 'bottom' | 'left' | 'right';
export type Align = 'start' | 'center' | 'end';

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

export interface AnchoredPosition {
  top: number;
  left: number;
  side: Side;
}

export interface UseAnchoredPositionOptions {
  anchor: HTMLElement | null;
  floating: HTMLElement | null;
  open: boolean;
  side?: Side;
  align?: Align;
  /** Gap between anchor and floating element, in px. Multiples of 4 only. */
  offset?: number;
}

/**
 * Fixed-position coordinates for a floating element, flipped to the opposite side when it would
 * leave the viewport and clamped to an 8px margin.
 *
 * Fixed positioning in a body portal is what lets tooltips and popovers escape `overflow: hidden`
 * ancestors — the reason this is not just an absolutely positioned sibling. Returns `null` until
 * the floating element has been measured; render it hidden until then so nothing flashes at 0,0.
 */
export function useAnchoredPosition({
  anchor,
  floating,
  open,
  side = 'top',
  align = 'center',
  offset = 8,
}: UseAnchoredPositionOptions): AnchoredPosition | null {
  const [position, setPosition] = useState<AnchoredPosition | null>(null);

  const update = useCallback(() => {
    if (!anchor || !floating) return;
    const a = anchor.getBoundingClientRect();
    const f = floating.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const pad = 8;

    const fits = (candidate: Side): boolean => {
      if (candidate === 'top') return a.top - f.height - offset >= pad;
      if (candidate === 'bottom') return a.bottom + f.height + offset <= vh - pad;
      if (candidate === 'left') return a.left - f.width - offset >= pad;
      return a.right + f.width + offset <= vw - pad;
    };

    const resolved = fits(side) || !fits(OPPOSITE[side]) ? side : OPPOSITE[side];

    let top: number;
    let left: number;
    if (resolved === 'top' || resolved === 'bottom') {
      top = resolved === 'top' ? a.top - f.height - offset : a.bottom + offset;
      left =
        align === 'start' ? a.left : align === 'end' ? a.right - f.width : a.left + (a.width - f.width) / 2;
      left = Math.min(Math.max(pad, left), Math.max(pad, vw - f.width - pad));
    } else {
      left = resolved === 'left' ? a.left - f.width - offset : a.right + offset;
      top =
        align === 'start' ? a.top : align === 'end' ? a.bottom - f.height : a.top + (a.height - f.height) / 2;
      top = Math.min(Math.max(pad, top), Math.max(pad, vh - f.height - pad));
    }

    setPosition({ top: Math.round(top), left: Math.round(left), side: resolved });
  }, [anchor, floating, side, align, offset]);

  useIsomorphicLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    update();
  }, [open, update]);

  useEffect(() => {
    if (!open) return;
    const onChange = () => update();
    // `true` catches scrolls in any ancestor scroll container, not just the page.
    window.addEventListener('scroll', onChange, true);
    window.addEventListener('resize', onChange);
    return () => {
      window.removeEventListener('scroll', onChange, true);
      window.removeEventListener('resize', onChange);
    };
  }, [open, update]);

  return position;
}

// ---------------------------------------------------------------------------
// Roving tabindex
// ---------------------------------------------------------------------------

/**
 * Arrow-key navigation for a composite widget (tabs, segmented control): one tab stop for the
 * whole group, arrows move between items, Home/End jump to the ends. Disabled items are skipped.
 */
export function rovingIndex(
  key: string,
  current: number,
  count: number,
  orientation: 'horizontal' | 'vertical' | 'both',
  isDisabled: (index: number) => boolean,
): number | null {
  const forward =
    (orientation !== 'vertical' && key === 'ArrowRight') ||
    (orientation !== 'horizontal' && key === 'ArrowDown');
  const backward =
    (orientation !== 'vertical' && key === 'ArrowLeft') ||
    (orientation !== 'horizontal' && key === 'ArrowUp');

  if (!forward && !backward && key !== 'Home' && key !== 'End') return null;

  const step = (from: number, delta: number): number | null => {
    for (let i = 1; i <= count; i += 1) {
      const next = (from + delta * i + count * count) % count;
      if (!isDisabled(next)) return next;
    }
    return null;
  };

  if (key === 'Home') return step(-1, 1);
  if (key === 'End') return step(count, -1);
  return step(current, forward ? 1 : -1);
}

/** Focus the element a roving index points at, after React has committed the new tabindex. */
export function focusItem(container: RefObject<HTMLElement | null>, index: number): void {
  const items = container.current?.querySelectorAll<HTMLElement>('[data-roving-item]');
  items?.[index]?.focus();
}
