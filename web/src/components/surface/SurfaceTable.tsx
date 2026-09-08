'use client';

/**
 * Every offer on the router, one row each.
 *
 * The left half of the row is decoded — price, movement, date, size — and needs no contract call,
 * because Aqua published the bytes. The right half is priced by `SurfaceLens` at the same block:
 * the curve's own mark, the delta read straight off the reserve, and the value measured from the
 * reserves that are actually there. A cell the chain has not answered for stays blank.
 *
 * A withdrawn offer is one of those. Aqua zeroes its reserves, so the mark inversion `d1 = Phi^-1(1
 * - X/L)` lands on the `icdf` clamp and returns a price with no relation to the offer -- 5,036 USDC
 * on a 2,600 call, equal to its own premium. `SurfaceLens` refuses to price those rows, and the
 * delta (which the table could derive itself from the reserve) is blanked here for the same reason:
 * zero reserves are Aqua's answer about custody, not the curve's answer about a price.
 */
import Link from 'next/link';
import { Group, Skeleton, Table } from '@mantine/core';
import { tokenInfo, type Deployments } from '@/lib/contracts';
import { formatUnits } from '@/lib/ui';
import { daysToExpiry, deltaOf } from './decode';
import { Amount, Blank, Head, MakerAddress, META, Panel, StateBadge } from './kit';
import type { SurfaceLeg } from './types';

const COLUMNS = 10;

export interface SurfaceTableProps {
  legs: readonly SurfaceLeg[];
  deployments?: Deployments;
  nowSeconds?: number;
  loading?: boolean;
  /** Row click selects the (price, date) cell in the quote panel. */
  onSelect?: (key: string) => void;
}

export function SurfaceTable({
  legs,
  deployments,
  nowSeconds,
  loading,
  onSelect,
}: SurfaceTableProps) {
  return (
    <Panel
      title="Every offer on this router"
      lede="One row per offer, read from the chain's own log and priced at a single block, across every wallet. Offers that were taken down stay listed: one that was withdrawn is still part of the record."
      flush
    >
      <Table.ScrollContainer minWidth={1120} type="native">
        <Table verticalSpacing="sm" horizontalSpacing="md" highlightOnHover tabularNums fz={META}>
          <Table.Caption className="sr-only">Every offer made on this router</Table.Caption>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>
                <Head term="The wallet that published the offer. Its tokens never left it.">
                  Wallet
                </Head>
              </Table.Th>
              <Table.Th>
                <Head numeric term="The strike, K: the price this wallet said it would sell at.">
                  Sells at
                </Head>
              </Table.Th>
              <Table.Th>
                <Head numeric term="Time to expiry, measured against the chain's clock rather than your browser's.">
                  Time left
                </Head>
              </Table.Th>
              <Table.Th>
                <Head
                  numeric
                  term="Implied volatility. How big a move this seller is being paid for, read straight out of the published bytes rather than solved for."
                >
                  Movement
                </Head>
              </Table.Th>
              <Table.Th>
                <Head numeric term="Notional, L. How much the offer is written across.">
                  Size
                </Head>
              </Table.Th>
              <Table.Th>
                <Head
                  numeric
                  term="Delta, Phi(-d1), read from the reserves. Roughly the chance this offer ends up selling, and how much of each move it currently absorbs."
                >
                  Chance of selling
                </Head>
              </Table.Th>
              <Table.Th>
                <Head numeric term="Mark: the price the curve is quoting right now, from the reserves in Aqua.">
                  Quoting now
                </Head>
              </Table.Th>
              <Table.Th>
                <Head
                  numeric
                  term="Premium: the Black-Scholes value of the option, measured from the reserves that are actually there."
                >
                  Worth
                </Head>
              </Table.Th>
              <Table.Th>
                <Head
                  numeric
                  term="Deliverable depth. What the wallet can actually hand over now, which is less than the size whenever the maker has over-allocated."
                >
                  Can sell now
                </Head>
              </Table.Th>
              <Table.Th>
                <Head>Status</Head>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {loading
              ? Array.from({ length: 4 }, (_, row) => (
                  <Table.Tr key={row}>
                    {Array.from({ length: COLUMNS }, (_, col) => (
                      <Table.Td key={col}>
                        <Skeleton height={14} radius="sm" />
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))
              : legs.map((leg) => (
                  <LegRow
                    key={leg.strategyHash}
                    leg={leg}
                    deployments={deployments}
                    nowSeconds={nowSeconds}
                    onSelect={onSelect}
                  />
                ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Panel>
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
  const delta = leg.pricing
    ? Number(leg.pricing.deltaWad) / 1e18
    : leg.docked
      ? undefined
      : deltaOf(leg);
  const matured = days !== undefined && days <= 0;

  return (
    <Table.Tr
      onClick={onSelect ? () => onSelect(`${leg.strikeWad.toString()}-${leg.maturity}`) : undefined}
      className={onSelect ? 'cursor-pointer' : undefined}
    >
      <Table.Td>
        <Group gap="xs" wrap="nowrap">
          <MakerAddress value={leg.maker} />
          {leg.mine ? <StateBadge tone="mine">You</StateBadge> : null}
        </Group>
      </Table.Td>

      <Table.Td ta="right">
        {/* The strategy hash is the identity, so this URL resolves for any maker's offer, not only
            for the wallet that wrote it. It is the only path to the curve from this screen. */}
        <Link
          href={`/leg/${leg.strategyHash}`}
          onClick={(e) => e.stopPropagation()}
          className="rounded-control font-mono transition-state hover:text-accent hover:underline hover:underline-offset-2"
        >
          {formatUnits(leg.strikeWad, 18, { maxFractionDigits: 0 })}
          <span className="text-ink-3"> {stable.symbol}</span>
        </Link>
      </Table.Td>

      <Table.Td ta="right">
        {days === undefined ? <Blank /> : days <= 0 ? 'expired' : `${days.toFixed(1)}d`}
      </Table.Td>

      <Table.Td ta="right">{formatUnits(leg.sigmaWad, 16, { maxFractionDigits: 1 })}%</Table.Td>

      <Table.Td ta="right">
        <Amount value={leg.liquidityWad} decimals={18} symbol={risky.symbol} />
      </Table.Td>

      <Table.Td ta="right">{delta === undefined ? <Blank /> : delta.toFixed(3)}</Table.Td>

      <Table.Td ta="right">
        {leg.pricing ? (
          <Amount value={leg.pricing.markWad} decimals={18} symbol={stable.symbol} />
        ) : (
          <Blank />
        )}
      </Table.Td>

      <Table.Td ta="right">
        {leg.pricing ? (
          <Amount value={leg.pricing.premiumWad} decimals={18} symbol={stable.symbol} />
        ) : (
          <Blank />
        )}
      </Table.Td>

      <Table.Td ta="right">
        <Amount
          value={leg.pricing ? leg.pricing.deliverableRisky : leg.reserveRisky}
          decimals={risky.decimals}
          symbol={risky.symbol}
        />
      </Table.Td>

      <Table.Td>
        <Group gap={6} wrap="nowrap">
          {leg.docked ? (
            <StateBadge tone="muted" title="Docked in Aqua">
              Withdrawn
            </StateBadge>
          ) : matured ? (
            <StateBadge tone="warn" title="Past maturity: settling, assignment only">
              Past its date
            </StateBadge>
          ) : (
            <StateBadge tone="live">Live</StateBadge>
          )}
          {!leg.docked && !leg.guarded ? (
            <StateBadge tone="warn" title="No Coverage instruction wraps the curve">
              Wallet not checked
            </StateBadge>
          ) : null}
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}
