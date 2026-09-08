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
 * Both methods are printed under the strip rather than hidden in a tooltip: a hint is invisible to
 * touch, to a screenshot and to anyone watching a recording, and how these two are derived is the
 * most interesting thing about them.
 *
 * `Backed` floors rather than rounds. A book at 99.97% must not print "100%".
 */
import { StatTile, TokenAmount } from '@/components/ui';
import { cn, formatPercent, formatRelativeTime, formatUnits } from '@/lib/ui';
import type { BookKpis } from '@/hooks/useBook';

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
  return <div className={cn('min-w-0 lg:border-l lg:border-line lg:pl-6 lg:first:border-l-0 lg:first:pl-0', className)}>{children}</div>;
}

/** A stack of amounts, for a figure that lands in more than one token. */
function Amounts({ entries }: { entries: BookKpis['thetaByToken'] }) {
  return (
    <span className="flex flex-col items-start gap-0.5">
      {entries.map((entry) => (
        <TokenAmount key={entry.token.address} value={entry.amount} decimals={entry.token.decimals} symbol={entry.token.symbol} size="lg" />
      ))}
    </span>
  );
}

export function KpiStrip({ kpis, blockTimestamp, loading = false, className }: KpiStripProps) {
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
    <section className={cn('flex flex-col gap-5', className)} aria-label="Book summary">
      <div className="grid grid-cols-2 gap-x-6 gap-y-7 lg:grid-cols-5">
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
                  <>Deepest {kpis.backedToken.symbol} leg deliverable in full</>
                ) : (
                  <>
                    Deepest {kpis.backedToken.symbol} leg wallet-bound at{' '}
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
            value={kpis.thetaByToken.length === 0 ? undefined : <Amounts entries={kpis.thetaByToken} />}
            detail={thetaDetail}
          />
        </Tile>

        <Tile>
          <StatTile
            label="Book delta"
            loading={loading}
            value={kpis.deltaByToken.length === 0 ? undefined : <Amounts entries={kpis.deltaByToken} />}
            detail={<>Sum of the legs&rsquo; risky reserves</>}
          />
        </Tile>

        <Tile className="col-span-2 lg:col-span-1">
          <StatTile
            label="Fills, 24h"
            loading={loading}
            value={formatUnits(BigInt(kpis.fills24h), 0)}
            detail={lastFill ? `Last ${lastFill} on the chain clock` : 'No fill on record'}
          />
        </Tile>
      </div>

      <p className="max-w-prose text-mini leading-prose text-ink-3">
        Theta captured is realised, not modelled: it is the decay band each past fill had to clear, replayed from{' '}
        <span className="font-mono">bandFor</span> at that fill&rsquo;s own block. Book delta is read rather than computed: along the curve{' '}
        <span className="font-mono">dV/dS = X</span>, so the delta in risky units is the legs&rsquo; own reserves.
      </p>
    </section>
  );
}
