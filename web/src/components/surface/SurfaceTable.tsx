'use client';

/**
 * Every option on the router, one row each.
 *
 * The left half of the row is decoded — strike, vol, expiry, notional — and needs no contract call,
 * because Aqua published the bytes. The right half is priced by `SurfaceLens` at the same block:
 * the curve's own mark, the delta read straight off the reserve, and the premium measured from the
 * reserves that are actually there. A cell the chain has not answered for stays blank.
 *
 * A docked leg is one of those. Aqua zeroes its reserves, so the mark inversion `d1 = Phi^-1(1 -
 * X/L)` lands on the `icdf` clamp and returns a price with no relation to the leg -- 5,036 USDC on a
 * 2,600 call, equal to its own premium. `SurfaceLens` now refuses to price those rows, and the delta
 * (which the table can derive itself from the reserve) is blanked here for the same reason: zero
 * reserves are Aqua's answer about custody, not the curve's answer about a price.
 */
import Link from 'next/link';
import { Address as AddressText, Card, Pill, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableSkeletonRows, TokenAmount } from '@/components/ui';
import { tokenInfo, type Deployments } from '@/lib/contracts';
import { formatUnits } from '@/lib/ui';
import { daysToExpiry, deltaOf } from './decode';
import type { SurfaceLeg } from './types';

const COLUMNS = 10;

export interface SurfaceTableProps {
  legs: readonly SurfaceLeg[];
  deployments?: Deployments;
  nowSeconds?: number;
  loading?: boolean;
  /** Row click selects the (strike, expiry) cell in the quote panel. */
  onSelect?: (key: string) => void;
}

export function SurfaceTable({ legs, deployments, nowSeconds, loading, onSelect }: SurfaceTableProps) {
  return (
    <Card
      title="Every leg on the router"
      description="Read from Aqua's Shipped log and priced at one block, across every maker. Docked legs stay listed: an option that was withdrawn is part of the record."
      flush
    >
      <Table
        caption="Every leg written on this router"
        hideCaption
        minWidth="72rem"
        scrollHint="mark, premium, deliverable"
      >
        <TableHead>
          <TableRow>
            <TableHeaderCell>Maker</TableHeaderCell>
            <TableHeaderCell numeric>Strike</TableHeaderCell>
            <TableHeaderCell numeric>Expiry</TableHeaderCell>
            <TableHeaderCell numeric>Implied vol</TableHeaderCell>
            <TableHeaderCell numeric>Notional</TableHeaderCell>
            <TableHeaderCell numeric>Delta</TableHeaderCell>
            <TableHeaderCell numeric>Mark</TableHeaderCell>
            <TableHeaderCell numeric>Premium</TableHeaderCell>
            <TableHeaderCell numeric>Deliverable</TableHeaderCell>
            <TableHeaderCell>Status</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {loading ? (
            <TableSkeletonRows rows={4} columns={COLUMNS} label="legs" />
          ) : (
            legs.map((leg) => (
              <LegRow
                key={leg.strategyHash}
                leg={leg}
                deployments={deployments}
                nowSeconds={nowSeconds}
                onSelect={onSelect}
              />
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  );
}

function LegRow({
  leg,
  deployments,
  nowSeconds,
  onSelect,
}: {
  leg: SurfaceLeg;
  deployments?: Deployments;
  nowSeconds?: number;
  onSelect?: (key: string) => void;
}) {
  const risky = tokenInfo(leg.tokenRisky, deployments);
  const stable = tokenInfo(leg.tokenStable, deployments);
  const days = nowSeconds === undefined ? undefined : daysToExpiry(leg.maturity, nowSeconds);
  const delta = leg.pricing ? Number(leg.pricing.deltaWad) / 1e18 : leg.docked ? undefined : deltaOf(leg);
  const matured = days !== undefined && days <= 0;

  return (
    <TableRow
      onClick={onSelect ? () => onSelect(`${leg.strikeWad.toString()}-${leg.maturity}`) : undefined}
      className={onSelect ? 'cursor-pointer' : undefined}
    >
      <TableCell>
        <div className="flex items-center gap-2">
          <AddressText value={leg.maker} what="maker address" size="meta" />
          {leg.mine ? (
            <Pill tone="accent" size="sm">
              You
            </Pill>
          ) : null}
        </div>
      </TableCell>

      <TableCell numeric>
        {/* The strategy hash is the identity, so this URL resolves for any maker's leg, not only
            for the wallet that wrote it. It is the only path to the curve from this screen. */}
        <Link
          href={`/leg/${leg.strategyHash}`}
          onClick={(e) => e.stopPropagation()}
          className="rounded-control transition-state hover:text-accent hover:underline hover:underline-offset-2"
        >
          {formatUnits(leg.strikeWad, 18, { maxFractionDigits: 0 })}
          <span className="text-ink-3"> {stable.symbol}</span>
        </Link>
      </TableCell>

      <TableCell numeric>
        {days === undefined ? <Blank /> : days <= 0 ? 'expired' : `${days.toFixed(1)}d`}
      </TableCell>

      <TableCell numeric>{formatUnits(leg.sigmaWad, 16, { maxFractionDigits: 1 })}%</TableCell>

      <TableCell numeric>
        <TokenAmount value={leg.liquidityWad} decimals={18} symbol={risky.symbol} size="sm" />
      </TableCell>

      <TableCell numeric>{delta === undefined ? <Blank /> : delta.toFixed(3)}</TableCell>

      <TableCell numeric>
        {leg.pricing ? (
          <TokenAmount value={leg.pricing.markWad} decimals={18} symbol={stable.symbol} size="sm" />
        ) : (
          <Blank />
        )}
      </TableCell>

      <TableCell numeric>
        {leg.pricing ? (
          <TokenAmount value={leg.pricing.premiumWad} decimals={18} symbol={stable.symbol} size="sm" />
        ) : (
          <Blank />
        )}
      </TableCell>

      <TableCell numeric>
        <TokenAmount
          value={leg.pricing ? leg.pricing.deliverableRisky : leg.reserveRisky}
          decimals={risky.decimals}
          symbol={risky.symbol}
          size="sm"
        />
      </TableCell>

      <TableCell>
        <div className="flex items-center gap-1.5">
          {leg.docked ? (
            <Pill tone="neutral" size="sm" dot>
              Docked
            </Pill>
          ) : matured ? (
            <Pill tone="warning" size="sm" dot>
              Settling
            </Pill>
          ) : (
            <Pill tone="positive" size="sm" dot>
              Live
            </Pill>
          )}
          {!leg.docked && !leg.guarded ? (
            <Pill tone="warning" size="sm">
              Unproven
            </Pill>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

function Blank() {
  return <span className="text-ink-3">&mdash;</span>;
}
