import Link from 'next/link';
import { cn } from '@/lib/ui';

/**
 * The mark is a load line: a hull section with a horizontal line struck through it at the depth the
 * vessel is loaded to. On a ship that line is the limit past which you must not load; here it is the
 * share of a maker's inventory that is committed to strategies. It is two primitives — a circle and
 * a rule — so it stays legible at 16px and needs no gradient, no glyph and no mascot.
 *
 * The filled segment is the accent, and it is the only accent-coloured pixel in the top bar when
 * nothing is selected, which is exactly the weight a wordmark should carry.
 */
export function WordmarkMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn('shrink-0', className)}
    >
      {/* Loaded volume: the lower half of the section, under the line. */}
      <path d="M3.5 12a8.5 8.5 0 0 0 17 0Z" fill="var(--accent)" fillOpacity="0.9" />
      {/* Hull section. */}
      <circle cx="12" cy="12" r="8.5" stroke="var(--ink)" strokeWidth="1.5" />
      {/* The load line, struck past the hull on both sides the way it is painted on a bow. */}
      <path d="M1.25 12h21.5" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export interface WordmarkProps {
  className?: string;
  /** Wraps the mark in a link to the overview. */
  href?: string;
}

export function Wordmark({ className, href = '/' }: WordmarkProps) {
  const content = (
    <>
      <WordmarkMark />
      <span className="text-lead font-semibold text-ink">
        Aqua<span className="text-ink-2"> Terminal</span>
      </span>
    </>
  );

  if (!href) {
    return <span className={cn('inline-flex items-center gap-2.5', className)}>{content}</span>;
  }

  return (
    <Link
      href={href}
      aria-label="Aqua Terminal, overview"
      className={cn(
        'inline-flex items-center gap-2.5 rounded-control transition-state hover:opacity-80',
        className,
      )}
    >
      {content}
    </Link>
  );
}
