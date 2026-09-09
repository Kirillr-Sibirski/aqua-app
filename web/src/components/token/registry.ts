/**
 * What the app knows about a token beyond its address.
 *
 * Two things, and they are here rather than in the components because both are decisions about
 * *reading* rather than about drawing:
 *
 * 1. **Which mark to draw.** Keyed on the symbol, because that is what every call site already has
 *    in hand — the pair is assembled from a deployment manifest, not from a token list with logo
 *    URLs. An unknown symbol is not an error; it gets the neutral mark.
 * 2. **How many fraction digits a human wants.** This is the fix for the raggedest thing in a
 *    numeric column: `10.40` on one row and `9.92515` on the next, because a significant-digit
 *    budget spends itself differently at different magnitudes. A token's display precision is a
 *    property of the token — USDC is a price, so two places; WETH is a size, so four; cbBTC is
 *    worth twenty ETH, so six — and once it is fixed per token, every row in a column has the same
 *    number of digits after the point and the decimal points line up. The exact value is never
 *    lost: `TokenAmount` carries full precision in its `title`, and `formatUnits` renders a value
 *    too small for the chosen precision as `<0.0001` rather than as `0`.
 *
 * Raw 18-decimal strings do not reach the screen. Nothing here invents precision either — the
 * digits shown are always the leading digits of the bigint the chain returned.
 */

/** The marks this app draws. One per brand, plus the neutral fallback. */
export type TokenMark = 'ethereum' | 'usdc' | 'cbbtc' | 'unknown';

export interface TokenMeta {
  /** Canonical symbol, as it should be printed. */
  symbol: string;
  /** Which mark `TokenIcon` draws. */
  mark: TokenMark;
  /**
   * Fraction digits, fixed. Not a maximum and not a minimum: exactly this many, so a column of
   * these cannot go ragged and a figure cannot change width as it updates.
   */
  fractionDigits: number;
  /** For an `aria-label` and a `title` where the icon stands alone. */
  name: string;
}

/**
 * Keyed by upper-cased symbol. Aliases are deliberate: a wrapper is the same asset to a reader, so
 * WETH draws the Ethereum diamond and cbBTC draws a bitcoin, and the differences that matter
 * (which contract, which decimals) are carried by the address the caller already has.
 */
const REGISTRY: Record<string, TokenMeta> = {
  ETH: { symbol: 'ETH', mark: 'ethereum', fractionDigits: 4, name: 'Ether' },
  WETH: { symbol: 'WETH', mark: 'ethereum', fractionDigits: 4, name: 'Wrapped Ether' },
  USDC: { symbol: 'USDC', mark: 'usdc', fractionDigits: 2, name: 'USD Coin' },
  USDBC: { symbol: 'USDbC', mark: 'usdc', fractionDigits: 2, name: 'USD Base Coin' },
  CBBTC: { symbol: 'cbBTC', mark: 'cbbtc', fractionDigits: 6, name: 'Coinbase Wrapped BTC' },
  WBTC: { symbol: 'WBTC', mark: 'cbbtc', fractionDigits: 6, name: 'Wrapped Bitcoin' },
};

/** Four places is the default a size wants; a token that is a price overrides it to two. */
const UNKNOWN_FRACTION_DIGITS = 4;

/** Look a symbol up, case-insensitively. Never throws; an unknown symbol gets the neutral mark. */
export function tokenMeta(symbol: string | undefined): TokenMeta {
  const key = (symbol ?? '').trim().toUpperCase();
  const known = REGISTRY[key];
  if (known) return known;
  return {
    symbol: (symbol ?? '').trim(),
    mark: 'unknown',
    fractionDigits: UNKNOWN_FRACTION_DIGITS,
    name: symbol?.trim() || 'Unknown token',
  };
}

/**
 * The fixed fraction digits for a symbol.
 *
 * @example tokenFractionDigits('USDC') // 2  ->  '2,442.43'
 * @example tokenFractionDigits('WETH') // 4  ->  '10.4000'
 */
export function tokenFractionDigits(symbol: string | undefined): number {
  return tokenMeta(symbol).fractionDigits;
}

/** The single character the neutral mark carries. Empty when there is no symbol to carry. */
export function fallbackInitial(symbol: string | undefined): string {
  const trimmed = (symbol ?? '').trim();
  if (!trimmed) return '';
  // A wrapper prefix is not the token: `cbBTC` should read `B`, not `C`.
  const stripped = /^(w|cb|x|st|a|y)[A-Z]/.test(trimmed) ? trimmed.replace(/^(w|cb|x|st|a|y)/, '') : trimmed;
  return (stripped[0] ?? trimmed[0] ?? '').toUpperCase();
}

/**
 * A quantity cut down to the token's own display precision, as a bigint at the token's decimals.
 *
 * Cut, never rounded, and the direction is the whole point rather than a detail.
 *
 * A wallet holding `10.330261849452817572 WETH` is four places to a reader, and there are two ways
 * to get there. Rounding gives `10.3303`; truncating gives `10.3302`. Both are defensible in
 * isolation and the app was doing one in each of the two places it prints this number — the
 * ticket's `MAX` truncates, because what MAX writes into the field has to be spendable, and the
 * positions strip's promised-over-held ratio rounded, because that is what a formatter does by
 * default. So one screen printed `MAX 10.3302` and `165.8698 / 10.3303 WETH` two hundred pixels
 * apart, and the fourth decimal of the wallet's balance disagreed with itself.
 *
 * Truncation wins both places. A balance that rounds up prints more of the asset than the wallet
 * holds, which is wrong anywhere and specifically wrong as the denominator of a solvency ratio: the
 * one figure on this screen whose job is to say how much the book has over-promised must not
 * overstate what backs it. The dust below the fourth place is three cents of ETH.
 *
 * `tokenFractionDigits` says how many places; this says which way the ones past them go. The two
 * belong together, which is why they live in the same file.
 */
export function floorToTokenDigits(value: bigint, decimals: number, symbol: string | undefined): bigint {
  const places = tokenFractionDigits(symbol);
  const step = BigInt(10) ** BigInt(Math.max(0, decimals - places));
  if (step === BigInt(1)) return value;
  // BigInt division truncates toward zero, which is what "cut" means on both signs.
  return (value / step) * step;
}
