/**
 * The four primitives the terminal is built out of.
 *
 * They exist so that "every figure is monospace, tabular, right-aligned" and "loading is a skeleton
 * of the right width, never a word" are enforced by a component rather than remembered at each of
 * the forty places a number lands on this screen.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/ui';
import classes from './terminal.module.css';

/** A block of the right size, where a number is about to be. Never the word "loading". */
export function Bar({ width, className }: { width: number | string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(classes.skeleton, className)}
      style={{ width: typeof width === 'number' ? `${width}px` : width }}
    />
  );
}

/** A figure with its unit. Monospace, tabular, right-aligned by its container. */
export function Num({
  children,
  unit,
  tone,
  title,
  className,
}: {
  children: ReactNode;
  unit?: string;
  tone?: 'pos' | 'dim';
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        classes.num,
        tone === 'pos' && classes.numPos,
        tone === 'dim' && classes.numDim,
        className,
      )}
    >
      {children}
      {unit ? <span className={classes.unit}>{unit}</span> : null}
    </span>
  );
}

/**
 * A nine-cell meter, filled in proportion.
 *
 * Used for one thing only: how much of what an offer promises its wallet could actually hand over
 * right now. It turns amber rather than accent below full, because that is the state where one fill
 * on a sibling offer has eaten into this one — the whole point of writing several offers against
 * one balance, and the thing a maker has to be able to see at a glance.
 *
 * It carries no accessible name and takes none. It used to be a `role="img"` whose `aria-label` was
 * a full teaching sentence — the one thing this screen bans — so a screen reader got prose and a
 * sighted reader got an unlabelled bar. The percentage beside it is the accessible figure; this is
 * the picture of it, and a picture of a number that is already on the row is decoration to a reader
 * who cannot see it.
 */
export function Meter({ value, cells = 9 }: { value: number; cells?: number }) {
  const clamped = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  const on = Math.round(clamped * cells);
  return (
    <span className={classes.meter} data-short={clamped < 0.999 || undefined} aria-hidden="true">
      {Array.from({ length: cells }, (_, i) => (
        <span key={i} className={classes.meterCell} data-on={i < on || undefined} />
      ))}
    </span>
  );
}

/**
 * One figure under the ticket's controls: a label, a number, and the unit the number counts.
 *
 * It is a three-column grid rather than a flex row, and that is the whole point of the component.
 * The three figures used to be "right-aligned" by each rendering its own value-plus-unit blob and
 * letting `justify-content: space-between` push it to the edge, which right-aligned the *unit* and
 * left the digits ragged: `+4.25 USDC` and `2,604.25 USDC` landed with their last glyph at the same
 * x, but the `%` on the row below is one character wide, so its number sat 26px right of the other
 * two and at a different size. Here the numeric column and the unit column are separate tracks, so
 * the digits form a rail and every unit starts at the same x, `%` included — a unit is a unit.
 */
export function FigureRow({
  label,
  unit,
  children,
  className,
}: {
  label: string;
  /** `USDC`, `%`. Rendered in its own fixed track so the digits above it line up. */
  unit?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(classes.figure, className)}>
      <span className={classes.figureLabel}>{label}</span>
      <span className={classes.figureValue}>{children}</span>
      <span className={classes.figureUnit}>{unit}</span>
    </div>
  );
}
