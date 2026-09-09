/**
 * Display formatters. Every one is bigint-exact and locale-free.
 *
 * Two rules drive the design:
 *
 * 1. **No precision is invented and none is silently lost.** Rounding happens once, at the last
 *    step, on a decimal string derived from the bigint — never by way of `Number`. A non-zero
 *    balance that rounds away renders as `<0.00000001`, not as `0`, because this app does not show
 *    a number the chain did not produce.
 * 2. **Deterministic output.** No `Intl`, no `toLocaleString`. The server and the browser must emit
 *    byte-identical markup or React will complain about the mismatch, and a maker comparing two
 *    machines must see the same digits.
 *
 * Raw 18-decimal strings never reach the screen. `toDecimalString` exists for "show raw"
 * disclosures and clipboard payloads, and is the only function that returns full precision.
 */

const ELLIPSIS = '…';
const GROUP = ',';
const POINT = '.';

// tsconfig targets ES2017, where a bigint literal is a syntax error, so this codebase constructs
// them instead (src/lib/swapvm/math.ts does the same).
const ZERO = BigInt(0);
const ONE = BigInt(1);

/** How the sign is rendered. `auto` shows `-` only; `always` also shows `+` on positives. */
export type SignDisplay = 'auto' | 'always' | 'never';

// ---------------------------------------------------------------------------
// Fixed-point core
// ---------------------------------------------------------------------------

interface Fixed {
  neg: boolean;
  /** Integer digits, no separators, at least one character. */
  int: string;
  /** Fraction digits, exactly as many as the value's scale. May be empty. */
  frac: string;
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 96) {
    throw new RangeError(`format: decimals must be an integer in 0..96, got ${decimals}`);
  }
}

/** Split a fixed-point bigint into sign, integer digits and fraction digits. Lossless. */
function split(value: bigint, decimals: number): Fixed {
  assertDecimals(decimals);
  const neg = value < ZERO;
  const digits = (neg ? -value : value).toString().padStart(decimals + 1, '0');
  const cut = digits.length - decimals;
  return { neg, int: digits.slice(0, cut), frac: digits.slice(cut) };
}

/** Round a `Fixed` to `places` fraction digits, half away from zero. Carries into the integer. */
function roundTo(f: Fixed, places: number): Fixed {
  if (places >= f.frac.length) return { ...f, frac: f.frac.padEnd(places, '0') };
  const keep = f.frac.slice(0, places);
  if (f.frac.charCodeAt(places) < 53 /* '5' */) return { ...f, frac: keep };
  const bumped = (BigInt(f.int + keep) + ONE).toString().padStart(f.int.length + places, '0');
  const cut = bumped.length - places;
  return { neg: f.neg, int: bumped.slice(0, cut) || '0', frac: bumped.slice(cut) };
}

/** Drop trailing zeros, never going below `min` fraction digits. */
function trimFrac(frac: string, min: number): string {
  let end = frac.length;
  while (end > min && frac.charCodeAt(end - 1) === 48 /* '0' */) end -= 1;
  return frac.slice(0, end);
}

/** Insert thousands separators into a run of integer digits. */
function groupInt(int: string): string {
  if (int.length <= 3) return int;
  let out = '';
  for (let i = int.length; i > 0; i -= 3) {
    const start = Math.max(0, i - 3);
    out = int.slice(start, i) + (out ? GROUP + out : '');
  }
  return out;
}

function isZero(f: Fixed): boolean {
  return !/[1-9]/.test(f.int) && !/[1-9]/.test(f.frac);
}

function signPrefix(neg: boolean, display: SignDisplay): string {
  if (display === 'never') return '';
  if (neg) return '-';
  return display === 'always' ? '+' : '';
}

/** Leading zeros in the fraction, i.e. how far below 1 the magnitude sits. */
function leadingFracZeros(frac: string): number {
  const first = frac.search(/[1-9]/);
  return first === -1 ? frac.length : first;
}

// ---------------------------------------------------------------------------
// Exact rendering
// ---------------------------------------------------------------------------

/**
 * The value written out in full, with no rounding and no separators: `1234.000000000000000001`.
 * Use it for "show raw" disclosures, copy buttons and test assertions — never as the visible
 * figure in a table.
 */
export function toDecimalString(value: bigint, decimals: number): string {
  const f = split(value, decimals);
  const frac = trimFrac(f.frac, 0);
  return `${f.neg ? '-' : ''}${f.int}${frac ? POINT + frac : ''}`;
}

/**
 * Parse user input back into a fixed-point bigint. Returns `null` for anything that is not a plain
 * decimal number, and truncates (never rounds) digits beyond `decimals`, so typing cannot silently
 * inflate an amount.
 *
 * Accepts `1234.5`, `.5`, `1_000.25`, `1,000.25`, a leading `-`, and surrounding whitespace.
 */
export function parseDecimalInput(input: string, decimals: number): bigint | null {
  assertDecimals(decimals);
  const cleaned = input.trim().replace(/[_,]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === POINT) return null;
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return null;
  const [, sign, int = '', frac = ''] = match;
  if (int === '' && frac === '') return null;
  const scaled = BigInt(`${int || '0'}${frac.slice(0, decimals).padEnd(decimals, '0')}`);
  return sign === '-' ? -scaled : scaled;
}

// ---------------------------------------------------------------------------
// formatUnits
// ---------------------------------------------------------------------------

export interface FormatUnitsOptions {
  /**
   * Significant digits to keep, counted from the first non-zero digit, so leading zeros in a
   * sub-unit value do not eat the budget. `4827.193004` becomes `4,827.19`. Default 6.
   */
  significantDigits?: number;
  /**
   * Hard ceiling on fraction digits, applied after the significant-digit budget. Default 8, which
   * is what stops an 18-decimal value from reaching the screen; raise it for a token whose
   * interesting digits sit further right.
   */
  maxFractionDigits?: number;
  /** Floor on fraction digits, for columns that must line up (USD wants 2). Default 0. */
  minFractionDigits?: number;
  /** Thousands separators in the integer part. Default true. */
  group?: boolean;
  /** Default `'auto'`. */
  sign?: SignDisplay;
  /**
   * What to do when a non-zero value rounds to nothing at the chosen precision.
   * `'marker'` (default) renders `<0.00000001`; `'zero'` renders `0`.
   */
  dust?: 'marker' | 'zero';
}

/**
 * Format a fixed-point bigint for display, with significant-digit control.
 *
 * The fraction budget adapts to the magnitude: large values lose fraction digits so the total
 * significant-digit count holds, and sub-unit values keep digits past their leading zeros. The
 * result is a figure a person can scan, never an 18-decimal string.
 *
 * @example formatUnits(1234567891234567891n, 18) // '1.23457'
 * @example formatUnits(1234567891234567891n, 18, { significantDigits: 9 }) // '1.23456789'
 * @example formatUnits(123456780000000n, 18) // '0.00012346'  (clipped by maxFractionDigits)
 * @example formatUnits(4823n, 18) // '<0.00000001'
 */
export function formatUnits(value: bigint, decimals: number, opts: FormatUnitsOptions = {}): string {
  const {
    significantDigits = 6,
    maxFractionDigits = 8,
    minFractionDigits = 0,
    group = true,
    sign = 'auto',
    dust = 'marker',
  } = opts;

  const f = split(value, decimals);
  const intDigits = f.int === '0' ? 0 : f.int.length;

  const wanted =
    intDigits > 0
      ? Math.max(0, significantDigits - intDigits)
      : leadingFracZeros(f.frac) + significantDigits;

  const places = Math.max(minFractionDigits, Math.min(wanted, maxFractionDigits, f.frac.length));

  const rounded = roundTo(f, places);
  const frac = trimFrac(rounded.frac, minFractionDigits);

  if (value !== ZERO && isZero(rounded) && dust === 'marker') {
    const smallest = `0${POINT}${'0'.repeat(Math.max(0, places - 1))}1`;
    // `>` for negatives: the value is closer to zero than the marker, from below.
    return f.neg ? `>-${smallest}` : `<${smallest}`;
  }

  const int = group ? groupInt(rounded.int) : rounded.int;
  const body = frac ? `${int}${POINT}${frac}` : int;
  return `${signPrefix(rounded.neg && !isZero(rounded), sign)}${body}`;
}

/**
 * A plain whole number, grouped: a block height, a fill count, a round count.
 *
 * It exists because the two things it replaces were both wrong in the same column of the same
 * screen. `blockNumber.toString()` printed `50946352`, which is eight digits a reader has to count
 * on their fingers; `blockNumber.toLocaleString('en-US')` printed `50,946,352` but reintroduced the
 * `Intl` dependency this module exists to avoid — it is locale data, so it can disagree between the
 * server render and the browser's, and React repairs that disagreement by discarding the server
 * tree. This groups by the same fixed-point path as every other figure, on a bigint, deterministic
 * everywhere.
 *
 * @example formatCount(50_946_352) // '50,946,352'
 * @example formatCount(0) // '0'
 */
export function formatCount(value: number | bigint): string {
  const n = typeof value === 'bigint' ? value : BigInt(Math.trunc(value));
  return formatUnits(n, 0, { significantDigits: 96 });
}

// ---------------------------------------------------------------------------
// Compact notation
// ---------------------------------------------------------------------------

const COMPACT_STEPS = [
  { digits: 13, suffix: 'T', zeros: 12 },
  { digits: 10, suffix: 'B', zeros: 9 },
  { digits: 7, suffix: 'M', zeros: 6 },
  { digits: 4, suffix: 'K', zeros: 3 },
] as const;

export interface FormatCompactOptions {
  /** Significant digits inside the compacted mantissa. Default 3, giving `1.23M` / `12.3M`. */
  significantDigits?: number;
  /** Default `'auto'`. */
  sign?: SignDisplay;
}

/**
 * Short notation for figures that only need magnitude: `1.23M`, `847K`, `12.4B`.
 * Values under 1,000 fall through to `formatUnits`, so a column never shows `0.85K`.
 *
 * @example formatCompact(1234567890000n, 6) // '1.23M'
 */
export function formatCompact(
  value: bigint,
  decimals: number,
  opts: FormatCompactOptions = {},
): string {
  const { significantDigits = 3, sign = 'auto' } = opts;
  const f = split(value, decimals);
  const step = COMPACT_STEPS.find((s) => f.int.length >= s.digits);

  if (!step) {
    return formatUnits(value, decimals, { significantDigits, sign, maxFractionDigits: 4 });
  }

  const cut = f.int.length - step.zeros;
  const shifted: Fixed = {
    neg: f.neg,
    int: f.int.slice(0, cut),
    frac: f.int.slice(cut) + f.frac,
  };
  const places = Math.max(0, significantDigits - shifted.int.length);
  const rounded = roundTo(shifted, places);
  const frac = trimFrac(rounded.frac, 0);
  const body = frac ? `${rounded.int}${POINT}${frac}` : rounded.int;
  return `${signPrefix(rounded.neg, sign)}${body}${step.suffix}`;
}

// ---------------------------------------------------------------------------
// Token amounts
// ---------------------------------------------------------------------------

export interface FormatTokenAmountOptions extends FormatUnitsOptions {
  /** Appended after a space: `formatTokenAmount(x, 6, { symbol: 'USDC' })` -> `'1,204.38 USDC'`. */
  symbol?: string;
  /** Use `K`/`M`/`B`/`T` notation above 1,000. Default false — a terminal wants the real number. */
  compact?: boolean;
}

/**
 * The amount formatter for token balances, deltas and inputs. Exact, adaptive and never lossy:
 * a value too small for the chosen precision renders as a `<` bound rather than as zero.
 *
 * @example formatTokenAmount(1204384219n, 6, { symbol: 'USDC' }) // '1,204.38 USDC'
 * @example formatTokenAmount(-38472910000000000n, 18, { symbol: 'WETH', sign: 'always' }) // '-0.0384729 WETH'
 */
export function formatTokenAmount(
  value: bigint,
  decimals: number,
  opts: FormatTokenAmountOptions = {},
): string {
  const { symbol, compact = false, ...rest } = opts;
  const body = compact
    ? formatCompact(value, decimals, {
        significantDigits: rest.significantDigits,
        sign: rest.sign,
      })
    : formatUnits(value, decimals, rest);
  return symbol ? `${body} ${symbol}` : body;
}

// ---------------------------------------------------------------------------
// USD
// ---------------------------------------------------------------------------

export interface FormatUsdOptions {
  /** Use `$1.23M` notation once the figure passes 1,000. Default false. */
  compact?: boolean;
  /** Default `'auto'`. The sign leads the currency symbol: `-$1,204.38`. */
  sign?: SignDisplay;
}

/**
 * USD for display. At or above one dollar the cents always show, so columns align; below a dollar
 * the formatter keeps three significant digits instead, because `$0.00` is not a price.
 *
 * @example formatUsd(120438n, 2) // '$1,204.38'
 * @example formatUsd(4271900000000000n, 18) // '$0.00427'
 * @example formatUsd(1234567890000n, 6, { compact: true }) // '$1.23M'
 */
export function formatUsd(value: bigint, decimals: number, opts: FormatUsdOptions = {}): string {
  const { compact = false, sign = 'auto' } = opts;

  const body = compact
    ? formatCompact(value, decimals, { significantDigits: 3, sign: 'never' })
    : (() => {
        const f = split(value, decimals);
        // Exact zero takes the cents path so a zero row still lines up under $1,204.38.
        const subDollar = f.int === '0' && value !== ZERO;
        return formatUnits(value, decimals, {
          sign: 'never',
          significantDigits: subDollar ? 3 : 18,
          minFractionDigits: subDollar ? 0 : 2,
          maxFractionDigits: subDollar ? 6 : 2,
        });
      })();

  // `formatUnits` may have returned a dust marker; keep the comparator outside the currency symbol.
  const bound = body.startsWith('<') || body.startsWith('>') ? body[0] : '';
  const digits = bound ? body.slice(1) : body;
  const negative = value < ZERO && digits !== '0';
  return `${bound}${signPrefix(negative, sign)}$${digits.replace(/^-/, '')}`;
}

// ---------------------------------------------------------------------------
// Percent and basis points
// ---------------------------------------------------------------------------

export interface FormatPercentOptions {
  /** Fraction digits on the percentage. Default 2. */
  fractionDigits?: number;
  /** Default `'auto'`. Deltas want `'always'`. */
  sign?: SignDisplay;
}

/**
 * A ratio rendered as a percentage: `0.0512` becomes `'5.12%'`.
 *
 * Takes a `number` because ratios are derived quantities (a share, an APR estimate), not chain
 * values. Anything that arrives as a bigint should stay one — use {@link formatUnits} on it.
 * Non-finite input renders as `-`, never `NaN%`.
 */
export function formatPercent(ratio: number, opts: FormatPercentOptions = {}): string {
  const { fractionDigits = 2, sign = 'auto' } = opts;
  if (!Number.isFinite(ratio)) return '-';
  // Route through the fixed-point path so rounding matches every other figure on screen.
  const scale = 10 ** (fractionDigits + 4);
  const scaled = BigInt(Math.round(ratio * 100 * scale));
  return `${formatUnits(scaled, fractionDigits + 4, {
    significantDigits: 18,
    minFractionDigits: fractionDigits,
    maxFractionDigits: fractionDigits,
    sign,
    dust: 'zero',
  })}%`;
}

/** Basis points as their own unit: `formatBps(30)` -> `'30 bps'`. */
export function formatBps(bps: number | bigint): string {
  const n = typeof bps === 'bigint' ? bps : BigInt(Math.round(bps));
  return `${formatUnits(n, 0, { significantDigits: 18 })} bps`;
}

/** `3` -> `0.0003`. Compose with {@link formatPercent} to show a fee as a percentage. */
export function bpsToRatio(bps: number | bigint): number {
  return Number(bps) / 10_000;
}

// ---------------------------------------------------------------------------
// Addresses and hashes
// ---------------------------------------------------------------------------

export interface TruncateOptions {
  /** Characters kept at the start, `0x` included. */
  lead?: number;
  /** Characters kept at the end. */
  tail?: number;
}

function truncateMiddle(value: string, lead: number, tail: number): string {
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}${ELLIPSIS}${value.slice(-tail)}`;
}

/**
 * `0x1f9840a85d5a…6c9e` — middle ellipsis, so the two ends a person actually compares survive.
 *
 * Pass an address that is already EIP-55 checksummed (viem's `getAddress`); this function does not
 * change case, because re-casing a string it cannot validate would be worse than leaving it.
 */
export function truncateAddress(address: string, opts: TruncateOptions = {}): string {
  const { lead = 6, tail = 4 } = opts;
  return truncateMiddle(address, lead, tail);
}

/**
 * `0x8f2c41ab9d…3e7c0a94` — wider than an address, because a strategy hash is an identity a maker
 * reads off the screen and matches against an explorer.
 */
export function truncateHash(hash: string, opts: TruncateOptions = {}): string {
  const { lead = 10, tail = 8 } = opts;
  return truncateMiddle(hash, lead, tail);
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export interface RelativeTimeOptions {
  /** Reference point in epoch milliseconds. Defaults to `Date.now()`. */
  now?: number;
  /**
   * Unit of a numeric `value`. Defaults to `'ms'` for `number` and `'s'` for `bigint`, which
   * matches where each one comes from: `Date.now()` and a chain timestamp respectively.
   */
  unit?: 'ms' | 's';
}

/**
 * Terse relative time for activity rows: `'12s ago'`, `'8m ago'`, `'3d ago'`, then an absolute
 * date once it stops being useful as a relative one. Future instants read `'in 4m'`.
 *
 * This output changes between the server render and the client render. Render it in an effect, or
 * mark the element `suppressHydrationWarning`, rather than letting React reconcile it.
 */
export function formatRelativeTime(
  value: Date | number | bigint,
  opts: RelativeTimeOptions = {},
): string {
  const { now = Date.now() } = opts;
  const unit = opts.unit ?? (typeof value === 'bigint' ? 's' : 'ms');

  const ms =
    value instanceof Date
      ? value.getTime()
      : typeof value === 'bigint'
        ? Number(value) * (unit === 's' ? 1000 : 1)
        : value * (unit === 's' ? 1000 : 1);

  if (!Number.isFinite(ms)) return '-';

  const deltaMs = now - ms;
  const future = deltaMs < 0;
  const abs = Math.abs(deltaMs);
  const seconds = Math.floor(abs / 1000);

  const phrase = (n: number, suffix: string) => (future ? `in ${n}${suffix}` : `${n}${suffix} ago`);

  if (seconds < 5) return future ? 'in a moment' : 'just now';
  if (seconds < 60) return phrase(seconds, 's');

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return phrase(minutes, 'm');

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return phrase(hours, 'h');

  const days = Math.floor(hours / 24);
  if (days < 7) return phrase(days, 'd');

  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return sameYear ? date : `${date} ${d.getFullYear()}`;
}
