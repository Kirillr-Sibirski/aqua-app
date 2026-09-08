'use client';

/**
 * The five figures that describe your offers.
 *
 * Every one is measured. The two that are usually modelled elsewhere are the two this file is most
 * careful about:
 *
 *  - **Paid so far** is realised theta, summed from the decay band each past fill actually had to
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
  /** False before a wallet is connected: there is no book, so every tile shows a rule, not a zero. */
  connected?: boolean;
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

export function KpiStrip({ kpis, connected = true, blockTimestamp, loading = false, className }: KpiStripProps) {
  // Disconnected is not the same as empty. "Backed 100%" with no wallet attached is a claim about a
  // book that does not exist, so every figure falls back to a rule until there is a maker to read.
  // The captions go with them: the header already says there is no wallet, and repeating it five
  // times across one strip is noise.
  const detail = (value: React.ReactNode) => (connected ? value : undefined);
  const figure = <T,>(value: T | undefined): T | undefined => (connected ? value : undefined);

  const thetaDetail = kpis.thetaPending
    ? 'Replaying what each past buyer had to cross'
    : kpis.thetaFills === 0
      ? 'Nobody has taken an offer yet'
      : kpis.thetaIncomplete
        ? `From ${kpis.thetaFills} ${kpis.thetaFills === 1 ? 'trade' : 'trades'}, one gap unreadable`
        : `Actually crossed on ${kpis.thetaFills} ${kpis.thetaFills === 1 ? 'trade' : 'trades'}`;

  const lastFill =
    kpis.lastFillAt !== undefined && blockTimestamp !== undefined
      ? formatRelativeTime(kpis.lastFillAt, { unit: 's', now: Number(blockTimestamp) * 1000 })
      : undefined;

  return (
    <section className={cn('flex flex-col gap-5', className)} aria-label="Summary of your offers">
      <div className="grid grid-cols-2 gap-x-6 gap-y-7 lg:grid-cols-5">
        <Tile>
          <StatTile
            label={<span title="Notional written">Total on offer</span>}
            loading={loading}
            value={figure(kpis.writtenToken ? multiple(kpis.writtenMultiple) : undefined)}
            empty={connected ? '0x' : '—'}
            detail={
              detail(
                kpis.writtenToken ? (
                  <>
                    {formatUnits(kpis.writtenToken.written, kpis.writtenToken.decimals, { significantDigits: 6 })} {kpis.writtenToken.symbol} offered against{' '}
                    {formatUnits(kpis.writtenToken.coverage, kpis.writtenToken.decimals, { significantDigits: 6 })} held
                  </>
                ) : (
                  'Nothing on offer yet'
                ),
              )
            }
          />
        </Tile>

        <Tile>
          <StatTile
            label={<span title="The deepest single offer, against what the wallet can deliver">Covered</span>}
            loading={loading}
            value={figure(kpis.backedToken ? backedText(kpis.backed) : undefined)}
            // Never '100.0%'. A connected wallet with no legs has nothing to back, and a
            // measurement-shaped figure for a book that does not exist is a fabricated number --
            // this file's own docstring says a book at 99.97% must not print 100%. The detail line
            // below already carries the meaning.
            empty="—"
            detail={
              detail(
                kpis.backedToken ? (
                  kpis.backed >= 1 ? (
                    <>Biggest {kpis.backedToken.symbol} offer sellable in full</>
                  ) : (
                    <>
                      Biggest {kpis.backedToken.symbol} offer capped by your wallet at{' '}
                      {formatUnits(kpis.backedToken.coverage, kpis.backedToken.decimals, { significantDigits: 6 })}
                    </>
                  )
                ) : (
                  'Nothing on offer to cover'
                ),
              )
            }
          />
        </Tile>

        <Tile>
          <StatTile
            label={<span title="Realised theta">Paid so far</span>}
            loading={loading}
            value={figure(kpis.thetaByToken.length === 0 ? undefined : <Amounts entries={kpis.thetaByToken} />)}
            detail={detail(thetaDetail)}
          />
        </Tile>

        <Tile>
          <StatTile
            label={<span title="Book delta">What you would hand over now</span>}
            loading={loading}
            value={figure(kpis.deltaByToken.length === 0 ? undefined : <Amounts entries={kpis.deltaByToken} />)}
            detail={detail(<>Sum of what every offer is holding</>)}
          />
        </Tile>

        <Tile className="col-span-2 lg:col-span-1">
          <StatTile
            label={<span title="Fills in the last 24 hours">Times taken, 24h</span>}
            loading={loading}
            value={figure(formatUnits(BigInt(kpis.fills24h), 0))}
            detail={detail(lastFill ? `Last ${lastFill} on the chain clock` : 'Nobody has taken an offer yet')}
          />
        </Tile>
      </div>

      <div className="flex max-w-prose flex-col gap-2 text-mini leading-prose text-ink-3">
        <p>
          You are not paid up front. What you earn is the gap that opens in your own quote as the
          date approaches, and it only becomes real when somebody crosses it. Paid so far is
          measured, never modelled: it is the gap each past buyer actually had to clear.
        </p>
        <p>
          <em className="not-italic text-ink-2">Mechanically:</em> realised theta is replayed from{' '}
          <span className="font-mono">bandFor</span> at each fill&rsquo;s own block. Book delta is
          read rather than computed: along the curve <span className="font-mono">dV/dS = X</span>, so
          the delta in risky units is the legs&rsquo; own reserves.
        </p>
      </div>
    </section>
  );
}
