'use client';

/**
 * Deliverable depth: the largest fill this leg can actually honour right now.
 *
 * The number is not the virtual balance Aqua reports, because that number can be a lie —
 * `ship()` checks no balance and `safeBalances()` does not clamp to the wallet, which is exactly how
 * a book advertises depth it cannot deliver. It is the bound the guard itself reports.
 *
 * Each leg is probed at every block with an exact-out `quote` for the *whole* of what it advertises,
 * and the answer is read out of the result:
 *
 *  - the quote clears -> the leg can deliver everything it wrote, and the cost is the quote's own
 *    `amountIn`;
 *  - `NotCovered(needed, free)` -> the wallet is the binding constraint and `free` is the depth, in
 *    token units, from the instruction that will enforce it at fill time;
 *  - `RmmExceedsReserve(requested, available)` -> the curve has run out of that reserve first.
 *
 * A refusal is therefore not an error state here. It is the measurement.
 */
import { Skeleton } from '@/components/ui';
import { cn, formatTokenAmount } from '@/lib/ui';
import type { BookLeg } from '@/hooks/useBook';
import { HATCH, pct } from './visual';

const ZERO = BigInt(0);

export interface DepthCellProps {
  leg: BookLeg;
}

/** What the row says under the bar, and whether that reads as normal or as a constraint. */
function caption(leg: BookLeg): { text: string; tone: 'quiet' | 'warn' } {
  const { probe, depth } = leg;
  if (probe.pending) return { text: 'quoting', tone: 'quiet' };
  if (probe.ok) return { text: 'quote clears at full size', tone: 'quiet' };

  switch (probe.errorName) {
    case 'NotCovered':
      return { text: 'NotCovered: wallet-bound', tone: 'warn' };
    case 'RmmExceedsReserve':
      return { text: 'RmmExceedsReserve: curve-bound', tone: 'quiet' };
    case 'RmmInsideSpread':
      return { text: 'RmmInsideSpread: inside the theta band', tone: 'quiet' };
    case 'RmmSettlementOneWay':
      return { text: 'settled, assignment only', tone: 'quiet' };
    case 'RmmOutOfDomain':
      return { text: 'RmmOutOfDomain: reserves off the curve', tone: 'warn' };
    default:
      return { text: probe.errorName ?? `${depth.bound}-bound`, tone: 'warn' };
  }
}

export function DepthCell({ leg }: DepthCellProps) {
  const token = leg.deliversRisky ? leg.risky : leg.stable;
  // The guard's own number wins when it gave one: it is the same quantity, from the enforcer.
  const amount = leg.probe.bound ?? leg.depth.amount;
  const written = leg.depth.written;
  const note = caption(leg);

  if (written === ZERO) {
    return <span className="font-mono text-meta tnum text-ink-3">no reserve</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <span className="font-mono text-meta tnum leading-num text-ink" title={formatTokenAmount(amount, token.decimals, { symbol: token.symbol })}>
        {formatTokenAmount(amount, token.decimals, { significantDigits: 6 })}
        <span className="ml-1 text-ink-3">{token.symbol}</span>
      </span>

      <div
        className="relative h-1.5 w-28 overflow-hidden rounded-pill border border-line"
        style={{ backgroundImage: HATCH }}
        aria-hidden="true"
      >
        <div
          className="absolute inset-y-0 left-0 bg-accent-dim"
          style={{
            width: `${pct(amount, written)}%`,
            transitionProperty: 'width',
            transitionDuration: 'var(--duration-slow)',
            transitionTimingFunction: 'var(--ease-out-quart)',
          }}
        />
      </div>

      {leg.probe.pending ? (
        <Skeleton className="h-3 w-24" />
      ) : (
        <span className={cn('text-micro normal-case', note.tone === 'warn' ? 'text-warn' : 'text-ink-3')}>{note.text}</span>
      )}
    </div>
  );
}
