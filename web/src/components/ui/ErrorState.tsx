'use client';

import { OctagonAlert, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/ui';
import { Button } from './Button';
import { describeError } from './error';
import { ICON_SIZE, ICON_STROKE } from './icon';

export interface ErrorStateProps {
  /** The thrown thing, straight from a query or a write. Decoded here, not by the caller. */
  error: unknown;
  /** What failed, in the app's own words: "Could not read the book". */
  title?: ReactNode;
  /** Called by the Retry button. Omit it and no Retry is offered. */
  onRetry?: () => void;
  retryLabel?: string;
  /** An extra control beside Retry: "Switch network", "Open the diagnostics page". */
  action?: ReactNode;
  /** Drops the border and background, for an error already inside a Card. */
  bare?: boolean;
  className?: string;
}

/**
 * A failed data surface.
 *
 * The custom error name is the headline, because on this app a revert usually *is* the answer:
 * `NotCovered(needed, free)` means the guard did its job and the maker's wallet cannot deliver the size
 * that was quoted, which is a fact worth reading, not an outage. The decoded arguments are rendered
 * as mono values under it, so the two numbers the guard compared are on screen.
 *
 * A wallet rejection is not an error. It renders as a plain sentence with no alarm colour, because
 * the person did it on purpose.
 */
export function ErrorState({
  error,
  title,
  onRetry,
  retryLabel = 'Try again',
  action,
  bare = false,
  className,
}: ErrorStateProps) {
  const described = describeError(error);
  const heading = described.rejected
    ? 'Request cancelled in the wallet'
    : (described.name ?? title ?? 'Request failed');

  return (
    <div
      role="alert"
      className={cn(
        bare
          ? 'py-8'
          : cn(
              'rounded-card border px-6 py-8',
              described.rejected ? 'border-line bg-surface' : 'border-neg/30 bg-neg/8',
            ),
        className,
      )}
    >
      <div className="flex max-w-prose gap-3">
        {described.rejected ? null : (
          <OctagonAlert
            size={ICON_SIZE.md}
            strokeWidth={ICON_STROKE}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-neg"
          />
        )}
        <div className="min-w-0 flex-1">
          {title && !described.rejected && described.name ? (
            <p className="text-mini text-ink-3">{title}</p>
          ) : null}
          <h2
            className={cn(
              'text-lead font-medium text-ink',
              described.name && !described.rejected && 'font-mono',
            )}
          >
            {heading}
          </h2>

          {described.args.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-0.5">
              {described.args.map((arg, i) => (
                <li key={i} className="font-mono text-meta tnum break-all text-ink-2">
                  <span className="text-ink-3">arg {i}</span> {arg}
                </li>
              ))}
            </ul>
          ) : null}

          {described.message && described.message !== heading ? (
            <p className="mt-2 text-meta leading-prose break-words text-ink-2">
              {described.message}
            </p>
          ) : null}

          {onRetry || action ? (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {onRetry ? (
                <Button variant="secondary" size="sm" icon={RotateCw} onClick={onRetry}>
                  {retryLabel}
                </Button>
              ) : null}
              {action}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
