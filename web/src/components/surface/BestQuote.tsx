'use client';

/**
 * "Best bid for a 7-day 2,800 call, across all makers."
 *
 * That question has no answer inside Aqua. The registry keys a strategy by the hash of its own
 * bytes and relates nothing to anything: two makers who wrote the same option are two unrelated
 * storage slots, there is no order book, and no view returns "who is quoting this". Decoding the
 * log is what makes the comparison possible at all, and this panel is the comparison.
 *
 * Ranked by implied vol, widest first, because the widest vol is the maker paying the most theta to
 * whoever takes the other side. The premium beside it is the same claim in money: the Black-Scholes
 * value of the call each maker has written, measured by `SurfaceLens` from the reserves actually
 * sitting in Aqua rather than modelled from assumed inputs.
 */
import { useMemo } from 'react';
import { Layers } from 'lucide-react';
import {
  Address as AddressText,
  Card,
  EmptyState,
  Field,
  Pill,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TokenAmount,
} from '@/components/ui';
import { tokenInfo, type Deployments } from '@/lib/contracts';
import { formatUnits } from '@/lib/ui';
import { FLAG_POST_EXPIRY_OUT_IS_RISKY } from '@/components/curve';
import { daysToExpiry, pointKey } from './decode';
import type { SurfaceLeg, SurfacePoint } from './types';

export interface BestQuoteProps {
  points: readonly SurfacePoint[];
  deployments?: Deployments;
  /** The chain's clock, so a warped fork's expiry is where the block says it is. */
  nowSeconds?: number;
  /** Point key currently selected. Lifted so the chart and this panel can agree. */
  selected?: string;
  onSelect: (key: string) => void;
  /** True once the lens has priced at least one leg. Decides what a blank cell means. */
  priced: boolean;
}

export function BestQuote({ points, deployments, nowSeconds, selected, onSelect, priced }: BestQuoteProps) {
  const live = useMemo(() => points.filter((p) => p.liveLegs.length > 0), [points]);

  const current = live.find((p) => p.key === selected) ?? live[0];

  // Both selects stay inside the current pair. A strike is normalised stable per risky, so 2,800 on
  // WETH and 2,800 on cbBTC are different options, and offering them in one list would imply a
  // taker could choose between them.
  const samePair = useMemo(
    () =>
      current
        ? live.filter(
            (p) =>
              p.tokenRisky.toLowerCase() === current.tokenRisky.toLowerCase() &&
              p.tokenStable.toLowerCase() === current.tokenStable.toLowerCase(),
          )
        : [],
    [live, current],
  );

  const strikes = useMemo(() => {
    const seen = new Map<string, bigint>();
    for (const p of samePair) seen.set(p.strikeWad.toString(), p.strikeWad);
    return [...seen.values()].sort((a, b) => (a === b ? 0 : a < b ? -1 : 1));
  }, [samePair]);

  const expiries = useMemo(() => {
    if (!current) return [];
    return samePair
      .filter((p) => p.strikeWad === current.strikeWad)
      .map((p) => p.maturity)
      .sort((a, b) => a - b);
  }, [samePair, current]);

  if (live.length === 0 || !current) {
    return (
      <Card title="Best quote">
        <EmptyState
          icon={Layers}
          title="Nothing is quoted yet"
          description="This panel ranks every maker who has written the same option. It fills in as soon as one live leg exists on the router."
          bare
        />
      </Card>
    );
  }

  const risky = tokenInfo(current.tokenRisky, deployments);
  const stable = tokenInfo(current.tokenStable, deployments);
  const days = nowSeconds === undefined ? undefined : daysToExpiry(current.maturity, nowSeconds);
  const strikeLabel = formatUnits(current.strikeWad, 18, { maxFractionDigits: 0 });

  return (
    <Card
      title="Best quote"
      description={`Every maker who has written the ${strikeLabel} ${stable.symbol} strike${days === undefined ? '' : `, ${days.toFixed(1)} days out`}, ranked by the vol they quote. Aqua keys a strategy by its own hash and relates nothing to anything, so this comparison exists nowhere else.`}
      actions={
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Strike">
            <Select
              size="sm"
              value={current.strikeWad.toString()}
              onChange={(e) => {
                const strike = BigInt(e.target.value);
                const match = samePair.find((p) => p.strikeWad === strike);
                if (match) onSelect(match.key);
              }}
              options={strikes.map((s) => ({
                value: s.toString(),
                label: formatUnits(s, 18, { maxFractionDigits: 0 }),
              }))}
            />
          </Field>
          <Field label="Expiry">
            <Select
              size="sm"
              value={String(current.maturity)}
              onChange={(e) =>
                onSelect(
                  pointKey(
                    current.tokenRisky,
                    current.tokenStable,
                    current.strikeWad,
                    Number(e.target.value),
                  ),
                )
              }
              options={expiries.map((m) => ({
                value: String(m),
                label:
                  nowSeconds === undefined
                    ? new Date(m * 1000).toISOString().slice(0, 10)
                    : `${daysToExpiry(m, nowSeconds).toFixed(1)} days`,
              }))}
            />
          </Field>
        </div>
      }
      footer={
        <p className="text-mini leading-prose text-ink-3">
          Implied vol, notional and margin are decoded from the shipped bytes and need no contract
          call. Premium, deliverable depth and the minimum ticket come from{' '}
          <span className="font-mono text-ink-2">SurfaceLens</span>; a blank cell means it has not
          answered for that leg, never that the figure is zero.
        </p>
      }
      flush
    >
      <Table caption="Makers quoting this option" hideCaption minWidth="58rem">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Maker</TableHeaderCell>
            <TableHeaderCell numeric>Implied vol</TableHeaderCell>
            <TableHeaderCell numeric>Premium per {risky.symbol}</TableHeaderCell>
            <TableHeaderCell numeric>Notional</TableHeaderCell>
            <TableHeaderCell numeric>Deliverable now</TableHeaderCell>
            <TableHeaderCell numeric>Min ticket</TableHeaderCell>
            <TableHeaderCell>Margin</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {current.liveLegs.map((leg, index) => (
            <QuoteRow
              key={leg.strategyHash}
              leg={leg}
              best={index === 0 && current.liveLegs.length > 1}
              riskyDecimals={risky.decimals}
              riskySymbol={risky.symbol}
              stableDecimals={stable.decimals}
              stableSymbol={stable.symbol}
              priced={priced}
            />
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function QuoteRow({
  leg,
  best,
  riskyDecimals,
  riskySymbol,
  stableDecimals,
  stableSymbol,
  priced,
}: {
  leg: SurfaceLeg;
  best: boolean;
  riskyDecimals: number;
  riskySymbol: string;
  stableDecimals: number;
  stableSymbol: string;
  priced: boolean;
}) {
  const pricing = leg.pricing;
  // A call is assigned by a taker buying the risky side, a put by a taker selling it, so the
  // deliverable side is the one the expiry flag names.
  const deliversRisky = (leg.flags & FLAG_POST_EXPIRY_OUT_IS_RISKY) !== 0;
  const outDecimals = deliversRisky ? riskyDecimals : stableDecimals;
  const outSymbol = deliversRisky ? riskySymbol : stableSymbol;
  const inDecimals = deliversRisky ? stableDecimals : riskyDecimals;
  const inSymbol = deliversRisky ? stableSymbol : riskySymbol;

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          <AddressText value={leg.maker} what="maker address" size="meta" />
          {leg.mine ? (
            <Pill tone="accent" size="sm">
              You
            </Pill>
          ) : null}
          {best ? (
            <Pill tone="positive" size="sm">
              Best
            </Pill>
          ) : null}
        </div>
      </TableCell>

      <TableCell numeric>{formatUnits(leg.sigmaWad, 16, { maxFractionDigits: 1 })}%</TableCell>

      <TableCell numeric>
        {pricing ? (
          <TokenAmount value={pricing.premiumWad} decimals={18} symbol={stableSymbol} size="sm" />
        ) : (
          <Blank priced={priced} />
        )}
      </TableCell>

      <TableCell numeric>
        <TokenAmount value={leg.liquidityWad} decimals={18} symbol={riskySymbol} size="sm" />
      </TableCell>

      <TableCell numeric>
        <TokenAmount
          value={
            pricing
              ? deliversRisky
                ? pricing.deliverableRisky
                : pricing.deliverableStable
              : deliversRisky
                ? leg.reserveRisky
                : leg.reserveStable
          }
          decimals={outDecimals}
          symbol={outSymbol}
          size="sm"
        />
      </TableCell>

      <TableCell numeric>
        {pricing ? (
          <TokenAmount
            value={deliversRisky ? pricing.minStableIn : pricing.minRiskyIn}
            decimals={inDecimals}
            symbol={inSymbol}
            size="sm"
          />
        ) : (
          <Blank priced={priced} />
        )}
      </TableCell>

      <TableCell>
        {leg.guarded ? (
          <Pill tone="positive" size="sm" dot>
            Margined
          </Pill>
        ) : (
          <Pill tone="warning" size="sm" dot>
            Unproven
          </Pill>
        )}
      </TableCell>
    </TableRow>
  );
}

/** A number the chain has not returned is absent, never a zero. */
function Blank({ priced }: { priced: boolean }) {
  return (
    <span className="text-ink-3" aria-label={priced ? 'not priced by the lens' : 'waiting on the lens'}>
      &mdash;
    </span>
  );
}
