import type { ReactNode } from 'react';
import { cn } from '@/lib/ui';

export interface PageHeaderProps {
  title: ReactNode;
  /** One line saying what this screen is for, or what the numbers on it mean. */
  subtitle?: ReactNode;
  /** Right-aligned controls. The primary action of the screen goes last. */
  actions?: ReactNode;
  /** Rendered under the title: a status pill, a hash, an address. */
  meta?: ReactNode;
  className?: string;
}

/**
 * The title block every screen opens with. The heading is the page's only `h1`; actions sit on the
 * same baseline on a wide viewport and wrap below the title on a narrow one, so the primary action
 * is never pushed off the edge.
 */
export function PageHeader({ title, subtitle, actions, meta, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-x-6 gap-y-4', className)}>
      <div className="min-w-0">
        <h1 className="text-title text-ink">{title}</h1>
        {subtitle ? (
          <p className="mt-1 max-w-prose text-body leading-prose text-ink-2">{subtitle}</p>
        ) : null}
        {meta ? <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
