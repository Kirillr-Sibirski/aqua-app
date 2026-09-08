'use client';

/**
 * What backs this book.
 *
 * Aqua lets a maker over-allocate on purpose: `ship()` checks no balance and moves no tokens, and
 * `safeBalances()` returns the virtual number with no clamp to the wallet. So a four-leg ladder can
 * be shipped at full size against one balance, and the sum of the legs will exceed it. That is not
 * a warning — at any given price at most one or two legs can actually be swept, and `Coverage`
 * proves the true simultaneous obligation inside the call that prices each trade.
 *
 * The bar says that in one picture: each leg's claim stacked along the wallet balance, with a rule
 * where the wallet ends. Everything past the rule is margined rather than funded, which is the
 * product. The one thing that *is* a warning is a single leg whose own reserve exceeds the whole
 * wallet, because that leg can never fill to its advertised depth no matter what its siblings do.
 */
import { Fragment } from 'react';
import { Callout, Card, StatRow, StatTile, TokenAmount } from '@/components/ui';
import { cn, formatUnits } from '@/lib/ui';
import { colorMix } from '@/lib/ui/tokens';

export interface MarginClaim {
  id: string;
  /** `K 2,600` — short enough for a tooltip and the values list. */
  label: string;
  /** Raw token units this leg ships as its virtual reserve. */
  amount: bigint;
}

export interface MarginRow {
  symbol: string;
  decimals: number;
  /** What the wallet holds right now. */
  wallet: bigint;
  /** `min(balanceOf, allowance)` from `StrikelineViews.coverage`, when the router could be reached. */
  deliverable?: bigint;
  claims: readonly MarginClaim[];
}

export interface MarginPreviewProps {
  rows: readonly MarginRow[];
  loading?: boolean;
  className?: string;
}

/** Ratio of virtual depth to the balance backing it, as `2.7` in "2.7x written". */
function writtenMultiple(row: MarginRow): number | undefined {
  if (row.wallet === BigInt(0)) return undefined;
  const total = row.claims.reduce((sum, c) => sum + c.amount, BigInt(0));
  // 1e4 of resolution is two decimal places on the multiple, which is all that is shown.
  return Number((total * BigInt(10_000)) / row.wallet) / 10_000;
}

export function MarginPreview({ rows, loading = false, className }: MarginPreviewProps) {
  const overcommittedLegs = rows.flatMap((row) =>
    row.claims
      .filter((claim) => claim.amount > row.wallet)
      .map((claim) => ({ claim, symbol: row.symbol, decimals: row.decimals, wallet: row.wallet })),
  );

  return (
    <Card
      title="Backing"
      description="One wallet balance behind every leg. Coverage re-proves it on each quote, so a fill on one leg shrinks what its siblings can deliver in the same block."
      className={className}
    >
      <div className="flex flex-col gap-6">
        {rows.map((row) => (
          <MarginBar key={row.symbol} row={row} loading={loading} />
        ))}
      </div>

      {overcommittedLegs.length > 0 ? (
        <Callout
          tone="warning"
          title="One leg is larger than the whole wallet"
          className="mt-6"
        >
          {overcommittedLegs.map(({ claim, symbol, decimals, wallet }) => (
            <p key={claim.id}>
              <span className="font-mono">{claim.label}</span> ships{' '}
              <span className="font-mono tnum">{formatUnits(claim.amount, decimals)}</span> {symbol} of
              depth against a wallet holding{' '}
              <span className="font-mono tnum">{formatUnits(wallet, decimals)}</span>. Sharing a balance
              across legs is the point; a single leg that exceeds it will refuse its own advertised size
              even with no sibling filled.
            </p>
          ))}
        </Callout>
      ) : null}
    </Card>
  );
}

/**
 * What "backed" means for a book that is deliberately over-allocated.
 *
 * Not the sum of the legs against the wallet: that ratio is above one on purpose and is the
 * product, not a warning. `Coverage` runs per fill, and the obligation it proves is one leg's
 * output at a time — so the book is backed exactly when the largest single sweep a taker could ask
 * for is deliverable from the wallet this instant. That is the number the demo's `NotCovered`
 * revert carries, and it is the one worth saying in a sentence.
 */
function bindingClaim(row: MarginRow): bigint {
  return row.claims.reduce((most, c) => (c.amount > most ? c.amount : most), BigInt(0));
}

function MarginBar({ row, loading }: { row: MarginRow; loading: boolean }) {
  const total = row.claims.reduce((sum, c) => sum + c.amount, BigInt(0));
  const scale = total > row.wallet ? total : row.wallet;
  const multiple = writtenMultiple(row);
  const largest = bindingClaim(row);
  const free = row.deliverable;
  const covered = free === undefined ? undefined : free >= largest;

  // Percentages are laid out from bigints so a 6-decimal and an 18-decimal token behave the same.
  const pct = (value: bigint) => (scale === BigInt(0) ? 0 : Number((value * BigInt(100_000)) / scale) / 1000);

  return (
    <div className="flex flex-col gap-3">
      <StatRow>
        <StatTile
          label={`${row.symbol} shipped`}
          loading={loading}
          value={<TokenAmount value={total} decimals={row.decimals} size="lg" />}
          unit={row.symbol}
          detail={
            multiple !== undefined
              ? `${multiple.toFixed(2)}x the wallet balance, margined across ${row.claims.length} ${row.claims.length === 1 ? 'leg' : 'legs'}`
              : 'Nothing in the wallet to back it'
          }
        />
        <StatTile
          label={`${row.symbol} in the wallet`}
          loading={loading}
          value={<TokenAmount value={row.wallet} decimals={row.decimals} size="lg" />}
          unit={row.symbol}
          detail="Never leaves it. Aqua moves nothing until a fill."
        />
        <StatTile
          label="Deliverable now"
          loading={loading}
          value={
            row.deliverable === undefined ? undefined : (
              <TokenAmount value={row.deliverable} decimals={row.decimals} size="lg" />
            )
          }
          unit={row.deliverable === undefined ? undefined : row.symbol}
          empty="not read"
          detail={
            row.deliverable === undefined
              ? 'coverage() could not be read from the router'
              : 'balanceOf and allowance, whichever binds'
          }
        />
      </StatRow>

      <div>
        <div
          className="relative h-3 w-full overflow-hidden rounded-pill bg-surface-2"
          role="img"
          aria-label={`${row.symbol}: ${formatUnits(total, row.decimals)} shipped across ${row.claims.length} legs against ${formatUnits(row.wallet, row.decimals)} in the wallet`}
        >
          <div className="absolute inset-y-0 left-0 flex w-full">
            {row.claims.map((claim, i) => (
              <Fragment key={claim.id}>
                <span
                  className="h-full"
                  style={{
                    width: `${pct(claim.amount)}%`,
                    // One accent, stepped in opacity: the legs are the same thing at different
                    // strikes, so they are the same hue at different weights, not five colours.
                    background: colorMix('accent', 88 - i * 14),
                  }}
                />
                <span className="h-full w-px shrink-0 bg-surface" />
              </Fragment>
            ))}
          </div>

          {row.wallet > BigInt(0) && row.wallet < scale ? (
            <span
              aria-hidden="true"
              className="absolute inset-y-0 w-px bg-ink"
              style={{ left: `${pct(row.wallet)}%` }}
            />
          ) : null}
        </div>

        {row.claims.length > 0 ? (
          <p className="mt-2 max-w-prose text-mini leading-prose text-ink-3">
            Coverage proves one fill at a time, so the book is backed when the largest single sweep a
            taker could ask for is deliverable. That is{' '}
            <span className="font-mono tnum text-ink-2">
              {formatUnits(largest, row.decimals, { significantDigits: 5 })}
            </span>{' '}
            {row.symbol}
            {free === undefined ? (
              <>, against a wallet the router could not be asked about.</>
            ) : covered ? (
              <>
                , against{' '}
                <span className="font-mono tnum text-ink-2">
                  {formatUnits(free, row.decimals, { significantDigits: 5 })}
                </span>{' '}
                deliverable right now. Backed.
              </>
            ) : (
              <>
                , and only{' '}
                <span className="font-mono tnum text-ink-2">
                  {formatUnits(free, row.decimals, { significantDigits: 5 })}
                </span>{' '}
                is deliverable, so a taker asking for the whole leg would be refused with both
                numbers rather than filled short.
              </>
            )}
          </p>
        ) : null}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-mini text-ink-3">
          {row.claims.map((claim, i) => (
            <span key={claim.id} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-control"
                style={{ background: colorMix('accent', 88 - i * 14) }}
              />
              <span className="font-mono tnum">{claim.label}</span>
              <span className="font-mono tnum text-ink-2">
                {formatUnits(claim.amount, row.decimals, { significantDigits: 4 })}
              </span>
            </span>
          ))}
          {row.wallet > BigInt(0) && row.wallet < scale ? (
            <span className={cn('inline-flex items-center gap-1.5')}>
              <span aria-hidden="true" className="h-3 w-px bg-ink" />
              wallet ends here
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
