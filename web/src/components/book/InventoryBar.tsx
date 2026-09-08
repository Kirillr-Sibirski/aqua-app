'use client';

/**
 * One token's worth of the shared inventory: everything written against a single wallet balance,
 * and the line where that balance actually runs out.
 *
 * This is the picture the whole product is about. A pool, a vault or a v4 hook cannot draw it,
 * because in all three the collateral has already been segregated per position: their bars would be
 * four separate tanks. Here the four segments are claims on *one* balance, so the moment a taker
 * sweeps any of them, the line moves left under all four at once.
 *
 * Reading it:
 *
 *  - the **segments** are each leg's virtual Aqua reserve of this token — what it is quoting;
 *  - the **solid** part of the stack is what the wallet could deliver if every leg were swept in
 *    the same block;
 *  - the **hatched** part is written beyond that. It is not phantom depth: any one leg can still be
 *    swept up to the line, and `Coverage` enforces exactly that inside the call that prices the
 *    trade. It is the part that cannot all be delivered *at once*, which is what over-allocation
 *    means and why a book is margined rather than pre-funded.
 *
 * Colour never carries this on its own: the hatch survives greyscale, the line is labelled, and
 * both figures are printed above the bar.
 */
import { useId } from 'react';
import type { Hex } from 'viem';
import { cn, formatTokenAmount } from '@/lib/ui';
import { Skeleton } from '@/components/ui';
import type { BookTokenClaim, BookTokenView } from '@/hooks/useBook';
import { ratio } from '@/hooks/strikeline';
import { HATCH, pct } from './visual';
import { useCountTo } from './useCountTo';

const ZERO = BigInt(0);

/** Below this share of the bar a segment has no room for its strike, so the label is dropped. */
const LABEL_MIN_SHARE = 0.07;

export interface InventoryBarProps {
  token: BookTokenView;
  /** Strategy hash of the leg the maker is pointing at, so its segment lifts out of the stack. */
  highlight?: Hex;
  onHighlight?: (hash: Hex | undefined) => void;
  loading?: boolean;
  className?: string;
}

interface Segment {
  claim: BookTokenClaim;
  leftPct: number;
  widthPct: number;
  /** Share of this segment that falls inside the wallet line. */
  coveredPct: number;
  showLabel: boolean;
}

/**
 * Lay the claims out end to end and split each one at the wallet line.
 *
 * Offsets accumulate in bigint and are turned into percentages only at the end, so the segments
 * abut exactly instead of drifting apart by a rounding error per leg.
 */
function layoutSegments(claims: readonly BookTokenClaim[], span: bigint, coverage: bigint): Segment[] {
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
      showLabel: share >= LABEL_MIN_SHARE,
    });
  }
  return out;
}

export function InventoryBar({ token, highlight, onHighlight, loading = false, className }: InventoryBarProps) {
  const labelId = useId();
  const written = useCountTo(token.written);
  const deliverable = useCountTo(token.coverage);

  const span = token.written > token.coverage ? token.written : token.coverage;
  const coverageShare = pct(token.coverage, span);

  const segments = layoutSegments(token.claims, span, token.coverage);

  const writtenText = formatTokenAmount(written, token.decimals, { significantDigits: 6 });
  const deliverableText = formatTokenAmount(deliverable, token.decimals, { significantDigits: 6 });
  const exactWritten = formatTokenAmount(token.written, token.decimals, { symbol: token.symbol });
  const exactDeliverable = formatTokenAmount(token.coverage, token.decimals, { symbol: token.symbol });

  const summary =
    token.claims.length === 0
      ? `${token.symbol}: ${exactDeliverable} deliverable, nothing written against it.`
      : `${token.symbol}: ${exactWritten} written across ${token.claims.length} ${token.claims.length === 1 ? 'leg' : 'legs'}, ${exactDeliverable} deliverable from the wallet right now.`;

  // The flag sits on the far side of the rule once the rule is past the middle, so it never runs
  // off the end of the bar.
  const flagFlips = coverageShare > 55;

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 id={labelId} className="font-mono text-lead tnum text-ink">
          {token.symbol}
        </h3>
        <div className="flex items-baseline gap-6">
          <p className="flex items-baseline gap-1.5 leading-num">
            <span className="text-mini text-ink-3">Written</span>
            <span className="font-mono text-lead tnum text-ink" title={exactWritten}>
              {writtenText}
            </span>
          </p>
          <p className="flex items-baseline gap-1.5 leading-num">
            <span className="text-mini text-ink-3">Deliverable now</span>
            <span className="font-mono text-lead tnum text-accent" title={exactDeliverable}>
              {deliverableText}
            </span>
          </p>
        </div>
      </div>

      {loading ? (
        <Skeleton radius="control" className="h-11 w-full" label={`${token.symbol} inventory`} />
      ) : (
        <div
          role="img"
          aria-labelledby={labelId}
          aria-describedby={`${labelId}-desc`}
          className="relative h-11 w-full overflow-hidden rounded-control border border-line bg-surface-2"
        >
          {segments.map((segment) => {
            const isOn = highlight !== undefined && highlight === segment.claim.strategyHash;
            return (
              <div
                key={segment.claim.strategyHash}
                title={`${segment.claim.label} ${segment.claim.kind}: ${formatTokenAmount(segment.claim.amount, token.decimals, { symbol: token.symbol })}`}
                onMouseEnter={() => onHighlight?.(segment.claim.strategyHash)}
                onMouseLeave={() => onHighlight?.(undefined)}
                className={cn(
                  'absolute inset-y-0 flex items-center justify-center border-r border-bg last:border-r-0',
                  isOn && 'z-dropdown ring-1 ring-accent ring-inset',
                )}
                style={{
                  left: `${segment.leftPct}%`,
                  width: `${segment.widthPct}%`,
                  backgroundImage: HATCH,
                  transitionProperty: 'left, width',
                  transitionDuration: 'var(--duration-slow)',
                  transitionTimingFunction: 'var(--ease-out-quart)',
                }}
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 bg-accent-dim"
                  style={{
                    width: `${segment.coveredPct}%`,
                    transitionProperty: 'width',
                    transitionDuration: 'var(--duration-slow)',
                    transitionTimingFunction: 'var(--ease-out-quart)',
                  }}
                />
                {segment.showLabel ? (
                  <span className="relative font-mono text-mini tnum text-ink">{segment.claim.label}</span>
                ) : null}
              </div>
            );
          })}

          {/* The wallet line. Drawn last so it sits over every segment it crosses. */}
          <div
            aria-hidden="true"
            className="absolute inset-y-0 z-sticky w-0.5 bg-accent"
            style={{
              left: `calc(${coverageShare}% - 1px)`,
              transitionProperty: 'left',
              transitionDuration: 'var(--duration-slow)',
              transitionTimingFunction: 'var(--ease-out-quart)',
            }}
          />
        </div>
      )}

      <p id={`${labelId}-desc`} className="sr-only">
        {summary}
      </p>

      <div className="relative h-4">
        {loading ? null : (
          <span
            className={cn('absolute top-0 flex items-center gap-1.5 whitespace-nowrap text-mini text-ink-3', flagFlips && 'flex-row-reverse')}
            style={{
              left: `${coverageShare}%`,
              transform: flagFlips ? 'translateX(-100%)' : undefined,
              transitionProperty: 'left',
              transitionDuration: 'var(--duration-slow)',
              transitionTimingFunction: 'var(--ease-out-quart)',
            }}
          >
            <span aria-hidden="true" className="h-2 w-px bg-accent-dim" />
            <span className="text-accent">wallet</span>
          </span>
        )}
      </div>
    </div>
  );
}
