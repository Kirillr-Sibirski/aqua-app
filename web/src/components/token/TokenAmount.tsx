/**
 * A quantity of a token, rendered the way a desk reads one.
 *
 * Four decisions, all of them about columns rather than about this one figure:
 *
 * 1. **Fixed fraction digits per token**, from the registry: USDC always two, WETH always four.
 *    A significant-digit budget is right for one number in isolation and wrong for a column, where
 *    it puts `10.40` above `9.92515` and the decimal points stop lining up. Fixing the digits per
 *    token is what makes a column scannable and what stops a figure changing width as it updates.
 * 2. **Tabular, monospace figures.** Every glyph the same advance, so a streaming number does not
 *    make the row twitch, and a `1` occupies what a `7` occupies.
 * 3. **The unit is always attached**, dimmed, so a number is never ambiguous about what it counts,
 *    and so the symbols line up under each other in a right-aligned column.
 * 4. **Full precision stays reachable.** The `title` carries the value at the token's own decimals,
 *    because the displayed figure is a reading aid and the chain's number is the fact. Nothing is
 *    silently rounded to nothing either: a non-zero amount below the shown precision renders as
 *    `<0.0001`, never as `0`.
 *
 * There is no float anywhere in here. The input is the bigint the chain returned and `formatUnits`
 * is exact on bigints.
 */
import { cn, formatUnits, toDecimalString, type SignDisplay } from '@/lib/ui';
import { TokenIcon } from './TokenIcon';
import { tokenMeta } from './registry';

const ZERO = BigInt(0);

/** How the figure is coloured. `money` picks `--pos`/`--neg` from the sign; the rest are literal. */
export type AmountTone = 'default' | 'muted' | 'money' | 'accent';

export interface TokenAmountProps {
  /** The chain's own integer, in the token's smallest unit. */
  value: bigint;
  /** The token's decimals. Not the display precision — that comes from the registry. */
  decimals: number;
  symbol: string | undefined;
  /** Draw the mark. Off in a column of pure numbers, where the token is named by the header. */
  icon?: boolean;
  /** Icon size; the type stays at `--text-body` either way. */
  size?: number;
  /** Override the registry's fixed fraction digits. Rare, and always for a whole column at once. */
  fractionDigits?: number;
  /** `always` prints a leading `+` on gains. Default `auto`, which prints only `-`. */
  sign?: SignDisplay;
  tone?: AmountTone;
  /**
   * Where the token's name goes. `after` is the default and is what makes a figure unambiguous;
   * `none` belongs only in a column whose header already carries the unit.
   */
  unit?: 'after' | 'none';
  className?: string;
}

export function TokenAmount({
  value,
  decimals,
  symbol,
  icon = true,
  size = 16,
  fractionDigits,
  sign = 'auto',
  tone = 'default',
  unit = 'after',
  className,
}: TokenAmountProps) {
  const meta = tokenMeta(symbol);
  const places = fractionDigits ?? meta.fractionDigits;

  const text = formatUnits(value, decimals, {
    minFractionDigits: places,
    maxFractionDigits: places,
    // `+0.00` is not a gain. A signed column prints the sign only where there is one to print.
    sign: sign === 'always' && value === ZERO ? 'auto' : sign,
  });

  const toneClass =
    tone === 'money'
      ? value > ZERO
        ? 'text-pos'
        : value < ZERO
          ? 'text-neg'
          : 'text-ink-3'
      : tone === 'muted'
        ? 'text-ink-3'
        : tone === 'accent'
          ? 'text-accent'
          : 'text-ink';

  return (
    <span
      className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', className)}
      title={`${toDecimalString(value, decimals)} ${meta.symbol}`.trim()}
    >
      {icon ? <TokenIcon symbol={symbol} size={size} dim={tone === 'muted'} /> : null}
      <span className={cn('font-mono tnum leading-num', toneClass)}>{text}</span>
      {unit === 'after' && meta.symbol ? (
        <span className="font-mono text-ink-3 leading-num">{meta.symbol}</span>
      ) : null}
    </span>
  );
}

export interface TokenAmountSkeletonProps {
  /** Match the widest figure the column will hold, in characters, so nothing reflows on arrival. */
  chars?: number;
  icon?: boolean;
  size?: number;
  className?: string;
}

/**
 * The placeholder a `TokenAmount` leaves while its read is in flight.
 *
 * A skeleton of the right width, never the word "Loading": the row is laid out once and the digits
 * land into the space already held for them.
 */
export function TokenAmountSkeleton({
  chars = 8,
  icon = true,
  size = 16,
  className,
}: TokenAmountSkeletonProps) {
  return (
    <span
      className={cn('inline-flex items-center gap-1.5', className)}
      aria-hidden="true"
      data-loading="true"
    >
      {icon ? (
        <span
          className="shrink-0 rounded-pill bg-surface-3"
          style={{ width: size, height: size }}
        />
      ) : null}
      {/* `ch` on the mono stack is exactly one digit, so the reserved width is the real one. */}
      <span
        className="inline-block h-3 rounded-control bg-surface-3 align-middle font-mono"
        style={{ width: `${chars}ch` }}
      />
    </span>
  );
}
