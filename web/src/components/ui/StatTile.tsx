'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/ui';
import { Skeleton } from './Skeleton';

export interface StatTileProps {
  /** What the figure is. Sentence case, no colon. "Backing", "Notional written". */
  label: ReactNode;
  /** The figure. Pass a `TokenAmount` or a formatted string, already mono. */
  value?: ReactNode;
  /** Unit or denominator beside the figure, in `--ink-3`: "WETH", "of 10.4". */
  unit?: ReactNode;
  /** One line under the figure: a bound, a source, a `Delta`. */
  detail?: ReactNode;
  /** Right of the label: a `Pill`, a small info affordance. */
  aside?: ReactNode;
  loading?: boolean;
  /** Shown in place of the figure when there is nothing to read yet. Default an em rule. */
  empty?: ReactNode;
  className?: string;
}

/**
 * One number with its label, quiet by design.
 *
 * The figure is 20px mono, not a 34px display step: DESIGN.md bans hero metrics, and a tile that
 * shouts is a tile a maker stops reading after the first day. Tiles sit in a row separated by
 * hairlines rather than in a grid of identical cards, which is the other banned pattern.
 */
export function StatTile({
  label,
  value,
  unit,
  detail,
  aside,
  loading = false,
  empty = '—',
  className,
}: StatTileProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-mini text-ink-3">{label}</span>
        {aside ? <span className="shrink-0">{aside}</span> : null}
      </div>

      {loading ? (
        <Skeleton className="mt-0.5 h-6 w-28" />
      ) : (
        <p className="flex items-baseline gap-1.5 leading-num">
          <span className="truncate font-mono text-title tnum text-ink">
            {value ?? <span className="text-ink-3">{empty}</span>}
          </span>
          {unit ? <span className="shrink-0 font-mono text-meta tnum text-ink-3">{unit}</span> : null}
        </p>
      )}

      {detail ? <div className="text-mini leading-num text-ink-3">{detail}</div> : null}
    </div>
  );
}

/**
 * A row of tiles separated by hairlines rather than by card borders. Two per line on a narrow
 * viewport, four from `md`; the rules follow, and the tile that starts a row never has one.
 *
 * The geometry lives in the `stat-row` utility in `globals.css` rather than in arbitrary variants
 * here. See the comment there: expressed as variants, the border and its colour came from different
 * utilities and the first tile ended up with an off-token near-white stripe.
 */
export function StatRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('stat-row', className)}>{children}</div>;
}
