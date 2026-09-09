/**
 * Chart labels, routed through `lib/ui/format`.
 *
 * A scale works in `number`, but every figure a maker reads comes from a bigint, and the two must
 * round the same way or an axis tick will disagree with the table under it. So nothing here
 * formats a float directly: a value is converted to a fixed-point bigint at a chosen scale and
 * then handed to the same formatters the rest of the app uses. That is also what keeps an
 * 18-decimal value from leaking into a tick label, and what makes the output byte-identical on the
 * server and in the browser (no `Intl`, no `toLocaleString`).
 */
import {
  formatCompact,
  formatPercent,
  formatUnits,
  formatUsd,
  parseDecimalInput,
  type SignDisplay,
} from '@/lib/ui/format';

/** Past this, `Number.prototype.toFixed` switches to exponential notation and the bridge breaks. */
const TO_FIXED_LIMIT = 1e21;

/** Deep enough for a sub-cent price, shallow enough that `toFixed` stays exact. */
const MAX_DECIMALS = 12;

/** Above this magnitude an axis switches to `K`/`M`/`B` so ticks stop eating the margin. */
const COMPACT_THRESHOLD = 100_000;

/**
 * Decimal exponent of `value`, corrected for the cases where `Math.log10` lands a hair under an
 * exact power of ten (`Math.log10(1000)` is `2.9999999999999996` on some engines).
 */
function exponentOf(magnitude: number): number {
  const exp = Math.floor(Math.log10(magnitude));
  if (10 ** (exp + 1) <= magnitude) return exp + 1;
  if (10 ** exp > magnitude) return exp - 1;
  return exp;
}

/** Fraction digits that hold `significantDigits` significant figures for a value this big. */
export function decimalsFor(value: number, significantDigits: number): number {
  const magnitude = Math.abs(value);
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    return Math.min(MAX_DECIMALS, Math.max(0, significantDigits));
  }
  return Math.min(MAX_DECIMALS, Math.max(0, significantDigits - 1 - exponentOf(magnitude)));
}

export interface ChartNumberOptions {
  /** Significant figures kept, counted from the first non-zero digit. Default 6. */
  significantDigits?: number;
  /** Floor on fraction digits, so a column of ticks lines up. Default 0. */
  minFractionDigits?: number;
  /** Ceiling on fraction digits. Defaults to whatever the significant-digit budget needs. */
  maxFractionDigits?: number;
  /** Thousands separators. Default true. */
  group?: boolean;
  /** Default `'auto'`. Deltas want `'always'`. */
  sign?: SignDisplay;
  /** Appended after a thin space, e.g. `'WETH'` or `'%'`. */
  unit?: string;
}

/** `unit` is joined with a narrow no-break space so `2,499 USDC` never wraps mid-figure. */
const UNIT_SPACE = ' ';

function withUnit(body: string, unit?: string): string {
  return unit ? `${body}${UNIT_SPACE}${unit}` : body;
}

/**
 * Format a plain number for a chart label.
 *
 * @example formatChartNumber(2498.9578) // '2,498.96'
 * @example formatChartNumber(0.00012431, { significantDigits: 3 }) // '0.000124'
 * @example formatChartNumber(-0.0412, { sign: 'always', unit: 'WETH' }) // '-0.0412 WETH'
 */
export function formatChartNumber(value: number, opts: ChartNumberOptions = {}): string {
  const {
    significantDigits = 6,
    minFractionDigits = 0,
    maxFractionDigits,
    group = true,
    sign = 'auto',
    unit,
  } = opts;

  if (!Number.isFinite(value)) return '';
  if (Math.abs(value) >= TO_FIXED_LIMIT) {
    return withUnit(formatChartCompact(value, { significantDigits: 3, sign }), unit);
  }

  const decimals = Math.max(minFractionDigits, decimalsFor(value, significantDigits));
  const fixed = parseDecimalInput(value.toFixed(decimals), decimals);
  if (fixed === null) return '';

  return withUnit(
    formatUnits(fixed, decimals, {
      significantDigits,
      minFractionDigits,
      maxFractionDigits: maxFractionDigits ?? decimals,
      group,
      sign,
    }),
    unit,
  );
}

/**
 * A float a chart read produced, printed the way this app prints that token everywhere else.
 *
 * There is one decimal convention per token and it comes from `components/token/registry`: USDC is
 * always two places, WETH always four. A chart readout is a figure, not a column, so it used to
 * spend a significant-digit budget instead — which put `10.4`, `10.40`, `10.4000` and `+0.01588` on
 * one screen for one asset. It takes the token's own digits here, and a non-zero value that rounds
 * away renders `<0.0001` rather than `0.0000`, which is the same contract `TokenAmount` honours: the
 * shape of a series that sweeps four orders of magnitude is the chart's job, not the readout's.
 *
 * @example formatChartToken(0.0000123, 4) // '<0.0001'
 * @example formatChartToken(12.3, 4)      // '12.3000'
 */
export function formatChartToken(
  value: number,
  fractionDigits: number,
  opts: { sign?: SignDisplay } = {},
): string {
  const { sign = 'auto' } = opts;
  if (!Number.isFinite(value)) return '';
  if (Math.abs(value) >= TO_FIXED_LIMIT) {
    return formatChartCompact(value, { significantDigits: 3, sign });
  }
  // Convert deep, print shallow: rounding the float to the display precision first would turn a
  // sub-precision value into an exact zero and the dust marker would never fire.
  const scale = Math.min(MAX_DECIMALS, Math.max(fractionDigits, 8));
  const fixed = parseDecimalInput(value.toFixed(scale), scale);
  if (fixed === null) return '';
  return formatUnits(fixed, scale, {
    significantDigits: 18,
    minFractionDigits: fractionDigits,
    maxFractionDigits: fractionDigits,
    sign,
  });
}

/**
 * `K`/`M`/`B`/`T` notation for an axis whose values are too wide to spell out.
 *
 * @example formatChartCompact(31204.77) // '31.2K'
 */
export function formatChartCompact(
  value: number,
  opts: Pick<ChartNumberOptions, 'significantDigits' | 'sign' | 'unit'> = {},
): string {
  const { significantDigits = 3, sign = 'auto', unit } = opts;
  if (!Number.isFinite(value)) return '';

  // Compact notation only ever shows three significant figures, so six decimals is ample and keeps
  // `toFixed` inside its exact range for anything a price feed produces.
  const decimals = Math.min(6, decimalsFor(value, significantDigits));
  const fixed =
    Math.abs(value) >= TO_FIXED_LIMIT ? null : parseDecimalInput(value.toFixed(decimals), decimals);
  if (fixed === null) return '';

  return withUnit(formatCompact(fixed, decimals, { significantDigits, sign }), unit);
}

/**
 * USD for a chart label. Cents show at or above a dollar so a column aligns; below a dollar three
 * significant figures replace them, because `$0.00` is not a price.
 *
 * @example formatChartUsd(31204.77) // '$31,204.77'
 */
export function formatChartUsd(
  value: number,
  opts: { compact?: boolean; sign?: SignDisplay } = {},
): string {
  const { compact = false, sign = 'auto' } = opts;
  if (!Number.isFinite(value)) return '';
  const decimals = Math.min(MAX_DECIMALS, Math.max(2, decimalsFor(value, 6)));
  const fixed =
    Math.abs(value) >= TO_FIXED_LIMIT ? null : parseDecimalInput(value.toFixed(decimals), decimals);
  if (fixed === null) return '';
  return formatUsd(fixed, decimals, { compact, sign });
}

/** A ratio as a percentage. `0.0217` becomes `'2.17%'`. */
export function formatChartPercent(
  ratio: number,
  opts: { fractionDigits?: number; sign?: SignDisplay } = {},
): string {
  return formatPercent(ratio, opts);
}

// ---------------------------------------------------------------------------
// Axis tick formatting
// ---------------------------------------------------------------------------

/** Fewest fraction digits that render `value` without losing anything, up to `max`. */
export function neededDecimals(value: number, max = 8): number {
  if (!Number.isFinite(value)) return 0;
  const tolerance = Math.abs(value) * 1e-10 + 1e-12;
  for (let d = 0; d <= max; d += 1) {
    if (Math.abs(Number(value.toFixed(d)) - value) <= tolerance) return d;
  }
  return max;
}

export interface TickFormatterOptions extends Pick<ChartNumberOptions, 'sign' | 'unit' | 'group'> {
  /**
   * Force compact notation on or off. Left unset, an axis whose largest tick passes 100,000
   * switches to `K`/`M` so the left margin does not have to grow.
   */
  compact?: boolean;
  /** Ceiling on fraction digits across the whole axis. Default 8. */
  maxFractionDigits?: number;
}

/** Most significant figures a compact axis label will spend before giving up on compact. */
const MAX_COMPACT_DIGITS = 6;

/** True when every entry is different from every other. */
function allDistinct(labels: readonly string[]): boolean {
  return new Set(labels).size === labels.length;
}

/**
 * A formatter for one axis, derived from that axis's own tick values.
 *
 * Every tick gets the same number of fraction digits, chosen as the most any single tick needs, so
 * the labels form a column that lines up under `tabular-nums` instead of a ragged mix of `2,400`
 * and `2,450.5`. Trailing zeros are kept for the same reason.
 *
 * **The labels must also be distinct**, and that is not automatic. Compact notation spends three
 * significant figures, so an axis whose four ticks sit inside one part in a thousand of each other
 * — which is exactly what a degenerate domain produces — printed `10.4M` four times, as four
 * separate gridline labels on one chart. This walks the significant-figure budget up until the
 * labels differ, and falls back to spelling the numbers out when even six figures cannot separate
 * them, because a repeated label is worse than a wide one.
 */
export function tickFormatter(
  ticks: readonly number[],
  opts: TickFormatterOptions = {},
): (value: number) => string {
  const { compact, maxFractionDigits = 8, sign = 'auto', unit, group = true } = opts;

  const finite = ticks.filter((t) => Number.isFinite(t));
  const largest = finite.reduce((max, t) => Math.max(max, Math.abs(t)), 0);
  const useCompact = compact ?? largest >= COMPACT_THRESHOLD;

  if (useCompact) {
    for (let digits = 3; digits <= MAX_COMPACT_DIGITS; digits += 1) {
      const at = (value: number) => formatChartCompact(value, { significantDigits: digits, sign, unit });
      if (finite.length < 2 || allDistinct(finite.map(at))) return at;
    }
  }

  const places = finite.reduce((max, t) => Math.max(max, neededDecimals(t, maxFractionDigits)), 0);

  return (value) =>
    formatChartNumber(value, {
      significantDigits: 18,
      minFractionDigits: places,
      maxFractionDigits: places,
      group,
      sign,
      unit,
    });
}
