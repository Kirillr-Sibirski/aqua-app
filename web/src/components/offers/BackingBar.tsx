'use client';

/**
 * One token's balance, with every offer's claim on it stacked inside.
 *
 * This is the picture the product exists to draw, and the reason it is the largest object on the
 * page rather than a stat tile. A pool, a vault or a v4 hook cannot draw it: in all three the
 * collateral was segregated when the position was opened, so their picture is four separate tanks.
 * Here the segments are claims on **one balance that never moved**, so the instant a taker sweeps
 * any of them the solid part shrinks under all of them at once — and the rows below move in the
 * same commit, because every figure came from the same block.
 *
 * How to read it, in the three words the caption uses:
 *
 *  - **solid** — what the wallet could actually hand over right now. This is `min(balanceOf,
 *    allowance)` at the pinned block, which is the exact quantity the `Coverage` instruction reads
 *    inside the call that prices a trade.
 *  - **hatched** — promised beyond that. Not phantom: any *one* offer can still be taken up to the
 *    line, and taking it shrinks what the others can deliver in the same block. That is what
 *    over-allocation means, and why the book is margined rather than pre-funded.
 *  - **the line** — where the wallet runs out.
 *
 * Colour never carries the distinction on its own: the hatch survives greyscale, the line is
 * labelled in words, and both figures are printed above the bar in full.
 *
 * Every label sits *outside* the bar. Text inside a stacked bar has to be legible against two
 * different grounds at once and ends up legible against neither; outside, the ticks are ink on
 * paper at 4.5:1 or better and stay readable in a 1280x800 screen recording.
 */
import { useElementSize } from '@mantine/hooks';
import { useId } from 'react';
import type { Hex } from 'viem';
import { ratio } from '@/hooks/strikeline';
import type { BookTokenClaim, BookTokenView } from '@/hooks/useBook';
import { cn, formatTokenAmount } from '@/lib/ui';
import { amountText, tickText } from './copy';
import { useCountTo } from './useCountTo';
import { HATCH, pct } from './visual';

const ZERO = BigInt(0);

/**
 * Tick budget. A tick has to clear two tests, because a share is not a width.
 *
 * The share test is about crowding: under 9% of the bar a two-line tick sits closer to its
 * neighbours than to its own segment, so the size line goes and only the price stays.
 *
 * The pixel test is about legibility, and it is the one a percentage cannot do. 5.5% of a 1,600px
 * bar is 88px and prints `$2,300` with room to spare; 5.5% of a phone's 330px bar is 18px and
 * prints `2,3(`. That clipped label is what the 390px screenshot caught on the fourth offer, and no
 * single percentage fixes both widths. Below the floor the segment is left unlabelled rather than
 * labelled wrongly — the bar still draws it, and the row below still names it.
 */
const TICK_FULL_SHARE = 0.09;
const TICK_MIN_PX = 56;

/** Past this point the wallet flag would run off the end, so it is drawn on the other side. */
const FLAG_FLIP_AT = 58;

export interface BackingBarProps {
  token: BookTokenView;
  /** The offer the reader is pointing at, so its segment lifts out of the stack. */
  highlight?: Hex;
  onHighlight?: (hash: Hex | undefined) => void;
  className?: string;
}

interface Segment {
  claim: BookTokenClaim;
  leftPct: number;
  widthPct: number;
  /** Share of this segment that falls inside the wallet line. */
  coveredPct: number;
  /** 'full' prints the price and the size, 'price' only the price, 'none' nothing. */
  tick: 'full' | 'price' | 'none';
}

/**
 * Lay the claims out end to end and split each one at the wallet line.
 *
 * Offsets accumulate in bigint and become percentages only at the end, so segments abut exactly
 * instead of drifting apart by one rounding error per offer.
 */
function layout(
  claims: readonly BookTokenClaim[],
  span: bigint,
  coverage: bigint,
  /** Measured width of the bar. Zero until the first layout, when the share test stands alone. */
  barWidth: number,
): Segment[] {
  const out: Segment[] = [];
  let cursor = ZERO;
  for (const claim of claims) {
    const start = cursor;
    const end = start + claim.amount;
    cursor = end;
    const share = span === ZERO ? 0 : ratio(claim.amount, span);
    const covered = coverage <= start ? ZERO : coverage >= end ? claim.amount : coverage - start;
    out.push({
      claim,
      leftPct: pct(start, span),
      widthPct: share * 100,
      coveredPct: pct(covered, claim.amount),
      tick: fits(share, barWidth) ? (share >= TICK_FULL_SHARE ? 'full' : 'price') : 'none',
    });
  }
  return out;
}

/** Whether a segment this wide can carry its price without clipping it. */
function fits(share: number, barWidth: number): boolean {
  return barWidth === 0 ? share >= TICK_FULL_SHARE : share * barWidth >= TICK_MIN_PX;
}

const MOVE = {
  transitionProperty: 'left, width',
  transitionDuration: 'var(--duration-slow)',
  transitionTimingFunction: 'var(--ease-out-quart)',
} as const;

export function BackingBar({ token, highlight, onHighlight, className }: BackingBarProps) {
  const labelId = useId();
  const descId = `${labelId}-desc`;
  // The bar's own rendered width, so the tick budget is measured rather than guessed from a
  // breakpoint. It reads 0 until the first observation, and `fits` falls back to the share test.
  const { ref: barRef, width: barWidth } = useElementSize<HTMLDivElement>();

  // The one loud moment DESIGN.md allows: when a fill lands these two figures count to their new
  // values while the segments slide. Endpoints are the exact chain bigints.
  const promised = useCountTo(token.written);
  const inWallet = useCountTo(token.coverage);

  const span = token.written > token.coverage ? token.written : token.coverage;
  const walletShare = pct(token.coverage, span);
  const segments = layout(token.claims, span, token.coverage, barWidth);

  const exactPromised = formatTokenAmount(token.written, token.decimals, { symbol: token.symbol });
  const exactWallet = formatTokenAmount(token.coverage, token.decimals, { symbol: token.symbol });
  const offerCount = token.claims.length;

  const summary =
    offerCount === 0
      ? `${token.symbol}: ${exactWallet} in your wallet, promised to nothing.`
      : `${token.symbol}: ${exactWallet} in your wallet, ${exactPromised} promised across ${offerCount} ${offerCount === 1 ? 'offer' : 'offers'}. Anything past the wallet line can still be taken one offer at a time, but not all at once.`;

  const flagFlips = walletShare > FLAG_FLIP_AT;

  return (
    <section className={cn('flex min-w-0 flex-col', className)} aria-labelledby={labelId}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 id={labelId} className="font-mono text-title tnum text-ink">
          {token.symbol}
        </h3>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <p className="flex items-baseline gap-2 leading-num">
            <span className="font-mono text-title tnum text-accent" title={exactWallet}>
              {amountText(inWallet, token.decimals)}
            </span>
            <span className="text-mini text-ink-2">in your wallet</span>
          </p>
          <p className="flex items-baseline gap-2 leading-num">
            <span className="font-mono text-title tnum text-ink" title={exactPromised}>
              {amountText(promised, token.decimals)}
            </span>
            <span className="text-mini text-ink-2">
              promised across {offerCount} {offerCount === 1 ? 'offer' : 'offers'}
            </span>
          </p>
        </div>
      </div>

      {/* The wallet flag, above the bar so it never collides with the ticks below it. */}
      <div className="relative mt-3 h-5">
        <span
          className={cn(
            'absolute bottom-0 flex items-end gap-1.5 whitespace-nowrap text-mini text-ink-2',
            flagFlips && 'flex-row-reverse',
          )}
          style={{
            left: `${walletShare}%`,
            transform: flagFlips ? 'translateX(-100%)' : undefined,
            transitionProperty: 'left',
            transitionDuration: 'var(--duration-slow)',
            transitionTimingFunction: 'var(--ease-out-quart)',
          }}
        >
          <span aria-hidden="true" className="h-3 w-0.5 bg-ink" />
          your wallet ends here
        </span>
      </div>

      <div
        ref={barRef}
        role="img"
        aria-labelledby={labelId}
        aria-describedby={descId}
        className="relative h-10 w-full overflow-hidden rounded-control border border-line bg-surface-2 sm:h-14"
      >
        {segments.map((segment) => {
          const on = highlight !== undefined && highlight === segment.claim.strategyHash;
          return (
            <div
              key={segment.claim.strategyHash}
              title={`${segment.claim.label} ${segment.claim.kind}: ${formatTokenAmount(segment.claim.amount, token.decimals, { symbol: token.symbol })} promised`}
              onMouseEnter={() => onHighlight?.(segment.claim.strategyHash)}
              onMouseLeave={() => onHighlight?.(undefined)}
              className={cn(
                'absolute inset-y-0 border-r border-bg last:border-r-0',
                on && 'z-dropdown outline-2 -outline-offset-2 outline-ink',
              )}
              style={{ left: `${segment.leftPct}%`, width: `${segment.widthPct}%`, backgroundImage: HATCH, ...MOVE }}
            >
              {/* Deliverable right now. Solid, and the darkest thing in the bar, because it is the
                  only part of the promise the wallet can actually keep this instant. */}
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 bg-accent"
                style={{
                  width: `${segment.coveredPct}%`,
                  transitionProperty: 'width',
                  transitionDuration: 'var(--duration-slow)',
                  transitionTimingFunction: 'var(--ease-out-quart)',
                }}
              />
            </div>
          );
        })}

        {/* The line itself, drawn last so it sits over every segment it crosses. */}
        <span
          aria-hidden="true"
          className="absolute inset-y-0 z-sticky w-0.5 bg-ink"
          style={{
            left: `calc(${walletShare}% - 1px)`,
            transitionProperty: 'left',
            transitionDuration: 'var(--duration-slow)',
            transitionTimingFunction: 'var(--ease-out-quart)',
          }}
        />
      </div>

      <p id={descId} className="sr-only">
        {summary}
      </p>

      {/* Ticks. Outside the bar, so every one of them is ink on paper. */}
      <div className="relative mt-2 h-9" aria-hidden="true">
        {segments.map((segment) =>
          segment.tick === 'none' ? null : (
            <span
              key={segment.claim.strategyHash}
              className={cn(
                'absolute top-0 flex flex-col items-center gap-0.5 overflow-hidden px-1 text-center',
                highlight === segment.claim.strategyHash ? 'text-ink' : 'text-ink-3',
              )}
              style={{ left: `${segment.leftPct}%`, width: `${segment.widthPct}%`, ...MOVE }}
            >
              <span className="font-mono text-meta tnum leading-num">${segment.claim.label}</span>
              {segment.tick === 'full' ? (
                <span className="font-mono text-mini tnum leading-num">
                  {tickText(segment.claim.amount, token.decimals)}
                </span>
              ) : null}
            </span>
          ),
        )}
      </div>
    </section>
  );
}
