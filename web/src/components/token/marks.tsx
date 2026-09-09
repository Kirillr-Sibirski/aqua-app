/**
 * The token marks, drawn rather than fetched.
 *
 * Every one is inline SVG in a 24-unit box, which buys four things a remote `<img>` cannot:
 *
 *   - **No request, no flash.** A token list's logo URL is a network round trip on first paint and
 *     an empty square until it lands. A row of positions that pops its icons in one by one is the
 *     single most demo-like thing a trading screen can do.
 *   - **currentColor where it belongs.** The neutral mark is drawn entirely in `currentColor`, so it
 *     takes the text colour of whatever it sits beside. A brand mark cannot do that — its colour is
 *     the brand's — so `TokenIcon`'s `dim` prop is what fades those with the row they are in.
 *   - **Crisp at 16.** Geometry authored against a 24 grid, with stroke widths chosen so nothing
 *     lands on a half pixel at either shipped size.
 *   - **One theme's worth of contrast, checked.** These are the only saturated colours in the app
 *     that are not `--accent`, `--pos` or `--neg`; each brand disc is light enough to separate from
 *     `--bg` (oklch 0.155) without a ring, and every glyph inside one is white.
 *
 * Each mark fills its box edge to edge, so the three of them are optically the same size and a
 * `rounded-full` on the element is the whole clipping story.
 *
 * The colours are the brands' own. Nothing else in the app may use them.
 */
import type { CSSProperties } from 'react';
import { cn } from '@/lib/ui';
import { fallbackInitial } from './registry';

export interface MarkProps {
  size: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * WETH / ETH — the Ethereum octahedron.
 *
 * Six faces, at the brand's own three opacities: the two front faces solid, the two receding faces
 * at 0.60, and the upper-right inner facet at 0.20. Flattening them to one white silhouette is what
 * makes an ETH mark read as a generic diamond; the facets are what make it read as Ethereum, and
 * they survive to 16px as a soft bevel rather than as detail.
 *
 * Proportions are the brand's — 15 wide to 24 tall, apex to apex — at 64% of the disc, which is
 * where a coin-style ETH mark sits and where the diamond stops reading as a distant speck.
 */
export function EthereumMark({ size, className, style }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={cn('shrink-0 rounded-full', className)}
      style={style}
    >
      <circle cx="12" cy="12" r="12" fill="#627EEA" />
      <g fill="#FFFFFF">
        <path d="M12 4.3v5.69l4.81 2.15z" fillOpacity="0.602" />
        <path d="M12 4.3 7.19 12.14 12 9.99z" />
        <path d="M12 15.83v3.87l4.81-6.66z" fillOpacity="0.602" />
        <path d="M12 19.7v-3.87l-4.81-2.79z" />
        <path d="m12 14.94 4.81-2.8L12 9.99z" fillOpacity="0.2" />
        <path d="m7.19 12.14 4.81 2.8V9.99z" fillOpacity="0.602" />
      </g>
    </svg>
  );
}

/**
 * USDC — the dollar inside Circle's broken ring.
 *
 * The ring is two 144-degree arcs with the gaps at twelve and six o'clock, which is the part of the
 * mark a reader actually recognises from across a table; the dollar is a stroked S through a bar
 * rather than a font glyph, so it renders identically on every machine and cannot be swapped out by
 * a missing webfont.
 */
export function UsdcMark({ size, className, style }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={cn('shrink-0 rounded-full', className)}
      style={style}
    >
      <circle cx="12" cy="12" r="12" fill="#2775CA" />
      <g fill="none" stroke="#FFFFFF" strokeLinecap="round">
        {/* The broken ring: right arc, then left. */}
        <path d="M14.19 5.25a7.1 7.1 0 0 1 0 13.5" strokeWidth="1.5" />
        <path d="M9.81 5.25a7.1 7.1 0 0 0 0 13.5" strokeWidth="1.5" />
        {/* The bar through the S. */}
        <path d="M12 7v10" strokeWidth="1.45" />
        {/* The S. */}
        <path
          d="M14.4 9.75c0-1.05-1.05-1.65-2.4-1.65s-2.4.65-2.4 1.9c0 1.15 1 1.6 2.4 2s2.4.85 2.4 2.05c0 1.25-1.05 1.85-2.4 1.85s-2.4-.6-2.4-1.65"
          strokeWidth="1.45"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

/**
 * cbBTC — Coinbase Wrapped BTC.
 *
 * Coinbase blue with the bitcoin B in white: the wrapper's own treatment, and the thing that tells
 * it apart from bitcoin orange at a glance, which is the distinction that matters when a screen can
 * show both. Two bowls and four ticks, stroked, so the counters stay open at 16px where a filled
 * glyph would close up.
 *
 * The group is scaled about the disc's centre rather than redrawn at the larger numbers. Set beside
 * the other two at the same `size`, the ₿ drawn to its own natural proportions read visibly smaller
 * and lighter than the ETH diamond: it is a tall narrow glyph made of strokes where the diamond is
 * a wide solid. 1.12 is what put the three on the same optical weight, and taking it as a transform
 * carries the stroke widths up with it, which is half of what was missing.
 */
export function CbBtcMark({ size, className, style }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={cn('shrink-0 rounded-full', className)}
      style={style}
    >
      <circle cx="12" cy="12" r="12" fill="#0052FF" />
      <g
        fill="none"
        stroke="#FFFFFF"
        strokeLinecap="butt"
        transform="translate(12 12) scale(1.12) translate(-12.02 -12)"
      >
        {/* The two strokes that make a B a ₿. */}
        <path d="M10.9 6.05v2.1M12.6 6.05v2.1M10.9 15.85v2.1M12.6 15.85v2.1" strokeWidth="1.4" />
        {/* Stem, upper bowl, lower bowl. */}
        <path d="M9.45 8.15v7.7" strokeWidth="1.5" />
        <path d="M9.45 8.15h2.6a1.85 1.85 0 0 1 0 3.7h-2.6" strokeWidth="1.5" />
        <path d="M9.45 11.85h3.15a2 2 0 0 1 0 4H9.45" strokeWidth="1.5" />
      </g>
    </svg>
  );
}

/**
 * Anything else.
 *
 * A mark, not a broken image, and not a coloured disc pretending to be a brand: a hairline ring in
 * the inherited text colour with the token's own initial inside it, or a hexagon when there is no
 * symbol to take an initial from. It reads as "a token this app has no logo for", which is the
 * truth, and it dims with the row it sits in because everything in it is `currentColor`.
 */
export function UnknownMark({ size, className, style, symbol }: MarkProps & { symbol?: string }) {
  const initial = fallbackInitial(symbol);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={cn('shrink-0 rounded-full', className)}
      style={style}
    >
      <circle cx="12" cy="12" r="12" fill="currentColor" fillOpacity="0.1" />
      <circle
        cx="12"
        cy="12"
        r="11.15"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.42"
        strokeWidth="1.7"
      />
      {initial ? (
        <text
          x="12"
          y="12"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="11"
          fontWeight="500"
          className="font-mono"
          fill="currentColor"
          fillOpacity="0.85"
        >
          {initial}
        </text>
      ) : (
        <path
          d="M12 6.6l4.68 2.7v5.4L12 17.4l-4.68-2.7V9.3z"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.62"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
