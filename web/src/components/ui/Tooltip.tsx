'use client';

import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/ui';
import { useAnchoredPosition, useEscapeKey, useMounted, type Align, type Side } from './internal';

/** The one prop Tooltip attaches to its child. A child that already sets it keeps its own. */
interface TriggerProps {
  'aria-describedby'?: string;
}

export interface TooltipProps {
  /** One short line. A tooltip is a hint, never the only place a fact appears. */
  content: ReactNode;
  side?: Side;
  align?: Align;
  /** Hover delay in ms. Focus always opens immediately. */
  delay?: number;
  /** Exactly one focusable element: a Button, an IconButton, an anchor. */
  children: ReactElement<TriggerProps>;
}

/**
 * A hover and focus hint, portalled to the body.
 *
 * It describes rather than labels: the tooltip text lands on `aria-describedby`, so an IconButton
 * keeps its own `aria-label` as its name and the hint is read after it. Anything a maker *needs* in
 * order to act belongs on the page, not in here — a tooltip is invisible to touch and to anyone
 * scanning a screenshot.
 *
 * Opens on pointer enter after `delay`, immediately on keyboard focus, and closes on Escape as
 * WAI-ARIA requires, so a hint that covers the content under it can always be dismissed.
 */
export function Tooltip({ content, side = 'top', align = 'center', delay = 140, children }: TooltipProps) {
  const mounted = useMounted();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [floating, setFloating] = useState<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const position = useAnchoredPosition({ anchor, floating, open, side, align, offset: 8 });

  useEscapeKey(open, () => setOpen(false));
  useEffect(() => () => clearTimeout(timer.current), []);

  const show = (immediate: boolean) => {
    clearTimeout(timer.current);
    if (immediate || delay <= 0) setOpen(true);
    else timer.current = setTimeout(() => setOpen(true), delay);
  };

  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };

  // The wrapper is the anchor and carries the handlers; only `aria-describedby` is cloned onto the
  // child. That keeps the hint attached to the element that actually takes focus (a screen reader
  // reads it after the button's own name) while leaving the child's ref alone for its owner.
  // React's enter/leave and focus events are delegated, so both fire for the subtree.
  const trigger = cloneElement(children, {
    'aria-describedby': open ? id : children.props['aria-describedby'],
  });

  return (
    <>
      <span
        ref={setAnchor}
        className="inline-flex"
        onPointerEnter={() => show(false)}
        onPointerLeave={hide}
        onFocus={() => show(true)}
        onBlur={hide}
      >
        {trigger}
      </span>
      {mounted && open
        ? createPortal(
            <div
              ref={setFloating}
              role="tooltip"
              id={id}
              style={{ top: position?.top ?? 0, left: position?.left ?? 0 }}
              className={cn(
                'pointer-events-none fixed z-tooltip max-w-64 rounded-control border border-line bg-surface-2 px-2.5 py-1.5',
                'text-mini leading-prose text-ink shadow-overlay',
                // Hidden until measured, so it never flashes at the top-left corner.
                position ? 'opacity-100' : 'opacity-0',
              )}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
