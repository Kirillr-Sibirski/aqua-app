'use client';

import { X } from 'lucide-react';
import { useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/ui';
import { IconButton } from './IconButton';
import {
  useBodyScrollLock,
  useEscapeKey,
  useFocusTrap,
  useMounted,
  useReturnFocus,
} from './internal';
import styles from './motion.module.css';

export type DialogSize = 'sm' | 'md' | 'lg';

const WIDTH: Record<DialogSize, string> = {
  sm: 'max-w-[26rem]',
  md: 'max-w-[34rem]',
  lg: 'max-w-[46rem]',
};

export interface OverlayProps {
  open: boolean;
  /** Called on Escape, on a scrim click, and from the close button. */
  onClose: () => void;
  /** The accessible name. Required: an unnamed modal is unusable with a screen reader. */
  title: ReactNode;
  /** One line under the title. Wired to `aria-describedby`. */
  description?: ReactNode;
  /** A row of actions on a rule at the bottom. The primary action goes last. */
  footer?: ReactNode;
  /** Where focus lands on open. Defaults to the first tabbable node, which is usually right. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Set false for a flow that must not be abandoned halfway (a signature in flight). */
  dismissible?: boolean;
  className?: string;
  /** Applied to the scrolling body, for a panel whose content sets its own padding (a list). */
  bodyClassName?: string;
  children?: ReactNode;
}

export interface DialogProps extends OverlayProps {
  size?: DialogSize;
}

/**
 * A centred modal, rendered into a body portal.
 *
 * The portal is the point: a dialog opened from inside a scrolling table or an `overflow: hidden`
 * card has to escape that ancestor, and no z-index can rescue it from a clipped stacking context.
 * The platform behaviours a native `<dialog>` would have supplied — Escape, a focus trap, focus
 * returned to the trigger, a scroll lock on the page behind — are supplied here instead, because
 * the Sheet variant needs the same machinery anchored to an edge.
 */
export function Dialog({ size = 'md', className, ...props }: DialogProps) {
  return (
    <Overlay
      {...props}
      panelClassName={cn(
        'w-full',
        WIDTH[size],
        'rounded-card border border-line bg-surface shadow-overlay',
        styles.panelIn,
        className,
      )}
      containerClassName="items-start justify-center overflow-y-auto p-4 sm:items-center sm:p-6"
    />
  );
}

export interface SheetProps extends OverlayProps {
  /** `right` for a detail rail, `bottom` for a mobile-first flow. */
  side?: 'right' | 'bottom';
}

/**
 * An edge-anchored panel. Same machinery as Dialog, different geometry: a sheet is for a detail
 * view the maker reads alongside the page they came from, so it keeps the page visible behind it
 * rather than centring itself over it.
 */
export function Sheet({ side = 'right', className, ...props }: SheetProps) {
  return (
    <Overlay
      {...props}
      panelClassName={cn(
        side === 'right'
          ? cn('h-full w-full max-w-[30rem] border-l border-line', styles.sheetInRight)
          : cn('max-h-[85vh] w-full rounded-t-card border-t border-line', styles.sheetInBottom),
        'bg-surface shadow-overlay',
        className,
      )}
      containerClassName={side === 'right' ? 'items-stretch justify-end' : 'items-end justify-center'}
    />
  );
}

// ---------------------------------------------------------------------------

interface InternalOverlayProps extends OverlayProps {
  panelClassName: string;
  containerClassName: string;
}

function Overlay({
  open,
  onClose,
  title,
  description,
  footer,
  initialFocus,
  dismissible = true,
  children,
  bodyClassName,
  panelClassName,
  containerClassName,
}: InternalOverlayProps) {
  const mounted = useMounted();
  const panelRef = useRef<HTMLDivElement>(null);
  const baseId = useId();

  const dismiss = () => {
    if (dismissible) onClose();
  };

  useEscapeKey(open, dismiss);
  useFocusTrap(open, panelRef, initialFocus);
  useReturnFocus(open);
  useBodyScrollLock(open);

  // `mounted` keeps the portal out of the server render entirely: there is no document to portal
  // into, and rendering the panel inline instead would produce markup the client never emits.
  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-modal">
      <div
        aria-hidden="true"
        onClick={dismiss}
        className={cn('absolute inset-0 z-modal-backdrop bg-scrim', styles.scrimIn)}
      />
      <div className={cn('relative flex h-full w-full', containerClassName)}>
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${baseId}-title`}
          aria-describedby={description ? `${baseId}-description` : undefined}
          tabIndex={-1}
          className={cn('flex min-h-0 flex-col outline-none', panelClassName)}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 id={`${baseId}-title`} className="text-lead font-medium text-ink">
                {title}
              </h2>
              {description ? (
                <p id={`${baseId}-description`} className="mt-1 text-mini leading-prose text-ink-3">
                  {description}
                </p>
              ) : null}
            </div>
            {dismissible ? (
              <IconButton
                icon={X}
                label="Close"
                size="sm"
                onClick={onClose}
                className="-mt-1 -mr-2"
              />
            ) : null}
          </div>

          <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4', bodyClassName)}>
            {children}
          </div>

          {footer ? (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
