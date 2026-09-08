'use client';

import type { ComponentPropsWithRef } from 'react';
import { cn } from '@/lib/ui';
import styles from './motion.module.css';

export interface SkeletonProps extends ComponentPropsWithRef<'div'> {
  /** `control` (8px) for inline placeholders, `card` (10px) for a whole block, `pill` for a pill. */
  radius?: 'control' | 'card' | 'pill';
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
export function Skeleton({ radius = 'control', label, className, ...props }: SkeletonProps) {
  const announcing = Boolean(label);
  return (
    <div
      role={announcing ? 'status' : undefined}
      aria-busy={announcing || undefined}
      aria-hidden={announcing ? undefined : 'true'}
      className={cn(
        styles.sweep,
        'bg-surface-2',
        radius === 'card' ? 'rounded-card' : radius === 'pill' ? 'rounded-pill' : 'rounded-control',
        className,
      )}
      {...props}
    >
      {announcing ? <span className="sr-only">Loading {label}</span> : null}
    </div>
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
