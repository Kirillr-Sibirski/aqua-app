'use client';

import { AlertTriangle, CircleCheck, Info, OctagonAlert } from 'lucide-react';
import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner';
import { Spinner } from './Spinner';
import { ICON_SIZE, ICON_STROKE } from './icon';
import { DURATION_MS, Z } from '@/lib/ui';
import { describeError } from './error';

/**
 * Transaction notifications.
 *
 * sonner brings the queue, the timers, the swipe-to-dismiss and — the part worth importing a
 * library for — a correct live region: one `aria-live` container that is not re-announced on every
 * re-render, plus an F6 hotkey that moves focus into the stack. What it does not bring is a look:
 * `unstyled` throws away every one of its own class names, and each slot below is redrawn from the
 * design tokens, so a toast is the same 10px card, the same hairline and the same type scale as
 * everything else on screen.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      theme="dark"
      gap={8}
      offset={24}
      mobileOffset={16}
      visibleToasts={4}
      duration={5000}
      containerAriaLabel="Notifications"
      style={{ zIndex: Z.toast }}
      icons={{
        success: <CircleCheck size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} className="text-pos" />,
        info: <Info size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} className="text-accent" />,
        warning: (
          <AlertTriangle size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} className="text-warn" />
        ),
        error: <OctagonAlert size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} className="text-neg" />,
        loading: <Spinner size={16} className="text-ink-3" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'group pointer-events-auto flex w-full items-start gap-3 rounded-card border ' +
            'border-line bg-surface px-4 py-3 shadow-overlay',
          icon: 'mt-0.5 flex shrink-0 items-center',
          content: 'flex min-w-0 flex-1 flex-col gap-0.5',
          title: 'text-body font-medium text-ink',
          description: 'text-mini leading-prose text-ink-2',
          actionButton:
            'ml-2 inline-flex h-7 shrink-0 items-center rounded-control bg-accent px-2.5 ' +
            'text-mini font-medium text-accent-ink transition-state cursor-pointer',
          cancelButton:
            'ml-2 inline-flex h-7 shrink-0 items-center rounded-control border border-line ' +
            'px-2.5 text-mini text-ink-2 transition-state cursor-pointer hover:text-ink',
          closeButton:
            'absolute right-2 top-2 grid size-6 place-items-center rounded-control ' +
            'text-ink-3 transition-state hover:bg-surface-2 hover:text-ink',
          error: 'border-neg/30',
          warning: 'border-warn/30',
          success: 'border-pos/30',
        },
        // Matches --duration-slow, so a toast enters on the same curve as an overlay.
        duration: 5000,
        style: { transitionDuration: `${DURATION_MS.slow}ms` },
      }}
    />
  );
}

export interface NotifyOptions {
  /** A second line under the title: a hash, a size, a reason. */
  description?: string;
  /** One control. "View on Basescan", "Undo" is not a thing this app can offer. */
  action?: { label: string; onClick: () => void };
  /** ms. `Infinity` pins it until dismissed — for a transaction still in flight. */
  duration?: number;
  /** Reuse an existing toast's slot: pass the id returned by a previous call. */
  id?: string | number;
}

type ToastId = string | number;

/**
 * The app's notification vocabulary.
 *
 * Wrapping sonner rather than re-exporting it keeps one decision in one place: `notify.error`
 * decodes the revert through {@link describeError}, so a `CoverageShortfall` surfaces by name in
 * the toast exactly as it does in `ErrorState`, and a wallet rejection is downgraded to a plain
 * note because the person did it on purpose.
 */
export const notify = {
  message: (title: string, opts: NotifyOptions = {}): ToastId => sonnerToast(title, opts),
  success: (title: string, opts: NotifyOptions = {}): ToastId => sonnerToast.success(title, opts),
  info: (title: string, opts: NotifyOptions = {}): ToastId => sonnerToast.info(title, opts),
  warning: (title: string, opts: NotifyOptions = {}): ToastId => sonnerToast.warning(title, opts),

  /** A transaction in flight. Pin it, then pass its id to `success`/`error` to replace it. */
  pending: (title: string, opts: NotifyOptions = {}): ToastId =>
    sonnerToast.loading(title, { duration: Infinity, ...opts }),

  /**
   * @param title what was being attempted: "Could not ship the leg"
   * @param error the thrown thing; the decoded custom error name becomes the description
   */
  error: (title: string, error?: unknown, opts: NotifyOptions = {}): ToastId => {
    if (error === undefined) return sonnerToast.error(title, opts);
    const described = describeError(error);
    if (described.rejected) {
      return sonnerToast.info('Cancelled in the wallet', {
        ...opts,
        description: opts.description,
      });
    }
    const detail = described.name
      ? described.args.length > 0
        ? `${described.name}(${described.args.join(', ')})`
        : described.name
      : described.message;
    return sonnerToast.error(title, { ...opts, description: opts.description ?? detail });
  },

  dismiss: (id?: ToastId): void => {
    sonnerToast.dismiss(id);
  },
};
