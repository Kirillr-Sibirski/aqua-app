'use client';

/**
 * The surface: strike across, expiry up, implied vol as the mark.
 *
 * Drawn as a vol matrix rather than a wireframe. A desk reads a surface as a grid of numbers, and
 * with a handful of live legs a 3D mesh would be interpolation — inventing quotes between the ones
 * that exist. Every chip here is one leg that a maker actually wrote, positioned at its own strike
 * and its own expiry, labelled with the implied vol decoded out of its program bytes.
 *
 * When every leg shares an expiry this collapses to a single row, which is a smile rather than a
 * surface. The caption says so instead of the picture pretending otherwise.
 *
 * The only computed thing on the plot is the vertical rule: the liquidity-weighted mean of the
 * legs' own marks, which is the spot the book implies. Each live leg's reserve point implies a
 * spot through its own curve, and arbitrage is what holds those numbers together, so their spread
 * measures how far the book sits from arbitrage-free. No oracle is read anywhere on this screen.
 */
import { useMemo } from 'react';
import { scaleLinear } from 'd3-scale';
import { Axis } from '@/components/charts/Axis';
import { ChartFrame, PlotArea, type ChartState } from '@/components/charts/ChartFrame';
import { Grid } from '@/components/charts/Grid';
import { Marker } from '@/components/charts/Marker';
import { formatChartNumber } from '@/components/charts/format';
import { padDomain } from '@/components/charts/geometry';
import { round } from '@/components/charts/types';
import { Table } from '@mantine/core';
import { formatUnits } from '@/lib/ui';
import { color, colorMix, FONT_STACK } from '@/lib/ui/tokens';
import { daysToExpiry, impliedSpot } from './decode';
import { Head, META } from './kit';
import type { SurfaceLeg, SurfacePoint } from './types';

export interface SurfaceChartProps {
  points: readonly SurfacePoint[];
  legs: readonly SurfaceLeg[];
  /** The chain's clock. Expiry is measured against the block, not the browser. */
  nowSeconds?: number;
  /** Symbol of the stable side, for the strike axis label. */
  stableSymbol: string;
  state?: ChartState;
  errorMessage?: string;
  height?: number;
}

interface Chip {
  key: string;
  strike: number;
  days: number;
  ivPercent: number;
  legs: number;
  mine: boolean;
  makers: number;
}

const CHIP_W = 46;
const CHIP_H = 20;

export function SurfaceChart({
  points,
  legs,
  nowSeconds,
  stableSymbol,
  state = 'ready',
  errorMessage,
  height = 300,
}: SurfaceChartProps) {
  const chips = useMemo<Chip[]>(() => {
    if (nowSeconds === undefined) return [];
    return points
      .filter((p) => p.liveLegs.length > 0)
      .map((p) => ({
        key: p.key,
        strike: Number(p.strikeWad) / 1e18,
        days: daysToExpiry(p.maturity, nowSeconds),
        ivPercent: (Number(p.maxSigmaWad) / 1e18) * 100,
        legs: p.liveLegs.length,
        mine: p.mine,
        makers: new Set(p.liveLegs.map((l) => l.maker.toLowerCase())).size,
      }));
  }, [points, nowSeconds]);

  const spot = useMemo(() => impliedSpot(legs), [legs]);
  const expiries = useMemo(() => Array.from(new Set(chips.map((c) => c.days))).sort((a, b) => a - b), [chips]);

  const resolvedState: ChartState = state !== 'ready' ? state : chips.length === 0 ? 'empty' : 'ready';

  return (
    <ChartFrame
      title="What is being offered, and when"
      description={`Every price and date somebody is quoting, decoded from the published bytes of ${chips.length} live offer${chips.length === 1 ? '' : 's'} on this router. Horizontal axis is the price they would sell at in ${stableSymbol}; vertical axis is days until the offer runs out; each chip is labelled with the movement that maker priced in.`}
      subtitle={
        expiries.length === 1
          ? `One chip per price somebody will sell at, placed at the date it runs to, labelled with the movement they are being paid for. Only one date is on offer so far, so this is a single row. A trader would call the whole picture a volatility surface.`
          : `One chip per price somebody will sell at, placed at the date it runs to, labelled with the movement they are being paid for: ${expiries.length} dates, ${chips.length} live points. A trader would call this a volatility surface.`
      }
      height={height}
      margin={{ top: 20, right: 34, bottom: 34, left: 62 }}
      state={resolvedState}
      emptyMessage="Nobody is offering anything on this router yet. This is built from the chain's own log, so it fills in the moment the first offer lands."
      errorMessage={errorMessage}
      legend={<Legend />}
      footnote="The movement priced in is something each seller chose and published, read straight out of their offer rather than solved for. Offers that were taken down are not drawn; they are listed in the table below."
      table={<ChipTable chips={chips} stableSymbol={stableSymbol} />}
      tableLabel="the points"
    >
      {(geometry) => {
        const strikes = chips.map((c) => c.strike);
        const xDomain = padDomain(
          strikes.length ? [Math.min(...strikes), Math.max(...strikes)] : [0, 1],
          0.14,
        );
        const yDomain = padDomain(expiries.length ? [Math.min(...expiries), Math.max(...expiries)] : [0, 1], 0.5);

        const x = scaleLinear().domain(xDomain).range([geometry.inner.x, geometry.inner.x + geometry.inner.width]);
        const y = scaleLinear()
          .domain(yDomain)
          .range([geometry.inner.y + geometry.inner.height, geometry.inner.y]);

        return (
          <>
            <Grid geometry={geometry} yScale={y} xScale={x} lines="both" yCount={3} xCount={5} />
            <Axis
              geometry={geometry}
              scale={x}
              orientation="bottom"
              count={5}
              label={`strike (${stableSymbol})`}
            />
            <Axis geometry={geometry} scale={y} orientation="left" count={3} label="days" />

            <PlotArea geometry={geometry}>
              {/* One rib per expiry: the smile at that tenor. Two points make a line worth drawing. */}
              {expiries.map((days) => {
                const row = chips.filter((c) => c.days === days).sort((a, b) => a.strike - b.strike);
                if (row.length < 2) return null;
                const d = row.map((c, i) => `${i === 0 ? 'M' : 'L'}${round(x(c.strike))},${round(y(c.days))}`).join('');
                return (
                  <path
                    key={`rib-${days}`}
                    d={d}
                    fill="none"
                    stroke={color('line-strong')}
                    strokeWidth={1}
                    strokeLinecap="round"
                  />
                );
              })}

              {spot ? (
                <Marker
                  geometry={geometry}
                  scale={x}
                  value={Number(spot.markWad) / 1e18}
                  stroke="accent"
                  labelColor="ink"
                  label={`book ${formatChartNumber(Number(spot.markWad) / 1e18, { maxFractionDigits: 0 })}`}
                  labelSide="start"
                />
              ) : null}

              {chips.map((chip) => (
                <ChipMark key={chip.key} chip={chip} cx={x(chip.strike)} cy={y(chip.days)} />
              ))}
            </PlotArea>
          </>
        );
      }}
    </ChartFrame>
  );
}

/**
 * One quote.
 *
 * Ours wears the accent and a filled dot; everyone else's is a plain surface chip. Colour is not
 * the only signal — the dot is a second one, and the table below names the maker.
 */
function ChipMark({ chip, cx, cy }: { chip: Chip; cx: number; cy: number }) {
  const x = round(cx - CHIP_W / 2);
  const y = round(cy - CHIP_H / 2);
  return (
    <g>
      <title>
        {`${chip.ivPercent.toFixed(1)}% implied vol at strike ${chip.strike}, ${chip.days.toFixed(1)} days out, from ${chip.makers} maker${chip.makers === 1 ? '' : 's'}${chip.mine ? ', including yours' : ''}`}
      </title>
      <rect
        x={x}
        y={y}
        width={CHIP_W}
        height={CHIP_H}
        rx={4}
        fill={chip.mine ? colorMix('accent', 20) : color('surface-2')}
        stroke={chip.mine ? color('accent') : color('line-strong')}
        strokeWidth={1}
      />
      {chip.mine ? <circle cx={round(x + 6)} cy={round(cy)} r={2.5} fill={color('accent')} /> : null}
      <text
        x={round(cx + (chip.mine ? 4 : 0))}
        y={round(cy)}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily={FONT_STACK.mono}
        fontSize={11}
        fill={chip.mine ? color('ink') : color('ink-2')}
        style={{ fontVariantNumeric: 'tabular-nums slashed-zero' }}
      >
        {chip.ivPercent.toFixed(0)}%
      </text>
      {chip.legs > 1 ? (
        <text
          x={round(x + CHIP_W + 4)}
          y={round(y + 4)}
          fontFamily={FONT_STACK.mono}
          fontSize={10}
          fill={color('ink-3')}
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {`x${chip.legs}`}
        </text>
      ) : null}
    </g>
  );
}

function Legend() {
  return (
    <span className="flex items-center gap-4 text-mini text-ink-2">
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="inline-block h-3 w-5 rounded-control border border-accent"
          style={{ background: colorMix('accent', 20) }}
        />
        Yours
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="inline-block h-3 w-5 rounded-control border border-line-strong bg-surface-2" />
        Other makers
      </span>
    </span>
  );
}

/** The chart's accessible twin: the same points, as numbers, without a pointer. */
function ChipTable({ chips, stableSymbol }: { chips: readonly Chip[]; stableSymbol: string }) {
  return (
    <Table.ScrollContainer minWidth={544} type="native">
      <Table verticalSpacing="xs" horizontalSpacing="md" tabularNums fz={META}>
        <Table.Caption className="sr-only">Points on the surface</Table.Caption>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>
              <Head numeric term="The strike, K: the price these wallets said they would sell at.">
                Sells at ({stableSymbol})
              </Head>
            </Table.Th>
            <Table.Th>
              <Head numeric>Days</Head>
            </Table.Th>
            <Table.Th>
              <Head numeric term="Implied volatility: how big a move these sellers are being paid for.">
                Movement
              </Head>
            </Table.Th>
            <Table.Th>
              <Head numeric>Offers</Head>
            </Table.Th>
            <Table.Th>
              <Head>Yours</Head>
            </Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {chips.map((chip) => (
            <Table.Tr key={chip.key}>
              <Table.Td ta="right">{formatUnits(BigInt(Math.round(chip.strike)), 0)}</Table.Td>
              <Table.Td ta="right">{chip.days.toFixed(2)}</Table.Td>
              <Table.Td ta="right">{chip.ivPercent.toFixed(1)}%</Table.Td>
              <Table.Td ta="right">{chip.legs}</Table.Td>
              <Table.Td>{chip.mine ? 'Yes' : 'No'}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
