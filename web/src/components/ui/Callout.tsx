'use client';

import { AlertTriangle, CircleCheck, Info, OctagonAlert } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { cn } from '@/lib/ui';
import { ICON_SIZE, ICON_STROKE, type IconComponent } from './icon';

export const calloutVariants = cva('rounded-card border px-4 py-3', {
  variants: {
    tone: {
      info: 'border-line bg-surface',
      accent: 'border-accent-dim bg-[color-mix(in_oklch,var(--accent)_8%,transparent)]',
      warning: 'border-warn/30 bg-warn/8',
      error: 'border-neg/30 bg-neg/8',
      positive: 'border-pos/30 bg-pos/8',
    },
  },
  defaultVariants: { tone: 'info' },
});

export type CalloutTone = NonNullable<VariantProps<typeof calloutVariants>['tone']>;

const TONE: Record<CalloutTone, { icon: IconComponent; color: string; role?: 'alert' | 'status' }> = {
  info: { icon: Info, color: 'text-ink-3' },
  accent: { icon: Info, color: 'text-accent' },
  warning: { icon: AlertTriangle, color: 'text-warn', role: 'status' },
  error: { icon: OctagonAlert, color: 'text-neg', role: 'alert' },
  positive: { icon: CircleCheck, color: 'text-pos', role: 'status' },
};

export interface CalloutProps {
  tone?: CalloutTone;
  /** One line. The sentence a maker reads first. */
  title?: ReactNode;
  /** Replaces the tone's default icon. */
  icon?: IconComponent;
  /** One control, right-aligned on a wide viewport. */
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/**
 * An inline note attached to the thing it is about — a stale oracle above the price, a wrong
 * network above the book. Never a modal: an interruption that can be read in place should be read
 * in place.
 *
 * Warning and error tones carry a live-region role so a callout that appears in response to an
 * action is announced; the info tone does not, because a note that is simply part of the page
 * should not interrupt.
 */
export function Callout({ tone = 'info', title, icon, action, className, children }: CalloutProps) {
  const t = TONE[tone];
  const Icon = icon ?? t.icon;

  return (
    <div role={t.role} className={cn(calloutVariants({ tone }), className)}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <Icon
          size={ICON_SIZE.sm}
          strokeWidth={ICON_STROKE}
          aria-hidden="true"
          className={cn('mt-0.5 shrink-0', t.color)}
        />
        <div className="min-w-56 flex-1 leading-prose">
          {title ? <p className="text-body font-medium text-ink">{title}</p> : null}
          {children ? (
            <div className={cn('text-meta text-ink-2', title && 'mt-1')}>{children}</div>
          ) : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
    </div>
  );
}
