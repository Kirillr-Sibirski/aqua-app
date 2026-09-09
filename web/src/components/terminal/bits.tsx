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
 */
export function Meter({ value, cells = 9, label }: { value: number; cells?: number; label?: string }) {
  const clamped = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  const on = Math.round(clamped * cells);
  return (
    <span
      className={classes.meter}
      data-short={clamped < 0.999 || undefined}
      role="img"
      aria-label={label}
      title={label}
    >
      {Array.from({ length: cells }, (_, i) => (
        <span key={i} className={classes.meterCell} data-on={i < on || undefined} />
      ))}
    </span>
  );
}

/** One right-aligned figure row under the ticket's controls. */
export function FigureRow({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(classes.figure, className)}>
      <span className={classes.figureLabel}>{label}</span>
      {children}
    </div>
  );
}
