'use client';

/**
 * "Best price for a 7-day 2,800 offer, across all makers."
 *
 * That question has no answer inside Aqua. The registry keys a strategy by the hash of its own
 * bytes and relates nothing to anything: two makers who wrote the same option are two unrelated
 * storage slots, there is no order book, and no view returns "who is quoting this". Decoding the
 * log is what makes the comparison possible at all, and this panel is the comparison.
 *
 * Ranked by implied vol, widest first, because the widest vol is the maker paying the most for the
 * wait. The figure beside it is the same claim in money: the Black-Scholes value of the option each
 * maker has written, measured by `SurfaceLens` from the reserves actually sitting in Aqua rather
 * than modelled from assumed inputs.
 *
 * Plain words on the screen, the precise term one hover away. The columns say "movement priced in"
 * and "can sell now"; the tooltips say implied volatility and deliverable depth.
 */
import { useMemo } from 'react';
import { Badge, Group, Select, Table, Text } from '@mantine/core';
import { tokenInfo, type Deployments } from '@/lib/contracts';
import { formatUnits } from '@/lib/ui';
import { FLAG_POST_EXPIRY_OUT_IS_RISKY } from '@/components/curve';
import { daysToExpiry, pointKey } from './decode';
import { Amount, Blank, Head, MakerAddress, META, Panel, StateBadge } from './kit';
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

/**
 * The cell to show when nobody has picked one.
 *
 * Not simply the first: the panel's whole point is the comparison across makers, so it opens on the
 * cell where the most of them are quoting the same option. Ties go to the nearest expiry and then
 * to the lowest strike, so the choice is stable between renders rather than dependent on log order.
 */
export function pickQuotePoint(
  points: readonly SurfacePoint[],
  selected?: string,
): SurfacePoint | undefined {
  const live = points.filter((p) => p.liveLegs.length > 0);
  const chosen = live.find((p) => p.key === selected);
  if (chosen) return chosen;

  return live.reduce<SurfacePoint | undefined>((best, point) => {
    if (!best) return point;
    if (point.liveLegs.length !== best.liveLegs.length) {
      return point.liveLegs.length > best.liveLegs.length ? point : best;
    }
    if (point.maturity !== best.maturity) return point.maturity < best.maturity ? point : best;
    return point.strikeWad < best.strikeWad ? point : best;
  }, undefined);
}

export function BestQuote({
  points,
  deployments,
  nowSeconds,
  selected,
  onSelect,
  priced,
}: BestQuoteProps) {
  const live = useMemo(() => points.filter((p) => p.liveLegs.length > 0), [points]);

  const current = useMemo(() => pickQuotePoint(points, selected), [points, selected]);

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
      <Panel
        title="Nobody is offering anything yet"
        lede="This panel lines up every wallet offering the same price on the same date, so you can see which of them pays most for the wait. It fills in the moment one live offer exists on this router."
      >
        <Text fz="sm" c="var(--ink-3)">
          Read from the chain&rsquo;s own log, so nothing here is waiting on a server. There is
          simply nothing published yet.
        </Text>
      </Panel>
    );
  }

  const risky = tokenInfo(current.tokenRisky, deployments);
  const stable = tokenInfo(current.tokenStable, deployments);
  const days = nowSeconds === undefined ? undefined : daysToExpiry(current.maturity, nowSeconds);
  const strikeLabel = formatUnits(current.strikeWad, 18, { maxFractionDigits: 0 });
  const best = current.liveLegs[0];
  const makers = new Set(current.liveLegs.map((l) => l.maker.toLowerCase())).size;

  return (
    <Panel
      title={
        <>
          Best offer at {strikeLabel} {stable.symbol}
          {days === undefined ? '' : `, ${days.toFixed(1)} days out`}
          <Text component="span" c="var(--ink-3)" fw={400}>
            {' '}
            &mdash; across every wallet
          </Text>
        </>
      }
      lede={
        <>
          {makers === 1
            ? 'One wallet is offering this price and date.'
            : `${makers} wallets are offering this same price and date.`}{' '}
          The chain keys every offer by the hash of its own bytes and relates nothing to anything, so
          this comparison exists nowhere on chain. It is assembled here, from the log.
        </>
      }
      controls={
        <Group gap="sm" align="end" wrap="wrap">
          <Select
            label="Price"
            size="xs"
            w={140}
            allowDeselect={false}
            comboboxProps={{ withinPortal: true }}
            value={current.strikeWad.toString()}
            data={strikes.map((s) => ({
              value: s.toString(),
              label: `${formatUnits(s, 18, { maxFractionDigits: 0 })} ${stable.symbol}`,
            }))}
            onChange={(value) => {
              if (!value) return;
              const strike = BigInt(value);
              const match = samePair.find((p) => p.strikeWad === strike);
              if (match) onSelect(match.key);
            }}
          />
          <Select
            label="By when"
            size="xs"
            w={140}
            allowDeselect={false}
            comboboxProps={{ withinPortal: true }}
            value={String(current.maturity)}
            data={expiries.map((m) => ({
              value: String(m),
              label:
                nowSeconds === undefined
                  ? new Date(m * 1000).toISOString().slice(0, 10)
                  : `${daysToExpiry(m, nowSeconds).toFixed(1)} days`,
            }))}
            onChange={(value) => {
              if (!value) return;
              onSelect(
                pointKey(
                  current.tokenRisky,
                  current.tokenStable,
                  current.strikeWad,
                  Number(value),
                ),
              );
            }}
          />
        </Group>
      }
      footer={
        <>
          The movement priced in, the size and the wallet check are decoded from the published bytes
          and need no contract call. What the offer is worth, how much can be sold and the smallest
          trade come from <span className="font-mono text-ink-2">SurfaceLens</span>; a blank cell
          means it has not answered for that offer, never that the figure is zero.
        </>
      }
      flush
    >
      {best ? (
        <Answer
          leg={best}
          stableSymbol={stable.symbol}
          stableDecimals={stable.decimals}
          riskySymbol={risky.symbol}
          riskyDecimals={risky.decimals}
          strikeLabel={strikeLabel}
          alone={current.liveLegs.length === 1}
        />
      ) : null}

      <Table.ScrollContainer minWidth={880} type="native">
        <Table
          verticalSpacing="sm"
          horizontalSpacing="md"
          highlightOnHover
          tabularNums
          striped={false}
          fz={META}
        >
          <Table.Caption className="sr-only">
            Every wallet quoting {strikeLabel} {stable.symbol} on this date
          </Table.Caption>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>
                <Head term="The wallet that published the offer. Its tokens never left it.">
                  Wallet
                </Head>
              </Table.Th>
              <Table.Th>
                <Head
                  numeric
                  term="Implied volatility. How big a move this seller is being paid for. A wider number means they are paid more for the wait, and their price moves faster against a taker."
                >
                  Movement priced in
                </Head>
              </Table.Th>
              <Table.Th>
                <Head
                  numeric
                  term={`Premium. The Black-Scholes value of what this wallet has written, per ${risky.symbol}, measured by SurfaceLens from the reserves actually sitting in Aqua.`}
                >
                  Worth per {risky.symbol}
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
                  term="Deliverable depth. What the maker's own wallet can actually hand over right now, which is less than the size whenever they have over-allocated."
                >
                  Can sell now
                </Head>
              </Table.Th>
              <Table.Th>
                <Head
                  numeric
                  term="The theta band: the smallest trade this offer will accept. It widens as time passes, and that widening is the decay the maker is paid."
                >
                  Smallest trade
                </Head>
              </Table.Th>
              <Table.Th>
                <Head term="Whether the Coverage instruction re-checks the maker's wallet on every quote, so the depth on offer is backed rather than merely advertised.">
                  Wallet check
                </Head>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
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
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Panel>
  );
}

/**
 * The answer, before the table that justifies it.
 *
 * A judge, or anyone else, should be able to read who is winning this cell without parsing seven
 * columns. Every number here is the same number as the row below it, including which side of the
 * pair the wallet actually has to deliver: a maker offering to sell ETH delivers ETH, one offering
 * to buy it delivers dollars, and printing the wrong one would contradict the table two lines down.
 */
function Answer({
  leg,
  stableSymbol,
  stableDecimals,
  riskySymbol,
  riskyDecimals,
  strikeLabel,
  alone,
}: {
  leg: SurfaceLeg;
  stableSymbol: string;
  stableDecimals: number;
  riskySymbol: string;
  riskyDecimals: number;
  strikeLabel: string;
  alone: boolean;
}) {
  // The expiry flag names the side the maker hands over, which is also what the offer *is*: hand
  // over the risky asset and you are selling it at the strike; hand over dollars and you are buying.
  const sells = (leg.flags & FLAG_POST_EXPIRY_OUT_IS_RISKY) !== 0;
  const deliverable = leg.pricing
    ? sells
      ? leg.pricing.deliverableRisky
      : leg.pricing.deliverableStable
    : sells
      ? leg.reserveRisky
      : leg.reserveStable;

  return (
    <div className="mx-5 mb-4 rounded-field border border-accent-dim bg-accent-soft px-4 py-3">
      <Group gap="sm" wrap="wrap" align="center">
        <Badge variant="filled" color="petrol" size="sm" radius="sm">
          {alone ? 'The only one' : 'Best of them'}
        </Badge>
        <MakerAddress value={leg.maker} />
        {leg.mine ? <StateBadge tone="mine">Yours</StateBadge> : null}
      </Group>
      <Text mt={8} fz="sm" lh={1.5} c="var(--ink)">
        This wallet will {sells ? 'sell' : 'buy'} {riskySymbol} at{' '}
        <strong className="font-mono tnum font-medium">
          {strikeLabel} {stableSymbol}
        </strong>{' '}
        until the date runs out, and is paid for a{' '}
        <strong className="font-mono tnum font-medium">
          {formatUnits(leg.sigmaWad, 16, { maxFractionDigits: 1 })}%
        </strong>{' '}
        move to wait.
        {leg.pricing ? (
          <>
            {' '}
            That is worth{' '}
            <strong className="font-mono tnum font-medium">
              {formatUnits(leg.pricing.premiumWad, 18, { maxFractionDigits: 2 })} {stableSymbol}
            </strong>{' '}
            per {riskySymbol} right now.
          </>
        ) : null}{' '}
        The offer is written across{' '}
        <strong className="font-mono tnum font-medium">
          {formatUnits(leg.liquidityWad, 18, { maxFractionDigits: 2 })} {riskySymbol}
        </strong>
        , and the wallet can deliver{' '}
        <strong className="font-mono tnum font-medium">
          {formatUnits(deliverable, sells ? riskyDecimals : stableDecimals, {
            maxFractionDigits: 2,
          })}{' '}
          {sells ? riskySymbol : stableSymbol}
        </strong>{' '}
        against it right now.
      </Text>
    </div>
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
    <Table.Tr>
      <Table.Td>
        <Group gap="xs" wrap="nowrap">
          <MakerAddress value={leg.maker} />
          {leg.mine ? <StateBadge tone="mine">You</StateBadge> : null}
          {best ? <StateBadge tone="live">Best</StateBadge> : null}
        </Group>
      </Table.Td>

      <Table.Td ta="right">{formatUnits(leg.sigmaWad, 16, { maxFractionDigits: 1 })}%</Table.Td>

      <Table.Td ta="right">
        {pricing ? (
          <Amount value={pricing.premiumWad} decimals={18} symbol={stableSymbol} />
        ) : (
          <Blank why={priced ? 'not priced by the lens' : 'waiting on the lens'} />
        )}
      </Table.Td>

      <Table.Td ta="right">
        <Amount value={leg.liquidityWad} decimals={18} symbol={riskySymbol} />
      </Table.Td>

      <Table.Td ta="right">
        <Amount
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
        />
      </Table.Td>

      <Table.Td ta="right">
        {pricing ? (
          <Amount
            value={deliversRisky ? pricing.minStableIn : pricing.minRiskyIn}
            decimals={inDecimals}
            symbol={inSymbol}
          />
        ) : (
          <Blank why={priced ? 'not priced by the lens' : 'waiting on the lens'} />
        )}
      </Table.Td>

      <Table.Td>
        {leg.guarded ? (
          <StateBadge tone="live" title="Wrapped in the Coverage instruction">
            Checked
          </StateBadge>
        ) : (
          <StateBadge tone="warn" title="No Coverage instruction wraps the curve">
            Not checked
          </StateBadge>
        )}
      </Table.Td>
    </Table.Tr>
  );
}
