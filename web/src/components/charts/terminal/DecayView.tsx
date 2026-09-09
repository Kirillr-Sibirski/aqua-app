'use client';

/**
 * DECAY — the band widening as expiry approaches.
 *
 * A leg's reserves sit exactly on its curve the moment it is published. Time then moves the curve
 * away from them, in both directions at once, and a trade only clears once it is big enough to
 * close that distance. So the distance IS the premium: whoever crosses it hands it to the maker,
 * and nothing was signed to open it. This view is that distance, read from `bandFor` at one
 * synthetic maturity per point — "the same leg, with that much less time left".
 *
 * WHY THIS CHART HAS ITS OWN AXES, and why that is not a stylistic choice. On the curve view's
 * y-domain of zero to `K*L`, the band on a freshly published leg is a few ten-thousandths of one
 * pixel: a previous version of this shaded it there and drew a path with a zero-by-zero bounding
 * box while the legend advertised the wedge. The honest fix is not a thicker stroke. It is axes
 * that start at nothing and measure outward in the units a taker would actually bring — which is
 * what makes the growth from a hundredth of a cent to three figures visible as a shape.
 *
 * TWO UNITS, TWO AXES. A taker can close the gap from either side, and the two sides are counted in
 * different tokens, so they get different scales: the stable side on the left, the risky side on
 * the right. Putting both on one axis would be a chart whose y value means two things.
 */
import { useState, type ReactNode } from 'react';
import { scaleLinear } from 'd3-scale';
import type { Address } from 'viem';
import type { SupportedChainId } from '@/lib/chain';
import { color } from '@/lib/ui/tokens';
import { Axis } from '../Axis';
import { AreaFill } from '../AreaFill';
import { CurveLine } from '../CurveLine';
import { Grid } from '../Grid';
import { formatChartNumber } from '../format';
import type { ChartGeometry, ChartPoint } from '../types';
import { Crosshair } from './Crosshair';
import { Strip, type LegendItem, type ReadoutItem } from './chrome';
import { terminalError } from './errors';
import { Plot, PlotArea } from './Plot';
import { useDecayBand, type DecayPoint } from './useDecayBand';
import type { TerminalLeg, TerminalState, TerminalToken } from './types';

export interface DecayViewProps {
  control: ReactNode;
  panelId: string;
  tabId: string;
  router?: Address;
  chainId?: SupportedChainId;
  leg?: TerminalLeg;
  risky: TerminalToken;
  stable: TerminalToken;
  nowSeconds?: number;
  state: TerminalState;
  errorMessage?: string;
}

/** The right margin carries a second axis, so it is as wide as the left one. */
const MARGIN = { top: 24, right: 58, bottom: 24, left: 58 };

/** Points across the remaining life. Each is one `eth_call` inside one multicall. */
const BAND_SAMPLES = 25;

export function DecayView({
  control,
  panelId,
  tabId,
  router,
  chainId,
  leg,
  risky,
  stable,
  nowSeconds,
  state,
  errorMessage,
}: DecayViewProps) {
  const [index, setIndex] = useState<number | null>(null);

  const band = useDecayBand({
    router,
    chainId,
    strikeWad: leg?.strikeWad,
    sigmaWad: leg?.sigmaWad,
    liquidityWad: leg?.liquidityWad,
    maturity: leg?.maturity,
    xWad: leg?.xWad,
    yWad: leg?.yWad,
    nowSeconds,
    samples: BAND_SAMPLES,
    enabled: !!leg && state === 'ready',
  });

  const points = band.points;

  let resolved: TerminalState = state;
  if (state === 'ready') {
    if (!leg) resolved = 'empty';
    else if (band.error) resolved = 'error';
    else if (points.length >= 2) resolved = 'ready';
    else if (band.isLoading) resolved = 'loading';
    else resolved = 'empty';
  }

  /** With no cursor the readout stands at expiry — the end of the wait, and the largest figure. */
  const shown: DecayPoint | null =
    points.length === 0 ? null : (index === null ? points[points.length - 1] : points[Math.min(index, points.length - 1)]);

  const readout: ReadoutItem[] = shown
    ? [
        { label: 'after', value: `${formatChartNumber(shown.days, { significantDigits: 3 })} d` },
        {
          label: stable.symbol,
          icon: stable.icon,
          // Significant digits, not a fixed two: one series sweeps four orders of magnitude
          // between the first minute and the tau floor, and `+0.01` at the near end is not a
          // reading of anything.
          value: formatChartNumber(shown.stable, {
            significantDigits: 4,
            maxFractionDigits: 4,
            sign: 'always',
          }),
          tone: 'accent',
        },
        {
          label: risky.symbol,
          icon: risky.icon,
          value: formatChartNumber(shown.risky, {
            significantDigits: 4,
            maxFractionDigits: 6,
            sign: 'always',
          }),
          tone: 'ink-2',
        },
      ]
    : [];

  const legend: LegendItem[] = [
    { id: stable.symbol, label: <LegendToken token={stable} />, color: 'accent', kind: 'area' },
    { id: risky.symbol, label: <LegendToken token={risky} />, color: 'ink-2', dash: 'dashed' },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <Strip control={control} legend={legend} readout={readout} />
      <Plot
        title="Decay"
        description={`The smallest trade that clears this leg, against how long nobody has taken it. The left axis counts ${stable.symbol} a buyer must bring; the right counts ${risky.symbol} a seller must bring. Every point is a bandFor read on a leg with the same reserves and that much less time left. The reserves are held fixed: a trade in between resets the gap to nothing.`}
        margin={MARGIN}
        panelId={panelId}
        panelLabelledBy={tabId}
        state={resolved}
        emptyMessage="no time left"
        errorMessage={errorMessage ?? terminalError(band.error)}
        cursor={{
          positions: (geometry: ChartGeometry) => {
            const x = daysScale(geometry, points);
            return points.map((p) => x(p.days));
          },
          index,
          onIndex: setIndex,
          label: 'days of waiting',
          valueText: readout.map((item) => `${item.label} ${item.value}`).join(', '),
        }}
      >
        {(geometry) => {
          if (points.length < 2) return null;

          const compact = geometry.inner.width < 460;
          const x = daysScale(geometry, points);
          const stableMax = Math.max(...points.map((p) => p.stable));
          const riskyMax = Math.max(...points.map((p) => p.risky));

          const yStable = scaleLinear()
            .domain([0, (stableMax || 1) * 1.08])
            .range([geometry.inner.y + geometry.inner.height, geometry.inner.y]);
          const yRisky = scaleLinear()
            .domain([0, (riskyMax || 1) * 1.08])
            .range([geometry.inner.y + geometry.inner.height, geometry.inner.y]);

          const stablePoints: ChartPoint[] = points.map((p) => ({ x: p.days, y: p.stable }));
          const riskyPoints: ChartPoint[] = points.map((p) => ({ x: p.days, y: p.risky }));

          return (
            <>
              <Grid geometry={geometry} yScale={yStable} yCount={4} />
              <PlotArea geometry={geometry}>
                <AreaFill
                  points={stablePoints}
                  xScale={x}
                  yScale={yStable}
                  baseline={0}
                  fill="accent"
                  tint={12}
                />
                <CurveLine
                  points={riskyPoints}
                  xScale={x}
                  yScale={yRisky}
                  stroke="ink-2"
                  strokeWidth={1.5}
                  dash="dashed"
                  endDot
                />
                <CurveLine
                  points={stablePoints}
                  xScale={x}
                  yScale={yStable}
                  stroke="accent"
                  strokeWidth={2}
                  endDot
                />
              </PlotArea>
              <Axis
                geometry={geometry}
                scale={x}
                orientation="bottom"
                count={compact ? 3 : 5}
                format={(value) => `${formatChartNumber(Number(value), { significantDigits: 3 })}d`}
              />
              <Axis
                geometry={geometry}
                scale={yStable}
                orientation="left"
                count={4}
                label={stable.symbol}
              />
              <Axis
                geometry={geometry}
                scale={yRisky}
                orientation="right"
                count={4}
                textColor="ink-3"
              />
              {/* The right axis belongs to the dashed series, and says so by wearing its colour. */}
              <text
                x={geometry.inner.x + geometry.inner.width}
                y={geometry.inner.y - 10}
                textAnchor="end"
                fontSize={12}
                fill={color('ink-3')}
              >
                {risky.symbol}
              </text>
              {index !== null && shown ? (
                <Crosshair
                  geometry={geometry}
                  x={x(shown.days)}
                  dots={[
                    { id: 'risky', y: yRisky(shown.risky), color: 'ink-2' },
                    { id: 'stable', y: yStable(shown.stable), color: 'accent' },
                  ]}
                  label={`${formatChartNumber(shown.days, { significantDigits: 3 })}d`}
                />
              ) : null}
            </>
          );
        }}
      </Plot>
    </div>
  );
}

/** A ticker with its own mark, when the page supplied one. */
function LegendToken({ token }: { token: TerminalToken }) {
  return (
    <span className="flex items-center gap-1">
      {token.icon ? (
        <span aria-hidden="true" className="flex shrink-0 items-center">
          {token.icon}
        </span>
      ) : null}
      {token.symbol}
    </span>
  );
}

/** Days of waiting, zero to the tau floor. */
function daysScale(geometry: ChartGeometry, points: readonly DecayPoint[]) {
  const end = points.length ? points[points.length - 1].days : 1;
  return scaleLinear()
    .domain([0, end || 1])
    .range([geometry.inner.x, geometry.inner.x + geometry.inner.width]);
}
