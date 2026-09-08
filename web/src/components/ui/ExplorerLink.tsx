'use client';

import { ArrowUpRight } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '@/lib/ui';
import { ICON_STROKE } from './icon';

export interface ExplorerLinkProps extends Omit<ComponentPropsWithRef<'a'>, 'href' | 'children'> {
  /** Absolute URL. There is no explorer for fork-local state, so callers pass `undefined` instead. */
  href: string;
  /** Reads on its own out of context: "0x1111…a90a on Basescan", never "here" or "link". */
  children: ReactNode;
  /** Drops the arrow, for a link inside a sentence where the glyph would break the line. */
  bare?: boolean;
  /** Mono and tabular, for an address or a hash. */
  mono?: boolean;
}

/**
 * A link out to a block explorer.
 *
 * `target="_blank"` is deliberate — a maker checking an address should not lose the terminal state
 * they are checking it against — and it carries the arrow glyph plus an "opens in a new tab" note
 * in the accessible name, so the behaviour is announced rather than sprung.
 */
export function ExplorerLink({
  href,
  children,
  bare = false,
  mono = false,
  className,
  ...props
}: ExplorerLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        'inline-flex items-center gap-1 rounded-control text-accent transition-state',
        'hover:underline hover:underline-offset-2',
        mono && 'font-mono tnum',
        className,
      )}
      {...props}
    >
      {children}
      {bare ? null : (
        <ArrowUpRight size={16} strokeWidth={ICON_STROKE} aria-hidden="true" className="shrink-0" />
      )}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
