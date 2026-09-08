'use client';

/**
 * The five figures that describe a book.
 *
 * Every one is measured. The two that are usually modelled elsewhere are the two this file is most
 * careful about:
 *
 *  - **Theta captured** is realised, summed from the decay band each past fill actually had to
 *    clear, replayed at that fill's own block. It is never a Black-Scholes evaluation, and while a
 *    replay is still in flight the tile says so rather than showing a number that is about to grow.
 *  - **Book delta** is read, not computed. For an RMM leg the position value is `V = S*X + Y` along
 *    the curve, so `dV/dS = X`: the delta in risky units is literally the leg's risky reserve. The
 *    tile is a sum of chain reads with no Gaussian anywhere near it.
 *
 * `Backed` floors rather than rounds. A book at 99.97% must not print "100%".
 */
import { Tooltip } from '@/components/ui';
import { StatTile, TokenAmount } from '@/components/ui';
import { cn, formatPercent, formatRelativeTime, formatUnits } from '@/lib/ui';
import type { BookKpis } from '@/hooks/useBook';

const ZERO = BigInt(0);

export interface KpiStripProps {
  kpis: BookKpis;
  /** The chain's own clock, so "last fill" is honest on a fork whose time has been warped. */
  blockTimestamp?: bigint;
  loading?: boolean;
  className?: string;
}

/** `2.74x`, formatted through the same fixed-point path as every other figure on screen. */
function multiple(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '-';
  return `${formatUnits(BigInt(Math.round(value * 100)), 2, { significantDigits: 18, minFractionDigits: 2, maxFractionDigits: 2 })}x`;
}

/** Floor to a tenth of a percent: a bound that is nearly met has not been met. */
function backedText(value: number): string {
  if (!Number.isFinite(value)) return '-';
  return formatPercent(Math.floor(value * 1000) / 1000, { fractionDigits: 1 });
}

function Tile({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 lg:border-l lg:border-line lg:pl-6 lg:first:border-l-0 lg:first:pl-0', className)}>{children}</div>
  );
}

export function KpiStrip({ kpis, blockTimestamp, loading = false, className }: KpiStripProps) {
  const theta = kpis.thetaByToken;
  const delta = kpis.deltaByToken;

  const thetaDetail = kpis.thetaPending
    ? 'Replaying the band at each fill block'
    : kpis.thetaFills === 0
      ? 'No fills yet'
      : kpis.thetaIncomplete
        ? `From ${kpis.thetaFills} ${kpis.thetaFills === 1 ? 'fill' : 'fills'}, one band unreadable`
        : `Band cleared across ${kpis.thetaFills} ${kpis.thetaFills === 1 ? 'fill' : 'fills'}`;

  const lastFill =
    kpis.lastFillAt !== undefined && blockTimestamp !== undefined
      ? formatRelativeTime(kpis.lastFillAt, { unit: 's', now: Number(blockTimestamp) * 1000 })
      : undefined;

  return (
    <div className={cn('grid grid-cols-2 gap-x-6 gap-y-7 lg:grid-cols-5', className)}>
      <Tile>
        <StatTile
          label="Notional written"
          loading={loading}
          value={kpis.writtenToken ? multiple(kpis.writtenMultiple) : undefined}
          empty="0x"
          detail={
            kpis.writtenToken ? (
              <>
                {formatUnits(kpis.writtenToken.written, kpis.writtenToken.decimals, { significantDigits: 6 })} {kpis.writtenToken.symbol} written on{' '}
                {formatUnits(kpis.writtenToken.coverage, kpis.writtenToken.decimals, { significantDigits: 6 })} held
              </>
            ) : (
              'Nothing written yet'
            )
          }
        />
      </Tile>

      <Tile>
        <StatTile
          label="Backed"
          loading={loading}
          value={kpis.backedToken ? backedText(kpis.backed) : undefined}
          empty="100.0%"
          detail={
            kpis.backedToken ? (
              kpis.backed >= 1 ? (
                <>The deepest {kpis.backedToken.symbol} leg is still deliverable in full</>
              ) : (
                <>
                  The deepest {kpis.backedToken.symbol} leg is wallet-bound at{' '}
                  {formatUnits(kpis.backedToken.coverage, kpis.backedToken.decimals, { significantDigits: 6 })}
                </>
              )
            ) : (
              'No obligation to back'
            )
          }
        />
      </Tile>

      <Tile>
        <StatTile
          label="Theta captured"
          loading={loading}
          value={
            theta.length === 0 ? undefined : (
              <span className="flex flex-col items-start gap-0.5">
                {theta.map((entry) => (
                  <TokenAmount key={entry.token.address} value={entry.amount} decimals={entry.token.decimals} symbol={entry.token.symbol} size="lg" />
                ))}
              </span>
            )
          }
          detail={
            <Tooltip content="Each fill had to clear the decay band standing in front of it. The band is replayed from bandFor at that fill's own block, with the reserves folded out of Aqua's Pushed and Pulled logs, so this is the toll takers actually paid — never a model.">
              <span className="cursor-help border-b border-dotted border-line">{thetaDetail}</span>
            </Tooltip>
          }
        />
      </Tile>

      <Tile>
        <StatTile
          label="Book delta"
          loading={loading}
          value={
            delta.length === 0 ? undefined : (
              <span className="flex flex-col items-start gap-0.5">
                {delta.map((entry) => (
                  <TokenAmount key={entry.token.address} value={entry.amount} decimals={entry.token.decimals} symbol={entry.token.symbol} size="lg" />
                ))}
              </span>
            )
          }
          detail={
            <Tooltip content="Along the curve the position value is V = S*X + Y, so dV/dS = X. The book's delta in risky units is the sum of the legs' risky reserves, read from Aqua rather than computed.">
              <span className="cursor-help border-b border-dotted border-line">Sum of the legs&rsquo; risky reserves</span>
            </Tooltip>
          }
        />
      </Tile>

      <Tile className="col-span-2 lg:col-span-1">
        <StatTile
          label="Fills, 24h"
          loading={loading}
          value={kpis.fills24h > 0 || kpis.lastFillAt !== undefined ? formatUnits(BigInt(kpis.fills24h), 0) : undefined}
          empty="0"
          detail={lastFill ? `Last ${lastFill} on the chain clock` : 'No fill on record'}
        />
      </Tile>
    </div>
  );
}

/** Exported for the empty book: a strip of zeroes is still five real reads. */
export const EMPTY_KPIS: BookKpis = {
  writtenMultiple: 0,
  backed: 1,
  thetaByToken: [],
  thetaFills: 0,
  thetaPending: false,
  thetaIncomplete: false,
  deltaByToken: [],
  fills24h: 0,
};

export { ZERO as KPI_ZERO };
