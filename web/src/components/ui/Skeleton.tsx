'use client';

import type { ComponentPropsWithRef } from 'react';
import { cn } from '@/lib/ui';
import styles from './motion.module.css';

export interface SkeletonProps extends ComponentPropsWithRef<'div'> {
  /** `control` (8px) for inline placeholders, `card` (10px) for a whole block, `pill` for a pill. */
  radius?: 'control' | 'card' | 'pill';
  /**
   * Render a `<span>` instead of a `<div>`, for a placeholder that sits inside a paragraph.
   *
   * Not cosmetic. A `<div>` inside a `<p>` is invalid HTML, and the parser does not merely tolerate
   * it: it implicitly closes the paragraph, so the DOM the browser builds from the server's markup
   * has a different SHAPE from the tree React rendered. React reports that as a hydration mismatch
   * and throws the entire server tree away -- one red console error on every route that has a
   * footer. It is also the only way this component can go wrong at a distance, so it lives here
   * rather than in the caller.
   */
  inline?: boolean;
  /**
   * What is loading, for assistive technology: "maker book". Supplying it makes this skeleton the
   * announcing one (`role="status"`); leave it off for the other skeletons in the same group so a
   * screen reader hears the region once rather than once per placeholder.
   */
  label?: string;
}

/**
 * Loading placeholder. DESIGN.md rules out spinners for data, so every data surface loads into a
 * skeleton whose shape matches the content it is standing in for — a 4-row table loads as 4 rows.
 *
 * The sweep is a CSS-module keyframe with its own `prefers-reduced-motion` branch that removes the
 * gradient entirely, leaving a flat block rather than a frozen highlight.
 */
export function Skeleton({ radius = 'control', inline = false, label, className, ...props }: SkeletonProps) {
  const announcing = Boolean(label);
  const Tag = inline ? 'span' : 'div';
  return (
    <Tag
      role={announcing ? 'status' : undefined}
      aria-busy={announcing || undefined}
      aria-hidden={announcing ? undefined : 'true'}
      className={cn(
        styles.sweep,
        'bg-surface-2',
        inline && 'inline-block',
        radius === 'card' ? 'rounded-card' : radius === 'pill' ? 'rounded-pill' : 'rounded-control',
        className,
      )}
      {...props}
    >
      {announcing ? <span className="sr-only">Loading {label}</span> : null}
    </Tag>
  );
}

/**
 * A block of text-shaped skeletons. The last line is short, the way a real paragraph ends, so the
 * placeholder does not read as a solid rectangle.
 */
export function SkeletonText({
  lines = 3,
  label,
  className,
}: {
  lines?: number;
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          label={i === 0 ? label : undefined}
          className={cn('h-3.5', i === lines - 1 ? 'w-2/5' : 'w-full')}
        />
      ))}
    </div>
  );
}
