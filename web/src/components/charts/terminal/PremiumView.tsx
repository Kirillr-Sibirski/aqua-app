'use client';

/**
 * PREMIUM — what a taker has to pay you, growing every day nobody takes it.
 *
 * A leg's reserves sit exactly on its curve the moment it is published. Time then moves the curve
 * away from them, in both directions at once, and a trade only clears once it is big enough to
 * close that distance. So the distance IS the premium: whoever crosses it hands it to the maker,
 * and nothing was signed to open it. This view is that distance, read from `bandFor` at one
 * synthetic maturity per point — "the same leg, with that much less time left".
 *
 * The tab used to read `decay`, which is the mechanism and not the subject. `bandFor` measures a
 * band; what the band IS, to the person writing the offer, is income. The note behind the ⓘ leads
 * with `time decay` for a reader who wants the term.
 *
 * WHY THIS CHART HAS ITS OWN AXES, and why that is not a stylistic choice. On the price view's
 * y-domain of zero to `K*L`, the band on a freshly published leg is a few ten-thousandths of one
 * pixel: a previous version of this shaded it there and drew a path with a zero-by-zero bounding
 * box while the legend advertised the wedge. The honest fix is not a thicker stroke. It is axes
 * that start at nothing and measure outward in the units a taker would actually bring — which is
 * what makes the growth from a hundredth of a cent to three figures visible as a shape.
 *
 * TWO UNITS, TWO AXES, AND WHY THE TWO LINES OVERLAP. A taker can close the gap from either side,
 * and the two sides are counted in different tokens, so they get different scales: the stable side
 * on the left, the risky side on the right. Putting both on one axis would be a chart whose y value
 * means two things. Each series is then normalised to its own maximum, so the two lines trace
 * nearly the same path — which is not a rendering fault but the fact itself: they are ONE gap,
 * quoted in two currencies. That was unreadable while the axes said `USDC` and `WETH`; it is
 * legible now that they say who brings which, in that series' own colour and dash. The axis is the
 * legend, which is also what let the strip above give its row back to the readout.
 */
import { useState } from 'react';
import { scaleLinear } from 'd3-scale';
import type { Address } from 'viem';
import type { SupportedChainId } from '@/lib/chain';
import { formatTenor } from '@/lib/ui/format';
import { Axis } from '../Axis';
import { AreaFill } from '../AreaFill';
import { CurveLine } from '../CurveLine';
import { Grid } from '../Grid';
import { formatChartNumber, formatChartToken } from '../format';
import type { ChartGeometry, ChartPoint } from '../types';
import { tokenFractionDigits } from '@/components/token';
import classes from './chart.module.css';
import { Crosshair } from './Crosshair';
import { Readout, type ReadoutItem } from './chrome';
import { terminalError } from './errors';
import { AxisBand, AxisName, Wipe } from './Marks';
import { Plot, PlotArea } from './Plot';
import { useDecayBand, type DecayPoint } from './useDecayBand';
import type { TerminalLeg, TerminalState, TerminalToken } from './types';

export interface PremiumViewProps {
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
  refusedMessage?: string;
}

/**
 * The right margin carries a second axis, so it is as wide as the left one. The bottom carries the
 * axis band — `today`, `days waited`, `expiry` — on a line below the ticks.
 */
const MARGIN = { top: 26, right: 58, bottom: 42, left: 58 };

/** Points across the remaining life. Each is one `eth_call` inside one multicall. */
const BAND_SAMPLES = 25;

/** Below this the axis names lose their verb and keep the noun; the plot is too narrow for both. */
const COMPACT_WIDTH = 460;

export function PremiumView({
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
  refusedMessage,
}: PremiumViewProps) {
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
    points.length === 0
      ? null
      : index === null
        ? points[points.length - 1]
        : points[Math.min(index, points.length - 1)];

  /*
   * The readout is TERSE, and that is a correction rather than a preference.
   *
   * It used to spell `a buyer brings, USDC` — the statement the axis now carries — and the two rows
   * ended up forty pixels apart, the readout above the axis name, saying the same six words twice.
   * At 390px they were two of the four chrome rows stacked over a 280px plot. One fact gets one
   * container: the axis name is the permanent legend, in the series' own colour and dash, and this
   * row is the cursor, so it prints the token and the figure and nothing else. The tone and the
   * token's own mark are what tie an entry to its axis, which is what a legend swatch does anyway.
   */
  const readout: ReadoutItem[] =
    shown && resolved === 'ready'
      ? [
          // One tenor format in the app: `8d` here is the `8d` the ticket's expiry legend prints and
          // the `8d` in the positions row, from `formatTenor`. It used to read `after 8.69 d`.
          { label: 'waited', value: formatTenor(shown.days * 86_400) },
          {
            label: stable.symbol,
            icon: stable.icon,
            // The token's own two places, and `<0.01` rather than `0.00` where the band is still
            // thinner than a cent. The series sweeps four orders of magnitude and that shape is the
            // chart's job; the readout is a figure, and this app prints a USDC figure one way.
            value: formatChartToken(shown.stable, tokenFractionDigits(stable.symbol), {
              sign: 'always',
            }),
            tone: 'accent',
          },
          {
            label: risky.symbol,
            icon: risky.icon,
            value: formatChartToken(shown.risky, tokenFractionDigits(risky.symbol), {
              sign: 'always',
            }),
            tone: 'ink-2',
          },
        ]
      : [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <Readout items={readout} />
      <Plot
        title="Premium"
        description={`The smallest trade that clears this leg, against how long nobody has taken it. The left axis counts the ${stable.symbol} a buyer must bring; the right counts the ${risky.symbol} a seller must bring. Every point is a bandFor read on a leg with the same reserves and that much less time left. The reserves are held fixed: a trade in between resets the gap to nothing.`}
        margin={MARGIN}
        panelId={panelId}
        panelLabelledBy={tabId}
        state={resolved}
        refusedMessage={refusedMessage}
        emptyMessage="no time left"
        errorMessage={errorMessage ?? terminalError(band.error)}
        cursor={{
          positions: (geometry: ChartGeometry) => {
            const x = daysScale(geometry, points);
            return points.map((p) => x(p.days));
          },
          index,
          onIndex: setIndex,
          label: 'days waited',
          valueText: readout.map((item) => `${item.label} ${item.value}`).join(', '),
        }}
      >
        {(geometry) => {
          if (points.length < 2) return null;

          const compact = geometry.inner.width < COMPACT_WIDTH;
          const x = daysScale(geometry, points);
          const stableMax = Math.max(...points.map((p) => p.stable));
          const riskyMax = Math.max(...points.map((p) => p.risky));

          const yStable = scaleLinear()
            .domain([0, (stableMax || 1) * 1.08])
            .range([geometry.inner.y + geometry.inner.height, geometry.inner.y]);
          const yRisky = scaleLinear()
            .domain([0, (riskyMax || 1) * 1.08])
            .range([geometry.inner.y + geometry.inner.height, geometry.inner.y]);

          const stablePoints: ChartPoint[] = points.map((p) => ({
            x: p.days,
            y: p.stable,
          }));
          const riskyPoints: ChartPoint[] = points.map((p) => ({
            x: p.days,
            y: p.risky,
          }));

          return (
            <>
              <Grid geometry={geometry} yScale={yStable} yCount={4} />
              <PlotArea geometry={geometry}>
                <Wipe geometry={geometry}>
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
                </Wipe>
              </PlotArea>
              <Axis
                geometry={geometry}
                scale={x}
                orientation="bottom"
                count={compact ? 3 : 5}
                format={(value) => `${formatChartNumber(Number(value), { significantDigits: 3 })}d`}
              />
              {/* The two ends of the wait, named where the axis ends rather than inside the plot.
                  `0d` and `8d` are the ticks; `today` and `expiry` are what they mean, and they are
                  why the curve starts at nothing. */}
              <AxisBand geometry={geometry} start="today" end="expiry">
                days waited
              </AxisBand>
              <Axis geometry={geometry} scale={yStable} orientation="left" count={4} />
              <Axis
                geometry={geometry}
                scale={yRisky}
                orientation="right"
                count={4}
                textColor="ink-3"
              />
              {/*
                * Each axis names the series that lives on it, in that series' colour and dash.
                *
                * `USDC` and `WETH` over two columns of numbers said what unit and not what quantity,
                * on a chart where the quantity is the entire point and where two lines sit on top of
                * each other because they are one gap in two currencies. This is the legend, standing
                * on the scale it belongs to.
                */}
              <AxisName geometry={geometry} side="left" swatch="accent" className={classes.fade}>
                {compact ? `buyer · ${stable.symbol}` : `a buyer brings · ${stable.symbol}`}
              </AxisName>
              <AxisName
                geometry={geometry}
                side="right"
                swatch="ink-2"
                dash="dashed"
                className={classes.fade}
              >
                {compact ? `seller · ${risky.symbol}` : `a seller brings · ${risky.symbol}`}
              </AxisName>
              {index !== null && shown ? (
                <Crosshair
                  geometry={geometry}
                  x={x(shown.days)}
                  dots={[
                    { id: 'risky', y: yRisky(shown.risky), color: 'ink-2' },
                    { id: 'stable', y: yStable(shown.stable), color: 'accent' },
                  ]}
                  label={formatTenor(shown.days * 86_400)}
                />
              ) : null}
            </>
          );
        }}
      </Plot>
    </div>
  );
}

/** Days of waiting, zero to the tau floor. */
function daysScale(geometry: ChartGeometry, points: readonly DecayPoint[]) {
  const end = points.length ? points[points.length - 1].days : 1;
  return scaleLinear()
    .domain([0, end || 1])
    .range([geometry.inner.x, geometry.inner.x + geometry.inner.width]);
}
