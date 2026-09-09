/**
 * A token's mark, at the one size a row needs it.
 *
 * The layout rule this exists for: a token is never named without its mark. A bare "WETH" in a cell
 * is a string; the disc beside it is what lets someone find their WETH row without reading. So this
 * is deliberately trivial to reach for — one symbol, one size, no token list, no async.
 */
import type { CSSProperties } from 'react';
import { CbBtcMark, EthereumMark, UnknownMark, UsdcMark } from './marks';
import { tokenMeta } from './registry';

export interface TokenIconProps {
  /** Case-insensitive. An unknown symbol draws the neutral mark rather than nothing. */
  symbol: string | undefined;
  /** Rendered size in px. 20 in the ticket and the header, 16 in a dense row. */
  size?: number;
  className?: string;
  /** For the one thing a class cannot express: an overlap measured off `size`. */
  style?: CSSProperties;
  /**
   * Give the icon a name only when it is the sole carrier of the token's identity. Beside a printed
   * symbol — which is nearly every use in this app — it is decoration, and the default `aria-hidden`
   * keeps a screen reader from saying "WETH WETH".
   */
  label?: string;
}

export function TokenIcon({ symbol, size = 20, className, style, label }: TokenIconProps) {
  const meta = tokenMeta(symbol);
  const mark =
    meta.mark === 'ethereum' ? (
      <EthereumMark size={size} className={className} style={style} />
    ) : meta.mark === 'usdc' ? (
      <UsdcMark size={size} className={className} style={style} />
    ) : meta.mark === 'cbbtc' ? (
      <CbBtcMark size={size} className={className} style={style} />
    ) : (
      <UnknownMark size={size} className={className} style={style} symbol={symbol} />
    );

  if (!label) return mark;

  /* The mark itself stays `aria-hidden`; the name goes on a wrapper, so the accessible name is one
     string rather than a role juggled onto an <svg> that also has to lay out inline. */
  return (
    <span role="img" aria-label={label} className="inline-flex">
      {mark}
    </span>
  );
}
