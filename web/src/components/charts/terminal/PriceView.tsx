'use client';

/**
 * PRICE — the price each unit of the offer sells at, as buyers take more of it.
 *
 * A sell ladder. The x axis is how much of the offer's risky has been bought, starting from where
 * the offer stands now; the y axis is the price per unit a buyer pays for that next slice. It
 * answers the question a maker actually has — "if people keep buying, what do I get for each ETH?"
 * — without asking them to read an AMM reserve curve.
 *
 * WHERE THE NUMBERS COME FROM. Nothing here is option maths. The router is asked for the stable the
 * offer holds at 48 evenly spaced risky reserves (`stableFor`, one multicall, the same read this
 * view has always made), and the price of each slice is the measured step between two neighbouring
 * answers: `|ΔY / ΔX|`, plotted at the slice's midpoint. The first slice runs from the offer's own
 * reserve point, whose stable is the exact wei the ticket sized it with, to the next sample below.
 *
 * The dashed line is the same offer at expiry, differentiated the same way. At `tau = 0` the router
 * takes its constant-sum branch `Y = K*(L - X)`, so the step is `K` everywhere and the line is flat
 * at the strike — measured from two chain reads, not drawn at a typed-in number.
 *
 * Why the live ladder starts below the strike and ends above it: the curve replicates a covered
 * call, so the offer sells a little at today's price and more as the price rises through the
 * strike. That shape is the product, and it is why a single "sell at K" line would be the wrong
 * picture before expiry.
 */
import { useState } from 'react';
import { scaleLinear } from 'd3-scale';
import type { Address } from 'viem';
import { MATURED_MATURITY, useCurveSamples } from '@/hooks/useCurveSamples';
import type { SupportedChainId } from '@/lib/chain';
import { Axis } from '../Axis';
import { CurveLine } from '../CurveLine';
import { Grid } from '../Grid';
import { formatChartNumber, formatChartToken } from '../format';
import { type ChartGeometry, type ChartPoint } from '../types';
import classes from './chart.module.css';
import { Crosshair } from './Crosshair';
import { Readout, type ReadoutItem } from './chrome';
import { terminalError } from './errors';
import { AxisBand, AxisName, LivePoint, SeriesLabel, Wipe } from './Marks';
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
  /** Oracle spot, for the reference line. Optional: the ladder stands without it. */
  spot?: number;
  state: TerminalState;
  errorMessage?: string;
  refusedMessage?: string;
}

const MARGIN = { top: 26, right: 24, bottom: 42, left: 62 };

/** Points across `x in [0, L]`. Each is one `eth_call` running a 40-step bisection of `Phi`. */
const CURVE_SAMPLES = 48;

/** Below this the axis names shorten; the plot is too narrow to carry both in full. */
const COMPACT_WIDTH = 460;

/** A slice of the ladder: `sold` is measured from the offer's current position. */
export interface LadderStep {
  sold: number;
  price: number;
}

/**
 * The price of each slice between the reserve point and zero, from measured `(x, y)` samples.
 *
 * `samples` is sorted by `x` ascending, as `curveGrid` produces it. Only reserves below the offer's
 * own `x` are sellable to a buyer, so the ladder starts at `reserve` and walks down the grid. Steps
 * with no width, or a non-finite slope, are dropped rather than drawn.
 */
export function sellLadder(
  samples: readonly ChartPoint[],
  reserve: ChartPoint,
): LadderStep[] {
  const below = samples.filter((p) => p.x < reserve.x).sort((a, b) => b.x - a.x);
  const path = [reserve, ...below];
  const out: LadderStep[] = [];
  for (let i = 1; i < path.length; i += 1) {
    const hi = path[i - 1];
    const lo = path[i];
    const dx = hi.x - lo.x;
    if (!(dx > 0)) continue;
    const price = Math.abs((lo.y - hi.y) / dx);
    if (!Number.isFinite(price)) continue;
    out.push({ sold: reserve.x - (hi.x + lo.x) / 2, price });
  }
  return out;
}

export function PriceView({
  panelId,
  tabId,
  router,
  chainId,
  leg,
  risky,
  stable,
  spot,
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
  const reserve = leg ? { x: wadToNumber(leg.xWad), y: wadToNumber(leg.yWad) } : null;
  const ladder = reserve ? sellLadder(live.samples, reserve) : [];

  /* At expiry the curve is a line, so its one slope is the whole ladder. Measured, not typed in. */
  const settlement = settled.samples;
  const expiryPrice =
    settlement.length >= 2
      ? Math.abs(
          (settlement[settlement.length - 1].y - settlement[0].y) /
            (settlement[settlement.length - 1].x - settlement[0].x || 1),
        )
      : Number.NaN;

  let resolved: TerminalState = state;
  if (state === 'ready') {
    if (!leg) resolved = 'empty';
    else if (error) resolved = 'error';
    else if (ladder.length >= 2 && Number.isFinite(expiryPrice)) resolved = 'ready';
    else if (live.isLoading || settled.isLoading) resolved = 'loading';
    else resolved = 'empty';
  }

  const at = index === null ? null : ladder[Math.min(index, ladder.length - 1)];
  const shown = at ?? ladder[0] ?? null;

  const readout: ReadoutItem[] =
    shown && resolved === 'ready'
      ? [
          {
            label: 'sold',
            value: `${formatChartToken(at ? at.sold : 0, 1)} ${risky.symbol}`,
          },
          {
            label: 'price',
            icon: stable.icon,
            value: `${formatChartToken(shown.price, 0)} ${stable.symbol}`,
            tone: 'accent',
          },
          {
            label: 'at expiry',
            value: `${formatChartToken(expiryPrice, 0)} ${stable.symbol}`,
            tone: 'ink-2',
          },
        ]
      : [];

  const total = reserve?.x ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <Readout items={readout} />
      <Plot
        title="The price each unit sells at"
        description={`A sell ladder for this offer: for each amount of ${risky.symbol} bought from it, starting now, the price per ${risky.symbol} in ${stable.symbol} a buyer pays for the next slice. Each price is the step between two router reads of the offer's curve. The dashed line is the same offer at expiry, where every slice sells at the strike.`}
        margin={MARGIN}
        panelId={panelId}
        panelLabelledBy={tabId}
        state={resolved}
        refusedMessage={refusedMessage}
        emptyMessage="no curve"
        errorMessage={errorMessage ?? terminalError(error)}
        cursor={{
          positions: (geometry: ChartGeometry) => {
            const x = soldScale(geometry, total);
            return ladder.map((step) => x(step.sold));
          },
          index,
          onIndex: setIndex,
          label: `${risky.symbol} sold`,
          valueText: readout.map((item) => `${item.label} ${item.value}`).join(', '),
        }}
      >
        {(geometry) => {
          if (ladder.length < 2 || !Number.isFinite(expiryPrice)) return null;

          const compact = geometry.inner.width < COMPACT_WIDTH;
          const x = soldScale(geometry, total);
          const prices = ladder.map((s) => s.price);
          const refs = [expiryPrice, ...(spot !== undefined && spot > 0 ? [spot] : [])];
          const lo = Math.min(...prices, ...refs);
          const hi = Math.max(...prices, ...refs);
          const pad = (hi - lo) * 0.08 || hi * 0.02;
          const y = scaleLinear()
            .domain([lo - pad, hi + pad])
            .range([geometry.inner.y + geometry.inner.height, geometry.inner.y])
            .nice(4);

          const bottom = geometry.inner.y + geometry.inner.height;
          const left = geometry.inner.x;
          const right = geometry.inner.x + geometry.inner.width;
          const points: ChartPoint[] = ladder.map((s) => ({ x: s.sold, y: s.price }));
          const expiryLine: ChartPoint[] = [
            { x: 0, y: expiryPrice },
            { x: total, y: expiryPrice },
          ];
          const first = ladder[0];

          return (
            <>
              <Grid geometry={geometry} yScale={y} yCount={4} />
              <PlotArea geometry={geometry}>
                <Wipe geometry={geometry}>
                  {spot !== undefined && spot > 0 ? (
                    <>
                      <line
                        x1={left}
                        x2={right}
                        y1={y(spot)}
                        y2={y(spot)}
                        stroke="var(--ink-3)"
                        strokeWidth={1}
                      />
                      <SeriesLabel x={right - 4} y={y(spot) + 16} anchor="end" tone="ink-3" className={classes.fade}>
                        {`${risky.symbol} now ${formatChartNumber(spot, { significantDigits: 6, maxFractionDigits: 0 })}`}
                      </SeriesLabel>
                    </>
                  ) : null}
                  <CurveLine
                    points={expiryLine}
                    xScale={x}
                    yScale={y}
                    stroke="ink-2"
                    strokeWidth={1.5}
                    dash="dashed"
                  />
                  <SeriesLabel x={right - 4} y={y(expiryPrice) - 8} anchor="end" tone="ink-2" className={classes.fade}>
                    {compact ? 'at expiry' : `at expiry: every ${risky.symbol} at the strike`}
                  </SeriesLabel>
                  <CurveLine points={points} xScale={x} yScale={y} stroke="accent" strokeWidth={2} />
                  <SeriesLabel
                    x={x(ladder[Math.floor(ladder.length * 0.72)].sold) - 6}
                    y={y(ladder[Math.floor(ladder.length * 0.72)].price) - 10}
                    anchor="end"
                    tone="accent"
                    className={classes.fade}
                  >
                    today
                  </SeriesLabel>
                  <LivePoint x={x(first.sold)} y={y(first.price)} baseline={bottom} />
                  <SeriesLabel
                    x={x(first.sold) + 12}
                    y={Math.min(y(first.price) + 20, bottom - 6)}
                    tone="accent"
                    className={classes.fade}
                  >
                    {compact ? 'now' : 'you are here'}
                  </SeriesLabel>
                </Wipe>
              </PlotArea>
              <Axis geometry={geometry} scale={x} orientation="bottom" count={compact ? 3 : 5} />
              <AxisBand geometry={geometry} start="nothing sold" end="all sold">
                {`${risky.symbol} bought from your offer`}
              </AxisBand>
              <Axis geometry={geometry} scale={y} orientation="left" count={4} />
              <AxisName geometry={geometry} side="left" swatch="accent" className={classes.fade}>
                {compact ? `price · ${stable.symbol}` : `price per ${risky.symbol} · ${stable.symbol}`}
              </AxisName>
              {at ? (
                <Crosshair
                  geometry={geometry}
                  x={x(at.sold)}
                  dots={[{ id: 'live', y: y(at.price), color: 'accent' }]}
                  label={formatChartToken(at.sold, 1)}
                />
              ) : null}
            </>
          );
        }}
      </Plot>
    </div>
  );
}

/** `[0, amount on offer]`. */
function soldScale(geometry: ChartGeometry, total: number) {
  return scaleLinear()
    .domain([0, total || 1])
    .range([geometry.inner.x, geometry.inner.x + geometry.inner.width]);
}
