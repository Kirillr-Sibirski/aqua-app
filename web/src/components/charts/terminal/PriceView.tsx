'use client';

/**
 * PRICE — the schedule this offer trades on, and where it stands on it right now.
 *
 * `y(x)` across the whole reserve domain, one `stableFor` per point inside one multicall, plus the
 * reserve point the leg is sitting on and the `tau = 0` constant-sum line ghosted behind. Read left
 * to right the x axis is the risky the offer has NOT sold yet and the y axis is the stable it is
 * holding, so the curve is a schedule — at every amount sold, what you are holding — and the slope
 * between two points on it is the price a taker gets. That is why the tab says `price`. It used to
 * say `curve`, which names the mark rather than the subject: every view here is a curve.
 *
 * THE GAP BETWEEN THE TWO LINES GETS ITS OWN AXIS, and this is the difference between a chart and a
 * decoration. On an eight-day leg at twenty percent the gap is about sixty USDC on a reserve of
 * twenty-seven thousand — two parts in a thousand, which on a six-hundred-pixel axis is a tenth of
 * a pixel. Shading it between the curves drew a legend entry for a region nobody could see, and the
 * view came out as one straight line with a dashed line hiding under it. The two curves keep the
 * left axis, because their near-coincidence is itself the fact: an RMM leg is a constant-sum line
 * plus a little. The premium is drawn as a filled hump against a right axis of its own, at the
 * scale it actually lives at, which is the same two-axis device the premium view uses for the same
 * reason — and which only works once each axis says, in the reader's words and in its series'
 * colour, what it is counting.
 *
 * Nothing here is interpolated except the straight segments the renderer draws between two measured
 * points. There is no `Phi` in TypeScript, and the reason is not tidiness: a wei-exact port of the
 * router's approximated Gaussian is the single most likely way to put a curve on screen that
 * disagrees with the one a fill will be priced against.
 *
 * The settlement line is asked for at two points rather than forty-eight, because at `tau = 0` the
 * trading function is `Y = K*(L - X)` — a straight line — and two chain reads pin a straight line
 * exactly. It is also the one query in the chart that never has to be repeated: no `tau` appears in
 * that branch, so the answer is the same at every block.
 */
import { useState } from 'react';
import { scaleLinear } from 'd3-scale';
import type { Address } from 'viem';
import { MATURED_MATURITY, useCurveSamples } from '@/hooks/useCurveSamples';
import type { SupportedChainId } from '@/lib/chain';
import { AreaFill } from '../AreaFill';
import { Axis } from '../Axis';
import { CurveLine } from '../CurveLine';
import { Grid } from '../Grid';
import { tokenFractionDigits } from '@/components/token';
import { formatChartToken } from '../format';
import { type ChartGeometry, type ChartPoint } from '../types';
import classes from './chart.module.css';
import { Crosshair } from './Crosshair';
import { Readout, type ReadoutItem } from './chrome';
import { terminalError } from './errors';
import { AxisBand, AxisName, DirectionArrow, LivePoint, SeriesLabel, Wipe } from './Marks';
import { wadToNumber } from './payoff';
import { Plot, PlotArea } from './Plot';
import type { TerminalLeg, TerminalState, TerminalToken } from './types';

export interface PriceViewProps {
  panelId: string;
  tabId: string;
  router?: Address;
  chainId?: SupportedChainId;
  leg?: TerminalLeg;
  risky: TerminalToken;
  stable: TerminalToken;
  state: TerminalState;
  errorMessage?: string;
  refusedMessage?: string;
}

/** The right margin carries the premium axis, so it is as wide as the left one. */
const MARGIN = { top: 26, right: 62, bottom: 42, left: 62 };

/** Points across `x in [0, L]`. Each is one `eth_call` running a 40-step bisection of `Phi`. */
const CURVE_SAMPLES = 48;

/** Below this the axis names drop their verb; the plot is too narrow to carry both in full. */
const COMPACT_WIDTH = 460;

/**
 * How far the direction arrow reaches back along the curve from the reserve point, in px.
 *
 * Long enough at desk width that its head clears the label beside the dot — the label paints last
 * and carries a background halo, so a head inside its span would simply be erased — and short
 * enough on a phone that it does not become a third series across a 250px plot. The label shortens
 * to one word below the same threshold for the same reason.
 */
const ARROW_SPAN = { wide: 100, compact: 46 };

export function PriceView({
  panelId,
  tabId,
  router,
  chainId,
  leg,
  risky,
  stable,
  state,
  errorMessage,
  refusedMessage,
}: PriceViewProps) {
  const [index, setIndex] = useState<number | null>(null);

  const enabled = !!leg && state === 'ready';

  const live = useCurveSamples({
    router,
    chainId,
    strikeWad: leg?.strikeWad,
    sigmaWad: leg?.sigmaWad,
    maturity: leg?.maturity,
    liquidityWad: leg?.liquidityWad,
    samples: CURVE_SAMPLES,
    enabled,
  });

  const settled = useCurveSamples({
    router,
    chainId,
    strikeWad: leg?.strikeWad,
    sigmaWad: leg?.sigmaWad,
    maturity: MATURED_MATURITY,
    liquidityWad: leg?.liquidityWad,
    samples: 2,
    refreshMs: false,
    enabled,
  });

  const error = live.error ?? settled.error;
  const points = live.samples;
  const settlement = settled.samples;

  let resolved: TerminalState = state;
  if (state === 'ready') {
    if (!leg) resolved = 'empty';
    else if (error) resolved = 'error';
    else if (points.length >= 2 && settlement.length >= 2) resolved = 'ready';
    else if (live.isLoading || settled.isLoading) resolved = 'loading';
    else resolved = 'empty';
  }

  const reserve = leg ? { x: wadToNumber(leg.xWad), y: wadToNumber(leg.yWad) } : null;

  /** The settlement line at any `x`, from its two measured endpoints. It is a line. */
  const settlementAt = (x: number): number => {
    if (settlement.length < 2) return Number.NaN;
    const [a, b] = [settlement[0], settlement[settlement.length - 1]];
    const span = b.x - a.x;
    return span === 0 ? a.y : a.y + ((b.y - a.y) * (x - a.x)) / span;
  };

  const at = index === null ? null : points[Math.min(index, points.length - 1)];
  const shown = at ?? (reserve && points.length ? reserve : null);

  /**
   * The gap at a point, from that point's own measured `y`.
   *
   * The reserve point's `y` is the leg's `yWad` — the exact wei `stableFor` returned when the offer
   * was sized — and a sample's `y` is the wei the router returned for that sample. Reading the
   * curve back through `liveAt` instead put `+58.42` in this readout while the ticket three hundred
   * pixels away printed `+59.08` for the same quantity, because the reserve point sits between two
   * samples and interpolation is not the curve.
   */
  const gapAt = (point: ChartPoint): number => Math.max(0, settlementAt(point.x) - point.y);

  /*
   * The readout is the cursor, not the legend, and it stopped repeating the legend.
   *
   * `WETH unsold` and `USDC held` were the right words in the wrong container: the x axis already
   * says `WETH still unsold` under its ticks and the left axis already says `USDC held` beside its
   * own, in the curve's colour, permanently. Printing them again forty pixels above was the same
   * sentence twice in one glance. What is left is the token, its mark and the figure — plus the two
   * quantities that live on no axis label: what the same reserves are worth once the clock runs out,
   * and the distance between the two, which is what the maker is owed for the wait.
   */
  const readout: ReadoutItem[] =
    shown && resolved === 'ready'
      ? [
          {
            label: risky.symbol,
            icon: risky.icon,
            value: formatChartToken(shown.x, tokenFractionDigits(risky.symbol)),
          },
          {
            label: stable.symbol,
            icon: stable.icon,
            value: formatChartToken(shown.y, tokenFractionDigits(stable.symbol)),
            tone: 'accent',
          },
          {
            label: 'at expiry',
            value: formatChartToken(settlementAt(shown.x), tokenFractionDigits(stable.symbol)),
            tone: 'ink-2',
          },
          // `premium`, not `time value`. It is the same quantity the ticket prints under `Premium`
          // and the payoff readout prints under `premium` — `stableFor` at the date against
          // `stableFor` at settlement — and one number does not get two names on one screen.
          {
            label: 'premium',
            value: formatChartToken(gapAt(shown), tokenFractionDigits(stable.symbol), {
              sign: 'always',
            }),
            tone: 'pos',
          },
        ]
      : [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* No legend row. The dashed line and the reserve point are labelled where they are, and each
          axis names the series that lives on it. */}
      <Readout items={readout} />
      <Plot
        title="The price this offer trades at"
        description={`The leg's trading function, sampled from the router at ${points.length} reserve points: the ${stable.symbol} the offer holds against the ${risky.symbol} it has not sold, on the left axis. The dashed line is the same offer at expiry, where it degenerates to a constant sum at the strike. The filled hump is the gap between them, in ${stable.symbol}, on the right axis: the premium the leg still holds at each point. The dot is where this offer's reserves sit now, and the arrow is the direction a fill moves it.`}
        margin={MARGIN}
        panelId={panelId}
        panelLabelledBy={tabId}
        state={resolved}
        refusedMessage={refusedMessage}
        emptyMessage="no curve"
        errorMessage={errorMessage ?? terminalError(error)}
        cursor={{
          positions: (geometry: ChartGeometry) => {
            const x = xScaleFor(geometry, points, settlement);
            return points.map((p) => x(p.x));
          },
          index,
          onIndex: setIndex,
          label: `${risky.symbol} still unsold`,
          valueText: readout.map((item) => `${item.label} ${item.value}`).join(', '),
        }}
      >
        {(geometry) => {
          if (points.length < 2 || settlement.length < 2) return null;

          const compact = geometry.inner.width < COMPACT_WIDTH;
          const x = xScaleFor(geometry, points, settlement);
          /* `.nice()` rather than a 4% pad: the domain then ends on a tick, so the topmost gridline
             label is the top of the plot instead of `20,000` floating two thirds of the way up a
             chart whose data reaches 26,000. */
          const yMax = Math.max(settlement[0].y, points[0].y);
          const y = scaleLinear()
            .domain([0, yMax])
            .range([geometry.inner.y + geometry.inner.height, geometry.inner.y])
            .nice(4);

          /* The premium at every sampled reserve point: the settlement line above, the live curve
             below, both already measured. Its own axis, because on the left one it is a tenth of a
             pixel tall. */
          const premiumPoints: ChartPoint[] = points.map((p) => ({
            x: p.x,
            y: gapAt(p),
          }));
          const premiumMax = premiumPoints.reduce((max, p) => Math.max(max, p.y), 0);
          const yPremium = scaleLinear()
            /* 2.4 rather than 1.5. The hump is a derived quantity on a secondary axis, and at a
               scale that filled the box it was the first thing the eye landed on and the last thing
               it should have been. Confined to the lower 40% it is still readable against its own
               ticks, and the two curves the left axis is about sit clearly above it. */
            .domain([0, (premiumMax || 1) * 2.4])
            .range([geometry.inner.y + geometry.inner.height, geometry.inner.y]);

          const bottom = geometry.inner.y + geometry.inner.height;

          /* Where the dashed settlement line is furthest from the live curve on the left half, so
             its own label sits in the widest clear space the plot has. */
          const labelAtX = points[Math.round(points.length * 0.22)] ?? points[0];

          /*
           * The arrow: the reserve point, then back along the measured samples toward smaller `x`.
           *
           * A taker buying takes risky out and puts stable in, so the point walks left and up. The
           * samples are the router's own, so the arrow lies on the curve rather than near it.
           */
          const arrow = reserve
            ? [
                { x: x(reserve.x), y: y(reserve.y) },
                ...points
                  .filter(
                    (p) =>
                      p.x < reserve.x &&
                      x(p.x) >= x(reserve.x) - (compact ? ARROW_SPAN.compact : ARROW_SPAN.wide),
                  )
                  .map((p) => ({ x: x(p.x), y: y(p.y) }))
                  .reverse(),
              ]
            : [];

          return (
            <>
              <Grid geometry={geometry} yScale={y} yCount={4} />
              <PlotArea geometry={geometry}>
                <Wipe geometry={geometry}>
                  {/*
                    * Quieter than it was, and quiet is the whole point of the change.
                    *
                    * This is a derived quantity on a secondary axis, and at a scale that filled the
                    * box it was the largest and brightest shape in the view: the eye landed on the
                    * green hump first and read it as the series. The subject of this plot is the two
                    * curves on the left axis and the dot sitting on one of them. So the hump keeps
                    * its outline — without one the fill dissolved into the ground and the axis on the
                    * right named a shape nobody could find — and gives up the height instead.
                    */}
                  <AreaFill
                    points={premiumPoints}
                    xScale={x}
                    yScale={yPremium}
                    baseline={0}
                    fill="pos"
                    tint={8}
                  />
                  <CurveLine
                    points={premiumPoints}
                    xScale={x}
                    yScale={yPremium}
                    stroke="pos"
                    strokeWidth={1}
                  />
                  {/* `ink-2` dashed, the same treatment the payoff view gives the line you would
                      have been on instead: across this chart, dashed and grey means "the other
                      case". At `ink-3` it disappeared under the shaded hump it crosses. */}
                  <CurveLine
                    points={settlement as readonly ChartPoint[]}
                    xScale={x}
                    yScale={y}
                    stroke="ink-2"
                    strokeWidth={1.5}
                    dash="dashed"
                  />
                  <CurveLine points={points} xScale={x} yScale={y} stroke="accent" strokeWidth={2} />
                  <SeriesLabel
                    x={x(labelAtX.x) + 6}
                    y={y(settlementAt(labelAtX.x)) - 8}
                    tone="ink-2"
                    className={classes.fade}
                  >
                    at expiry
                  </SeriesLabel>
                  {reserve ? (
                    <>
                      <DirectionArrow id={`${geometry.clipId}-arrow`} points={arrow} />
                      <LivePoint x={x(reserve.x)} y={y(reserve.y)} baseline={bottom} />
                      {/*
                        * The dot, named in words, and named BELOW it.
                        *
                        * It is the mark the whole view exists for and it had no label at all: a
                        * reader saw a circle on a line and had to be told. Three plain words beat a
                        * legend entry reading `reserve`, which is the implementation's word for it
                        * and means nothing to somebody who has not read the contracts.
                        *
                        * Above the dot is where the curve is, and a halo big enough to keep the
                        * words legible there takes a bite out of the one line the view is about.
                        * Below it is the wedge between the curve and the axis, which is empty on
                        * every leg — the dot sits at `x = L` on a fresh offer, so the curve has
                        * already come down to meet the axis beside it. Clamped off the axis band so
                        * a short plot cannot push the words into the ticks.
                        */}
                      <SeriesLabel
                        x={x(reserve.x) - 12}
                        y={Math.min(y(reserve.y) + 17, bottom - 6)}
                        anchor="end"
                        tone="accent"
                        className={classes.fade}
                      >
                        {compact ? 'now' : 'you are here'}
                      </SeriesLabel>
                    </>
                  ) : null}
                </Wipe>
              </PlotArea>
              <Axis geometry={geometry} scale={x} orientation="bottom" count={compact ? 3 : 5} />
              {/*
                * The two ends of the axis, named, and this is the cheapest thing on the plot.
                *
                * `0.0` and `1.0` are a quantity of WETH; what a reader needs is that the right-hand
                * end is an offer nobody has touched and the left-hand end is one that has been taken
                * in full. With those two words down, the reserve point sitting hard against `none
                * sold` and the arrow marching away from it read as one statement — this is where you
                * are, and that is the way a fill moves you — instead of as a dot near an axis.
                */}
              <AxisBand geometry={geometry} start="all sold" end="none sold">
                {compact ? `${risky.symbol} unsold` : `${risky.symbol} still unsold`}
              </AxisBand>
              <Axis geometry={geometry} scale={y} orientation="left" count={4} />
              <Axis
                geometry={geometry}
                scale={yPremium}
                orientation="right"
                count={4}
                textColor="ink-3"
              />
              {/* The left axis carries both curves, so it takes the accent rule the live one wears:
                  the dashed twin is named on the line itself, a few pixels above it. */}
              <AxisName geometry={geometry} side="left" swatch="accent" className={classes.fade}>
                {`${stable.symbol} held`}
              </AxisName>
              {/* The right axis belongs to the filled hump, and says so by standing over it in its
                  colour — which is also what stops the hump reading as the main series when it is
                  the tallest thing on the plot and lives on a scale a hundred times smaller. */}
              <AxisName geometry={geometry} side="right" swatch="pos" className={classes.fade}>
                {`premium · ${stable.symbol}`}
              </AxisName>
              {at ? (
                <Crosshair
                  geometry={geometry}
                  x={x(at.x)}
                  dots={[
                    { id: 'premium', y: yPremium(gapAt(at)), color: 'pos' },
                    { id: 'live', y: y(at.y), color: 'accent' },
                  ]}
                  label={formatChartToken(at.x, tokenFractionDigits(risky.symbol))}
                />
              ) : null}
            </>
          );
        }}
      </Plot>
    </div>
  );
}

/** `[0, L]`, from whichever series knows `L` — both are sampled over the same domain. */
function xScaleFor(
  geometry: ChartGeometry,
  points: readonly ChartPoint[],
  settlement: readonly ChartPoint[],
) {
  const last = points.length ? points[points.length - 1].x : 0;
  const end = Math.max(last, settlement.length ? settlement[settlement.length - 1].x : 0, 1e-18);
  return scaleLinear()
    .domain([0, end])
    .range([geometry.inner.x, geometry.inner.x + geometry.inner.width]);
}
