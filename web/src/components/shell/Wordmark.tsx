import { cn } from '@/lib/ui';

/**
 * The mark is the position itself, drawn.
 *
 * A covered call's payoff rises with spot until the strike and is flat above it. Two strokes: the
 * ink diagonal is the inventory the maker keeps, and the accent horizontal is the strike — the
 * line the payoff runs along once the option is in the money. That horizontal is the strikeline,
 * and it is the only accent-coloured pixel in the top bar when nothing is selected, which is the
 * weight a wordmark should carry.
 *
 * Two primitives, no gradient, no glyph, no mascot. It survives being drawn at 16px in a favicon
 * and at 1px in a screenshot, and a reader who knows options recognises it without a caption.
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
      {/* Below the strike: long the underlying, one for one. */}
      <path
        d="M3 19.5 11 9"
        stroke="var(--ink)"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* At and above the strike: capped. This is the strikeline. */}
      <path d="M11 9h10" stroke="var(--accent)" strokeWidth="1.75" strokeLinecap="round" />
      {/* The strike price, marked where the payoff turns. */}
      <circle cx="11" cy="9" r="1.9" fill="var(--bg)" stroke="var(--accent)" strokeWidth="1.75" />
    </svg>
  );
}
