'use client';

/**
 * The two pictures that explain the first one.
 *
 * `TapeChart` is the price the week was replayed against, with the nearest strike drawn as a rule. On
 * this particular week the price never reached it, which is most of why the book kept its ETH, and a
 * reader who cannot see that is left to take the headline on trust.
 *
 * `InventoryChart` is how much ETH the wallet actually held, hour by hour, against the 10.4 it started
 * with. That line IS the hedge: it steps down when a taker bought ETH off the book and back up when one
 * sold ETH into it, and its flat stretches are the hours when nobody crossed the spread. Everything the
 * page says about premium being conditional on flow is visible in the flat parts.
 */
import { useMemo } from 'react';
import { scaleLinear } from 'd3-scale';
import { Axis } from '@/components/charts/Axis';
import { ChartFrame, PlotArea } from '@/components/charts/ChartFrame';
import { CurveLine } from '@/components/charts/CurveLine';
import { Grid } from '@/components/charts/Grid';
import { Marker } from '@/components/charts/Marker';
import { formatChartNumber } from '@/components/charts/format';
import { finiteExtent, padDomain } from '@/components/charts/geometry';
import type { ChartPoint } from '@/components/charts/types';
import { daysFrom, eth, lowestSellStrike6, toDollars, usd, type Replay } from './replay';

const MARGIN = { top: 14, right: 18, bottom: 34, left: 62 };

export interface TapeChartProps {
  replay: Replay;
  height?: number;
}

export function TapeChart({ replay, height = 220 }: TapeChartProps) {
  const s = replay.series;
  const days = useMemo(() => daysFrom(s), [s]);
  const points = useMemo(
    () => s.spot6.map<ChartPoint>((micro, i) => ({ x: days[i], y: toDollars(micro) })),
    [days, s.spot6],
  );

  // The lowest price the book offered to SELL at. Including it in the domain is the point: a reader has
  // to be able to see how far the price stayed from the price the maker said they would sell at.
  const nearestStrike = toDollars(lowestSellStrike6(replay.legs));
  const extent = finiteExtent(points) ?? [0, 1];
  const yDomain = padDomain([Math.min(extent[0], nearestStrike), Math.max(extent[1], nearestStrike)], 0.08);
  const lastDay = days[days.length - 1] ?? 0;
  const high = Math.max(...points.map((p) => p.y));

  return (
    <ChartFrame
      title="The price it was replayed against"
      description={`Chainlink ETH/USD as published on Base over ${lastDay.toFixed(1)} days, from ${formatChartNumber(points[0]?.y ?? 0)} to ${formatChartNumber(points[points.length - 1]?.y ?? 0)} US dollars, with a peak of ${formatChartNumber(high)}. A dashed rule marks ${formatChartNumber(nearestStrike)}, the lowest price the book offered to sell at.`}
      subtitle="Real published rounds. Nothing here is modelled."
      height={height}
      margin={MARGIN}
      footnote={
        <>
          Feed <span className="font-mono">{replay.tape.feed}</span> on chain{' '}
          <span className="font-mono tnum">{replay.tape.chainId}</span>, read at block{' '}
          <span className="font-mono tnum">{replay.tape.readAtBlock.toLocaleString('en-US')}</span>. The
          book offered to sell at {usd(lowestSellStrike6(replay.legs))} and above; the price got to{' '}
          {usd(replay.totals.peakSpot6)}, so nothing was ever sold at a strike.
        </>
      }
    >
      {(geometry) => {
        const x = scaleLinear()
          .domain([0, lastDay || 1])
          .range([geometry.inner.x, geometry.inner.x + geometry.inner.width]);
        const y = scaleLinear()
          .domain([yDomain[0], yDomain[1]])
          .range([geometry.inner.y + geometry.inner.height, geometry.inner.y]);

        return (
          <>
            <Grid geometry={geometry} yScale={y} xScale={x} lines="y" />
            <PlotArea geometry={geometry}>
              <CurveLine points={points} xScale={x} yScale={y} stroke="ink-2" strokeWidth={1.5} />
            </PlotArea>
            <Marker
              geometry={geometry}
              scale={y}
              orientation="y"
              value={nearestStrike}
              stroke="accent-dim"
              label={`your price ${formatChartNumber(nearestStrike)}`}
              labelSide="start"
            />
            <Axis
              geometry={geometry}
              scale={x}
              orientation="bottom"
              count={7}
              format={(value) => `${formatChartNumber(Number(value), { significantDigits: 2 })}d`}
            />
            <Axis
              geometry={geometry}
              scale={y}
              orientation="left"
              count={4}
              format={(value) => formatChartNumber(Number(value), { significantDigits: 4 })}
              label="USD"
            />
          </>
        );
      }}
    </ChartFrame>
  );
}

export function InventoryChart({ replay, height = 220 }: TapeChartProps) {
  const s = replay.series;
  const days = useMemo(() => daysFrom(s), [s]);
  const points = useMemo(
    () => s.weth6.map<ChartPoint>((micro, i) => ({ x: days[i], y: micro / 1e6 })),
    [days, s.weth6],
  );

  const started = replay.walletWeth6 / 1e6;
  const extent = finiteExtent(points) ?? [0, 1];
  const yDomain = padDomain([Math.min(extent[0], started), Math.max(extent[1], started)], 0.15);
  const lastDay = days[days.length - 1] ?? 0;
  const ended = points[points.length - 1]?.y ?? started;

  return (
    <ChartFrame
      title="What the wallet was holding"
      description={`ETH in the maker's wallet over the same ${lastDay.toFixed(1)} days, starting at ${formatChartNumber(started)} and ending at ${formatChartNumber(ended)}. The line steps down when a taker bought ETH from the book and up when one sold ETH into it; the flat stretches are the hours when nobody crossed the spread.`}
      subtitle="Simulated fills against the real curve."
      height={height}
      margin={MARGIN}
      footnote={
        <>
          {replay.totals.fills} fills over the week, out of {replay.totals.attempts.toLocaleString('en-US')}{' '}
          chances to trade. The flat stretches are the risk this project discloses first: the money is in
          the spread, and it is only paid when somebody chooses to cross it.
        </>
      }
    >
      {(geometry) => {
        const x = scaleLinear()
          .domain([0, lastDay || 1])
          .range([geometry.inner.x, geometry.inner.x + geometry.inner.width]);
        const y = scaleLinear()
          .domain([yDomain[0], yDomain[1]])
          .range([geometry.inner.y + geometry.inner.height, geometry.inner.y]);

        return (
          <>
            <Grid geometry={geometry} yScale={y} xScale={x} lines="y" />
            <PlotArea geometry={geometry}>
              <CurveLine points={points} xScale={x} yScale={y} stroke="accent" strokeWidth={2} endDot />
            </PlotArea>
            <Marker
              geometry={geometry}
              scale={y}
              orientation="y"
              value={started}
              stroke="ink-3"
              label={`started with ${eth(replay.walletWeth6, 2)}`}
              labelSide="end"
            />
            <Axis
              geometry={geometry}
              scale={x}
              orientation="bottom"
              count={7}
              format={(value) => `${formatChartNumber(Number(value), { significantDigits: 2 })}d`}
            />
            <Axis
              geometry={geometry}
              scale={y}
              orientation="left"
              count={4}
              format={(value) => formatChartNumber(Number(value), { significantDigits: 4 })}
              label="WETH"
            />
          </>
        );
      }}
    </ChartFrame>
  );
}
