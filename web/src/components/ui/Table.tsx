'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
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
}

/**
 * A real `<table>`, because a book of legs is tabular data: row and column headers, `scope`, and
 * the navigation a screen reader user already has for tables. A grid of divs would throw all of
 * that away for nothing.
 *
 * Wide tables scroll inside their own container rather than pushing the page sideways. The
 * container is the scroll port, so `THead`'s `sticky` sticks to it.
 */
export function Table({
  caption,
  hideCaption = false,
  minWidth = '44rem',
  className,
  containerClassName,
  children,
  ...props
}: TableProps) {
  return (
    <div className={cn('w-full overflow-x-auto', containerClassName)}>
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
  );
}

export interface TableHeadProps extends ComponentPropsWithRef<'thead'> {
  /**
   * Pin the header while the body scrolls. Needs a scroll port with a height — inside a page that
   * scrolls as a whole, the header pins to the viewport, which is what a long book wants.
   */
  sticky?: boolean;
}

export function TableHead({ sticky = true, className, ...props }: TableHeadProps) {
  return (
    <thead
      className={cn(
        // The background is opaque so rows cannot show through as they pass under it.
        sticky && 'sticky top-0 z-sticky bg-surface',
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
