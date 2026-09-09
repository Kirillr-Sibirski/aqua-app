'use client';

/**
 * THE LIVE CURVE — where the leg actually is, and where it is heading.
 *
 * `y(x)` across the whole reserve domain, one `stableFor` per point inside one multicall, plus the
 * reserve point the leg is sitting on and the `tau = 0` constant-sum line ghosted behind. The lens
 * between the two is the time value the position still holds: at both ends the curves meet, and in
 * the middle the live curve sags below the settlement line by exactly what decay has yet to hand
 * over.
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
import { color, colorMix } from '@/lib/ui/tokens';
import { Axis } from '../Axis';
import { CurveLine } from '../CurveLine';
import { Grid } from '../Grid';
import { formatChartNumber } from '../format';
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
}

const MARGIN = { top: 24, right: 16, bottom: 42, left: 62 };

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

  const readout: ReadoutItem[] = shown
    ? [
        {
          label: risky.symbol,
          icon: risky.icon,
          value: formatChartNumber(shown.x, { significantDigits: 6 }),
        },
        {
          label: stable.symbol,
          icon: stable.icon,
          value: formatChartNumber(shown.y, {
            significantDigits: 18,
            minFractionDigits: 2,
            maxFractionDigits: 2,
          }),
          tone: 'accent',
        },
        {
          label: 'at expiry',
          value: formatChartNumber(settlementAt(shown.x), {
            significantDigits: 18,
            minFractionDigits: 2,
            maxFractionDigits: 2,
          }),
          tone: 'ink-2',
        },
        {
          label: 'time value',
          value: formatChartNumber(settlementAt(shown.x) - shown.y, {
            significantDigits: 18,
            minFractionDigits: 2,
            maxFractionDigits: 2,
            sign: 'always',
          }),
          tone: 'pos',
        },
      ]
    : [];

  const legend: LegendItem[] = [
    { id: 'curve', color: 'accent' },
    { id: 'at expiry', color: 'ink-3', dash: 'dashed' },
    { id: 'reserve', color: 'accent', kind: 'dot' },
    { id: 'time value', color: 'accent', kind: 'area' },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <Strip control={control} legend={legend} readout={readout} />
      <Plot
        title="The live curve"
        description={`The leg's trading function, sampled from the router at ${points.length} reserve points: stable reserve in ${stable.symbol} against risky reserve in ${risky.symbol}. The dashed line is the same curve at expiry, where it degenerates to a constant sum at the strike. The dot is where this leg's reserves sit now.`}
        margin={MARGIN}
        panelId={panelId}
        panelLabelledBy={tabId}
        state={resolved}
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
          const yMax = Math.max(settlement[0].y, points[0].y);
          const y = scaleLinear()
            .domain([0, yMax * 1.04])
            .range([geometry.inner.y + geometry.inner.height, geometry.inner.y]);

          // The lens between the two curves: out along the live samples, back along the straight
          // settlement line. Both edges are measured, so the region between them is measured too.
          const lens =
            `M${points.map((p) => `${round(x(p.x))},${round(y(p.y))}`).join('L')}` +
            `L${round(x(settlement[settlement.length - 1].x))},${round(y(settlement[settlement.length - 1].y))}` +
            `L${round(x(settlement[0].x))},${round(y(settlement[0].y))}Z`;

          return (
            <>
              <Grid geometry={geometry} yScale={y} yCount={4} />
              <PlotArea geometry={geometry}>
                <path d={lens} fill={colorMix('accent', 14)} stroke="none" />
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
              <Axis geometry={geometry} scale={y} orientation="left" count={4} label={stable.symbol} />
              {at ? (
                <Crosshair
                  geometry={geometry}
                  x={x(at.x)}
                  dots={[
                    { id: 'settlement', y: y(settlementAt(at.x)), color: 'ink-3' },
                    { id: 'live', y: y(at.y), color: 'accent' },
                  ]}
                  label={formatChartNumber(at.x, { significantDigits: 4 })}
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
