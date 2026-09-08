'use client';

import { createContext, useContext, type ElementType, type ReactNode } from 'react';
import { cn } from '@/lib/ui';

/**
 * Nesting depth. DESIGN.md rules out nested cards, so rather than trusting every caller to
 * remember, a Card rendered inside a Card drops its own border and background and becomes a plain
 * region. The layout still works, the visual law still holds, and development gets a warning
 * naming the offender.
 */
const CardDepth = createContext(0);

export interface CardProps {
  /** Section heading. Omit for a card that is only a container. */
  title?: ReactNode;
  /** One line under the title saying what the numbers are. */
  description?: ReactNode;
  /** Controls on the title row. The card's primary action goes last. */
  actions?: ReactNode;
  /** A rule and a row under the body: a total, a timestamp, a secondary link. */
  footer?: ReactNode;
  /** Heading level. A card inside a page with an h1 wants h2; inside a section, h3. */
  titleAs?: Extract<ElementType, 'h2' | 'h3' | 'h4'>;
  /**
   * Drop the body padding, for a card whose entire body is a Table (the table draws its own cell
   * padding and its header rule has to meet the card's border).
   */
  flush?: boolean;
  className?: string;
  /** Applied to the body wrapper, not to the card. */
  bodyClassName?: string;
  children?: ReactNode;
}

/**
 * A card marks one genuinely separable object: a position, a strategy, a leg. A list of numbers is
 * a Table, and a row of unrelated figures is a row of StatTiles. Elevation comes from a 1px
 * hairline, never a shadow.
 */
export function Card({
  title,
  description,
  actions,
  footer,
  titleAs: Title = 'h2',
  flush = false,
  className,
  bodyClassName,
  children,
}: CardProps) {
  const depth = useContext(CardDepth);
  const nested = depth > 0;

  if (nested && process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.warn(
      '<Card> is nested inside another <Card>. DESIGN.md forbids nested cards; the inner one is ' +
        'rendering as a plain region. Use a section heading and a hairline instead.',
    );
  }

  const header = title || description || actions;

  return (
    <CardDepth.Provider value={depth + 1}>
      <section
        className={cn(
          'flex min-w-0 flex-col',
          !nested && 'rounded-card border border-line bg-surface',
          className,
        )}
      >
        {header ? (
          <div
            className={cn(
              'flex flex-wrap items-start justify-between gap-x-4 gap-y-2',
              nested ? 'pb-3' : 'px-4 pt-4 pb-3',
            )}
          >
            <div className="min-w-0">
              {title ? <Title className="text-lead font-medium text-ink">{title}</Title> : null}
              {description ? (
                <p className="mt-1 max-w-prose text-mini leading-prose text-ink-3">{description}</p>
              ) : null}
            </div>
            {actions ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
            ) : null}
          </div>
        ) : null}

        {children !== undefined ? (
          <div
            className={cn(
              'min-w-0 flex-1',
              !flush && !nested && (header ? 'px-4 pb-4' : 'p-4'),
              bodyClassName,
            )}
          >
            {children}
          </div>
        ) : null}

        {footer ? (
          <div
            className={cn(
              'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-mini text-ink-3',
              nested ? 'mt-3 border-t border-line pt-3' : 'border-t border-line px-4 py-3',
            )}
          >
            {footer}
          </div>
        ) : null}
      </section>
    </CardDepth.Provider>
  );
}

/**
 * A labelled row inside a card body: label on the left in `--ink-3`, value on the right in mono.
 * The pattern a terminal uses for a handful of facts that do not deserve a table.
 */
export function CardRow({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 py-1.5 leading-num',
        className,
      )}
    >
      <span className="min-w-0 text-meta text-ink-3">{label}</span>
      <span className="min-w-0 text-right text-meta text-ink">{children}</span>
    </div>
  );
}
