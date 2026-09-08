'use client';

import { useCallback, useEffect, useRef, useState, type ComponentPropsWithRef, type ReactNode } from 'react';
import { cn } from '@/lib/ui';
import { Skeleton } from './Skeleton';

export interface TableProps extends ComponentPropsWithRef<'table'> {
  /**
   * Describes the table for assistive technology: "Legs in this book". Rendered visibly above the
   * table unless `hideCaption` is set, in which case it stays in the accessibility tree only.
   */
  caption?: ReactNode;
  hideCaption?: boolean;
  /** Smallest width before the container scrolls horizontally. Default 44rem. */
  minWidth?: string;
  /** Applied to the scroll container. */
  containerClassName?: string;
  /**
   * What is off the right edge, named. Shown only while the table actually overflows and there is
   * more to the right: "deliverable depth, theta band, realised theta".
   */
  scrollHint?: string;
}

/**
 * A real `<table>`, because a book of legs is tabular data: row and column headers, `scope`, and
 * the navigation a screen reader user already has for tables. A grid of divs would throw all of
 * that away for nothing.
 *
 * Wide tables scroll inside their own container rather than pushing the page sideways. The
 * container is the scroll port, so `THead`'s `sticky` sticks to it.
 *
 * At 390px the legs table is 1081px wide inside a 390px viewport, and the columns the product
 * exists to show are all off the right edge. Silent overflow is the same failure as hiding them, so
 * the container measures itself and names what is out there while there is more to scroll to.
 */
export function Table({
  caption,
  hideCaption = false,
  minWidth = '44rem',
  className,
  containerClassName,
  scrollHint,
  children,
  ...props
}: TableProps) {
  const port = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  const measure = useCallback(() => {
    const el = port.current;
    if (!el) return;
    // 2px of slack: sub-pixel layout leaves a fractional remainder at the true end of the scroll.
    setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 2);
  }, []);

  useEffect(() => {
    const el = port.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', measure);
    };
  }, [measure]);

  return (
    <div className="relative w-full">
      <div ref={port} className={cn('w-full overflow-x-auto', containerClassName)}>
        <table
          className={cn('w-full border-collapse text-left', className)}
          style={{ minWidth }}
          {...props}
        >
          {caption ? (
            <caption
              className={cn(
                hideCaption ? 'sr-only' : 'px-4 pb-3 text-left text-mini text-ink-3',
              )}
            >
              {caption}
            </caption>
          ) : null}
          {children}
        </table>
      </div>

      {/* A hairline and a label, not a shadow and not a fade: the edge is the affordance, and the
          label says what is behind it so the columns are discoverable rather than merely reachable. */}
      {more ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 flex items-start justify-end border-r border-line-strong bg-bg/80 pt-1.5 pr-1 pl-2"
        >
          <span className="text-mini whitespace-nowrap text-ink-3">{scrollHint ?? 'more'} &rarr;</span>
        </div>
      ) : null}
    </div>
  );
}

export interface TableHeadProps extends ComponentPropsWithRef<'thead'> {
  /**
   * Pin the header while the body scrolls. Needs a scroll port with a height — inside a page that
   * scrolls as a whole, the header pins to the viewport, which is what a long book wants.
   *
   * It pins to `--header-h`, not to 0. The app bar is also sticky at the top of the viewport, so a
   * `top-0` thead slid underneath it: scrolled down a long table, the column headers were completely
   * hidden and a half-clipped row bled through the bar. The affordance fired exactly never.
   */
  sticky?: boolean;
}

export function TableHead({ sticky = true, className, ...props }: TableHeadProps) {
  return (
    <thead
      className={cn(
        // The background is opaque so rows cannot show through as they pass under it.
        sticky && 'sticky top-header z-sticky bg-surface',
        '[&_th]:border-b [&_th]:border-line-strong',
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: ComponentPropsWithRef<'tbody'>) {
  return <tbody className={cn('[&_tr+tr>td]:border-t [&_tr+tr>td]:border-line', className)} {...props} />;
}

export interface TableRowProps extends ComponentPropsWithRef<'tr'> {
  /** Marks the maker's own row. Draws a 1px accent rule at the left edge of the first cell. */
  highlighted?: boolean;
  /** Adds hover feedback. Set it only when the row actually does something on click or Enter. */
  interactive?: boolean;
}

export function TableRow({ highlighted, interactive, className, ...props }: TableRowProps) {
  return (
    <tr
      data-highlighted={highlighted || undefined}
      className={cn(
        'transition-state',
        interactive && 'cursor-pointer hover:bg-surface-2',
        highlighted && 'bg-[color-mix(in_oklch,var(--accent)_8%,transparent)]',
        className,
      )}
      {...props}
    />
  );
}

export interface TableCellProps extends ComponentPropsWithRef<'td'> {
  /** Right-aligned, mono, tabular. Every figure a person might compare digit by digit. */
  numeric?: boolean;
}

/** 44px rows, 12/16px cell padding — the geometry DESIGN.md fixes for a dense book. */
const CELL = 'h-11 px-4 py-3 align-middle';

export function TableCell({ numeric, className, ...props }: TableCellProps) {
  return (
    <td
      className={cn(
        CELL,
        'text-meta text-ink',
        numeric && 'text-right font-mono tnum leading-num',
        className,
      )}
      {...props}
    />
  );
}

export interface TableHeaderCellProps extends ComponentPropsWithRef<'th'> {
  numeric?: boolean;
  /** `col` (the default) for a column header, `row` for a row header inside `<tbody>`. */
  scope?: 'col' | 'row';
}

export function TableHeaderCell({
  numeric,
  scope = 'col',
  className,
  ...props
}: TableHeaderCellProps) {
  return (
    <th
      scope={scope}
      className={cn(
        'h-9 px-4 py-2 align-middle text-micro font-normal uppercase text-ink-3',
        numeric && 'text-right',
        scope === 'row' && cn(CELL, 'text-meta font-normal normal-case text-ink'),
        className,
      )}
      {...props}
    />
  );
}

/** One cell spanning the table, for the empty and error states inside a `<tbody>`. */
export function TableMessageRow({
  colSpan,
  children,
  className,
}: {
  colSpan: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className={cn('px-4 py-10 text-center text-meta text-ink-3', className)}>
        {children}
      </td>
    </tr>
  );
}

/**
 * Skeleton rows matching the real ones' geometry, so the table does not resize when data lands.
 * The widths alternate rather than being identical, because a column of equal grey bars reads as a
 * rendering bug.
 */
export function TableSkeletonRows({
  rows = 4,
  columns,
  label,
}: {
  rows?: number;
  columns: number;
  label?: string;
}) {
  const widths = ['w-24', 'w-16', 'w-20', 'w-28', 'w-14'];
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r}>
          {Array.from({ length: columns }, (_, c) => (
            <td key={c} className={CELL}>
              <Skeleton
                label={r === 0 && c === 0 ? label : undefined}
                className={cn('h-3.5', widths[(r + c) % widths.length], c > 0 && 'ml-auto')}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
