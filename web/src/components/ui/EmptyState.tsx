'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/ui';
import { ICON_SIZE, ICON_STROKE, type IconComponent } from './icon';

export interface EmptyStateProps {
  /** What is not here, stated plainly: "No legs shipped yet". Not "Nothing to see". */
  title: ReactNode;
  /** One or two sentences: why it is empty, and what filling it would mean. */
  description?: ReactNode;
  /** The single action that resolves the state. One, not three. */
  action?: ReactNode;
  /** A secondary action, only when there is genuinely a second path. */
  secondaryAction?: ReactNode;
  /** Small print under the actions: a prerequisite, a constraint, a cost. */
  note?: ReactNode;
  icon?: IconComponent;
  /** Drops the border and background, for an empty state already inside a Card. */
  bare?: boolean;
  className?: string;
}

/**
 * The state a data surface shows before it has anything to show.
 *
 * Left-aligned rather than centred: a centred block with an icon over it is the marketing-panel
 * shape, and the eye has to travel back to the left rule to read whatever comes next anyway. The
 * rule that matters is one action — an empty state offering three choices has not decided what the
 * screen is for.
 */
export function EmptyState({
  title,
  description,
  action,
  secondaryAction,
  note,
  icon: Icon,
  bare = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        // Constrained to the measure of its own copy. A full-width card whose content stops at
        // ~600px leaves the widest dead region in the app, and these are the screens a judge lands
        // on first.
        bare ? 'py-10' : 'max-w-3xl rounded-card border border-line bg-surface px-6 py-10',
        className,
      )}
    >
      <div className="max-w-prose">
        {Icon ? (
          <Icon
            size={ICON_SIZE.md}
            strokeWidth={ICON_STROKE}
            aria-hidden="true"
            className="mb-3 text-ink-3"
          />
        ) : null}
        <h2 className="text-lead font-medium text-ink">{title}</h2>
        {description ? (
          <p className="mt-2 text-body leading-prose text-ink-2">{description}</p>
        ) : null}
        {action || secondaryAction ? (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {action}
            {secondaryAction}
          </div>
        ) : null}
        {note ? <p className="mt-3 text-mini leading-prose text-ink-3">{note}</p> : null}
      </div>
    </div>
  );
}
