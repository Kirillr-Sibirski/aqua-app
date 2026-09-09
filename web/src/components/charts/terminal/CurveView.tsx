'use client';

/**
 * THE LIVE CURVE — where the leg actually is, and what it is holding.
 *
 * `y(x)` across the whole reserve domain, one `stableFor` per point inside one multicall, plus the
 * reserve point the leg is sitting on and the `tau = 0` constant-sum line ghosted behind. The gap
 * between the two is the premium the position still holds: at both ends the curves meet, and in the
 * middle the live curve sags below the settlement line by exactly what decay has yet to hand over.
 *
 * THAT GAP GETS ITS OWN AXIS, and this is the difference between a chart and a decoration. On an
 * eight-day leg at twenty percent the gap is about sixty USDC on a reserve of twenty-seven thousand
 * — two parts in a thousand, which on a six-hundred-pixel axis is a tenth of a pixel. Shading it
 * between the curves drew a legend entry for a region nobody could see, and the view came out as
 * one straight line with a dashed line hiding under it. The two curves keep the left axis, because
 * their near-coincidence is itself the fact: an RMM leg is a constant-sum line plus a little. The
 * premium is drawn as a filled hump against a right axis of its own, at the scale it actually lives
 * at, which is the same two-axis device the decay view uses for the same reason.
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
import { useState, type ReactNode } from 'react';
import { scaleLinear } from 'd3-scale';
import type { Address } from 'viem';
import { MATURED_MATURITY, useCurveSamples } from '@/hooks/useCurveSamples';
import type { SupportedChainId } from '@/lib/chain';
import { color } from '@/lib/ui/tokens';
import { AreaFill } from '../AreaFill';
import { Axis } from '../Axis';
import { CurveLine } from '../CurveLine';
import { Grid } from '../Grid';
import { tokenFractionDigits } from '@/components/token';
import { formatChartToken } from '../format';
import { round, type ChartGeometry, type ChartPoint } from '../types';
import { Crosshair, UnitTag } from './Crosshair';
import { Strip, type LegendItem, type ReadoutItem } from './chrome';
import { terminalError } from './errors';
import { wadToNumber } from './payoff';
import { Plot, PlotArea } from './Plot';
import type { TerminalLeg, TerminalState, TerminalToken } from './types';

export interface CurveViewProps {
  control: ReactNode;
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
const MARGIN = { top: 24, right: 62, bottom: 42, left: 62 };

/** Points across `x in [0, L]`. Each is one `eth_call` running a 40-step bisection of `Phi`. */
const CURVE_SAMPLES = 48;

export function CurveView({
  control,
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
}: CurveViewProps) {
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

  /* A legend names the marks on the plot. With nothing drawn there are no marks, so a refusal or an
     error would otherwise advertise a series that is not there. Loading keeps it: the marks are
     about to exist and the strip should not reflow when they arrive. */
  const legend: LegendItem[] =
    resolved !== 'ready' && resolved !== 'loading'
      ? []
      : [
          { id: 'curve', color: 'accent' },
          { id: 'at expiry', color: 'ink-3', dash: 'dashed' },
          { id: 'reserve', color: 'accent', kind: 'dot' },
          { id: 'premium', color: 'pos', kind: 'area' },
        ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <Strip control={control} legend={legend} readout={readout} />
      <Plot
        title="The live curve"
        description={`The leg's trading function, sampled from the router at ${points.length} reserve points: stable reserve in ${stable.symbol} against risky reserve in ${risky.symbol} on the left axis. The dashed line is the same curve at expiry, where it degenerates to a constant sum at the strike. The filled hump is the gap between them, in ${stable.symbol}, on the right axis: the premium the leg still holds at each reserve point. The dot is where this leg's reserves sit now.`}
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
          label: `risky reserve, in ${risky.symbol}`,
          valueText: readout.map((item) => `${item.label} ${item.value}`).join(', '),
        }}
      >
        {(geometry) => {
          if (points.length < 2 || settlement.length < 2) return null;

          const compact = geometry.inner.width < 460;
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
            .domain([0, (premiumMax || 1) * 1.5])
            .range([geometry.inner.y + geometry.inner.height, geometry.inner.y]);

          return (
            <>
              <Grid geometry={geometry} yScale={y} yCount={4} />
              <PlotArea geometry={geometry}>
                <AreaFill
                  points={premiumPoints}
                  xScale={x}
                  yScale={yPremium}
                  baseline={0}
                  fill="pos"
                  tint={10}
                />
                <CurveLine
                  points={premiumPoints}
                  xScale={x}
                  yScale={yPremium}
                  stroke="pos"
                  strokeWidth={1.25}
                />
                <CurveLine
                  points={settlement as readonly ChartPoint[]}
                  xScale={x}
                  yScale={y}
                  stroke="ink-3"
                  strokeWidth={1.5}
                  dash="dashed"
                />
                <CurveLine points={points} xScale={x} yScale={y} stroke="accent" strokeWidth={2} />
                {reserve ? (
                  <>
                    {/* A drop line, so the reserve's own x is readable off the axis. */}
                    <line
                      x1={round(x(reserve.x))}
                      x2={round(x(reserve.x))}
                      y1={round(y(reserve.y))}
                      y2={geometry.inner.y + geometry.inner.height}
                      stroke={color('accent-dim')}
                      strokeWidth={1}
                      strokeDasharray="3 3"
                    />
                    <circle
                      cx={round(x(reserve.x))}
                      cy={round(y(reserve.y))}
                      r={4}
                      fill={color('accent')}
                      stroke={color('surface')}
                      strokeWidth={2}
                    />
                  </>
                ) : null}
              </PlotArea>
              <Axis geometry={geometry} scale={x} orientation="bottom" count={compact ? 3 : 5} />
              <UnitTag geometry={geometry}>{risky.symbol}</UnitTag>
              <Axis
                geometry={geometry}
                scale={y}
                orientation="left"
                count={4}
                label={stable.symbol}
              />
              <Axis
                geometry={geometry}
                scale={yPremium}
                orientation="right"
                count={4}
                textColor="ink-3"
              />
              {/* The right axis belongs to the filled hump, and says so by standing over it. */}
              <text
                x={geometry.inner.x + geometry.inner.width}
                y={geometry.inner.y - 10}
                textAnchor="end"
                fontSize={12}
                fill={color('pos')}
              >
                premium
              </text>
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
