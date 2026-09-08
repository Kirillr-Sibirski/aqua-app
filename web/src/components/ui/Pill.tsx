'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '@/lib/ui';
import { ICON_STROKE, type IconComponent } from './icon';

/**
 * Status pill.
 *
 * The label is a required child, never optional: DESIGN.md forbids colour as the only signal, so a
 * pill always says the word — "Active", "Docked", "Expired" — and the tone only reinforces it. The
 * dot is decorative and `aria-hidden`.
 */
export const pillVariants = cva(
  'inline-flex shrink-0 items-center gap-1.5 rounded-pill border bg-surface whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-line text-ink-2',
        accent: 'border-accent-dim text-accent',
        positive: 'border-pos/35 text-pos',
        negative: 'border-neg/35 text-neg',
        warning: 'border-warn/35 text-warn',
      },
      size: {
        sm: 'h-5 px-1.5 text-micro uppercase',
        md: 'h-6 px-2 text-micro uppercase',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
);

const DOT: Record<PillTone, string> = {
  neutral: 'bg-ink-3',
  accent: 'bg-accent',
  positive: 'bg-pos',
  negative: 'bg-neg',
  warning: 'bg-warn',
};

export type PillTone = NonNullable<VariantProps<typeof pillVariants>['tone']>;
export type PillSize = NonNullable<VariantProps<typeof pillVariants>['size']>;

export interface PillProps extends Omit<ComponentPropsWithRef<'span'>, 'children'> {
  tone?: PillTone;
  size?: PillSize;
  /** A 6px status dot before the label. Decorative — the label still carries the meaning. */
  dot?: boolean;
  /** A 16px lucide icon before the label, instead of the dot. */
  icon?: IconComponent;
  /** The label. Four words at most. */
  children: ReactNode;
}

export function Pill({ tone = 'neutral', size = 'md', dot, icon: Icon, className, children, ...props }: PillProps) {
  return (
    <span className={cn(pillVariants({ tone, size }), className)} {...props}>
      {dot ? (
        <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-pill', DOT[tone])} />
      ) : null}
      {Icon ? <Icon size={16} strokeWidth={ICON_STROKE} aria-hidden="true" className="-ml-0.5" /> : null}
      {children}
    </span>
  );
}
