/**
 * Two marks and the pair they name: `⬡⬡ WETH/USDC`.
 *
 * The overlap is the convention every trading screen uses and it earns its keep here. At 20px, two
 * separate discs with a gap between them read as two tokens that happen to be adjacent; overlapped,
 * they read as one instrument, which is what a pair is. The disc in front is cut out of the one
 * behind by a ring in `--bg` rather than by a stroke, so the separation holds on any surface the
 * page ground shows through and nothing has to be re-picked per context.
 *
 * The overlap is 28% of the mark — enough to bind them, not enough to close the counter of the
 * glyph behind — and it scales with `size`, so this is as correct at 16 as at 28.
 */
import { cn } from '@/lib/ui';
import { TokenIcon } from './TokenIcon';
import { tokenMeta } from './registry';

export interface TokenPairProps {
  /** The asset being sold. Drawn in front. */
  base: string | undefined;
  /** What it is priced in. Drawn behind and to the right. */
  quote: string | undefined;
  size?: number;
  /** Print `WETH/USDC` after the marks. Off when the pair is named elsewhere on the line. */
  showSymbols?: boolean;
  className?: string;
}

export function TokenPair({
  base,
  quote,
  size = 20,
  showSymbols = true,
  className,
}: TokenPairProps) {
  const baseSymbol = tokenMeta(base).symbol;
  const quoteSymbol = tokenMeta(quote).symbol;

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        className="inline-flex items-center"
        role="img"
        aria-label={`${baseSymbol} against ${quoteSymbol}`}
      >
        <TokenIcon symbol={base} size={size} className="relative z-10 ring-2 ring-bg" />
        <TokenIcon
          symbol={quote}
          size={size}
          className="ring-2 ring-bg"
          style={{ marginInlineStart: -Math.round(size * 0.28) }}
        />
      </span>
      {showSymbols ? (
        <span className="text-body whitespace-nowrap text-ink">
          {baseSymbol}
          <span className="mx-px text-ink-3">/</span>
          {quoteSymbol}
        </span>
      ) : null}
    </span>
  );
}

