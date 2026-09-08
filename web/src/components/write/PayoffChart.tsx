'use client';

/**
 * What the book is worth at prices that have not happened. The one modelled surface in the app.
 *
 * The chart carries the word "model" in its own caption rather than in a footnote, because every
 * other number a maker sees in Strikeline is an `eth_call` and this one is not. It answers a
 * counterfactual, so no chain can answer it.
 *
 * Three lines and two bands:
 *
 *  - **At expiry** — `sum L_i * min(S, K_i)`, the hockey stick. Solid, because it is the shape the
 *    position actually resolves to.
 *  - **Now** — the same book at each leg's live `tau`, which is the smoothed version of it. Dotted:
 *    it is a projection at today's vol assumption, not a settlement.
 *  - **Holding** — the same reserves simply held. Dashed. It touches the book at the price the legs
 *    were written at, sits above it on the way up (that is the cap the maker sold) and *also* above
 *    it on the way down. The second half is the honest one: this position is short volatility, and
 *    a chart that hid the downside would be selling something else.
 *  - **Assigned** — the price bands where a leg converts. Above the lowest call strike the calls
 *    hand over risky for stable; below the put's strike the put does the reverse.
 */
import { useMemo } from 'react';
import { scaleLinear } from 'd3-scale';
import { Axis } from '@/components/charts/Axis';
import { Band } from '@/components/charts/Band';
import { ChartFrame, PlotArea, type ChartState } from '@/components/charts/ChartFrame';
import { CurveLine } from '@/components/charts/CurveLine';
import { Grid } from '@/components/charts/Grid';
import { MarkerLayer, type MarkerSpec } from '@/components/charts/Marker';
import { formatChartNumber } from '@/components/charts/format';
import { sampleCurve } from '@/components/charts/geometry';
import { color, colorMix, FONT_STACK } from '@/lib/ui/tokens';
import { assignedBounds, bookValue, bookValueAtExpiry, hodlValue, spotDomain, type PayoffLeg } from './payoff';

export interface PayoffChartProps {
  legs: readonly PayoffLeg[];
  /** Current spot, from the price feed. */
  spot: number;
  riskySymbol: string;
  stableSymbol: string;
  state?: ChartState;
  errorMessage?: string;
  height?: number;
}

const MARGIN = { top: 18, right: 20, bottom: 34, left: 68 };
const SAMPLES = 140;

export function PayoffChart({
  legs,
  spot,
  riskySymbol,
  stableSymbol,
  state = 'ready',
  errorMessage,
  height = 300,
}: PayoffChartProps) {
  const domain = useMemo<[number, number]>(
    () => (legs.length > 0 && spot > 0 ? spotDomain(legs, spot) : [0, 1]),
    [legs, spot],
  );

  const series = useMemo(() => {
    if (legs.length === 0 || !(spot > 0)) return { expiry: [], now: [], hodl: [] };
    return {
      expiry: sampleCurve((s) => bookValueAtExpiry(legs, s), domain, SAMPLES),
      now: sampleCurve((s) => bookValue(legs, s), domain, SAMPLES),
      hodl: sampleCurve((s) => hodlValue(legs, s), domain, SAMPLES),
    };
  }, [legs, spot, domain]);

  const bounds = useMemo(() => assignedBounds(legs), [legs]);

  const markers = useMemo<MarkerSpec[]>(() => {
    const out: MarkerSpec[] = legs.map((leg, i) => ({
      id: `k-${leg.strike}-${i}`,
      value: leg.strike,
      label: formatChartNumber(leg.strike),
      stroke: 'line-strong',
      labelColor: 'ink-2',
    }));
    if (spot > 0) {
      out.push({
        id: 'spot',
        value: spot,
        label: `spot ${formatChartNumber(spot)}`,
        stroke: 'accent',
        labelColor: 'ink',
        dash: 'solid',
      });
    }
    return out;
  }, [legs, spot]);

  const empty = legs.length === 0 || !(spot > 0);
  const resolvedState: ChartState = state === 'ready' && empty ? 'empty' : state;

  return (
    <ChartFrame
      title="What you would be worth, at every ETH price"
      subtitle={
        <>
          <span className="rounded-control bg-surface-2 px-1.5 py-0.5 font-mono text-micro tracking-normal text-ink-2">
            model
          </span>{' '}
          Black-Scholes at the movement you chose, not a chain read.
        </>
      }
      description={`What these offers are worth in ${stableSymbol} at each price of ${riskySymbol}, on the date they run to and right now, next to simply holding the same tokens. The shaded bands mark the prices at which you would be sold.`}
      height={height}
      margin={MARGIN}
      state={resolvedState}
      errorMessage={errorMessage}
      emptyMessage="Pick a price and this fills in."
      legend={<Legend hasAssigned={bounds.above !== undefined || bounds.below !== undefined} />}
      footnote={
        <>
          On both sides of today&rsquo;s price these offers are worth less than simply holding: that
          is what selling movement costs you, and it is the risk. What you are paid for taking it is
          not in this picture and is not paid up front. It builds inside your own quote and only
          becomes real when somebody trades against it, which is measured on each offer&rsquo;s own
          screen rather than modelled here.
        </>
      }
    >
      {(geometry) => {
        const values = [...series.expiry, ...series.now, ...series.hodl].map((p) => p.y);
        const maxY = values.reduce((m, v) => Math.max(m, Number.isFinite(v) ? v : m), 0);

        const x = scaleLinear()
          .domain(domain)
          .range([geometry.inner.x, geometry.inner.x + geometry.inner.width]);
        const y = scaleLinear()
          .domain([0, maxY || 1])
          .nice(4)
          .range([geometry.inner.y + geometry.inner.height, geometry.inner.y]);

        return (
          <>
            <Grid geometry={geometry} yScale={y} />

            <PlotArea geometry={geometry}>
              {bounds.above !== undefined ? (
                <Band
                  geometry={geometry}
                  scale={x}
                  from={bounds.above}
                  to={domain[1]}
                  fill="warn"
                  tint={9}
                  edgeColor="warn"
                  label="you sell here"
                  labelColor="ink-3"
                />
              ) : null}
              {bounds.below !== undefined ? (
                <Band
                  geometry={geometry}
                  scale={x}
                  from={domain[0]}
                  to={bounds.below}
                  fill="warn"
                  tint={9}
                  edgeColor="warn"
                  label="you buy here"
                  labelColor="ink-3"
                />
              ) : null}

              <CurveLine
                points={series.hodl}
                xScale={x}
                yScale={y}
                stroke="ink-3"
                strokeWidth={1.5}
                dash="dashed"
              />
              <CurveLine
                points={series.now}
                xScale={x}
                yScale={y}
                stroke="accent"
                strokeWidth={1.5}
                dash="dotted"
              />
              <CurveLine points={series.expiry} xScale={x} yScale={y} stroke="accent" strokeWidth={2} />
            </PlotArea>

            <MarkerLayer geometry={geometry} scale={x} items={markers} labelSide="start" />

            <Axis geometry={geometry} scale={x} orientation="bottom" count={5} />
            <Axis geometry={geometry} scale={y} orientation="left" count={4} />
            <text
              x={geometry.inner.x}
              y={geometry.inner.y - 6}
              fontFamily={FONT_STACK.sans}
              fontSize={12}
              fill={color('ink-3')}
            >
              {stableSymbol}
            </text>
          </>
        );
      }}
    </ChartFrame>
  );
}

function Legend({ hasAssigned }: { hasAssigned: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-mini text-ink-3">
      <Item>
        <Swatch stroke={color('accent')} width={2} />
        On the date it runs to
      </Item>
      <Item>
        <Swatch stroke={color('accent')} width={1.5} dash="0 3.6" cap="round" />
        Now
      </Item>
      <Item>
        <Swatch stroke={color('ink-3')} width={1.5} dash="4.5 3.4" />
        If you just held
      </Item>
      {hasAssigned ? (
        <Item>
          <svg width={16} height={8} aria-hidden="true">
            <rect width={16} height={8} fill={colorMix('warn', 9)} stroke={color('warn')} strokeWidth={1} />
          </svg>
          You sell here
        </Item>
      ) : null}
    </span>
  );
}

function Item({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5">{children}</span>;
}

function Swatch({
  stroke,
  width,
  dash,
  cap,
}: {
  stroke: string;
  width: number;
  dash?: string;
  cap?: 'round' | 'butt';
}) {
  return (
    <svg width={16} height={8} aria-hidden="true">
      <line
        x1={0}
        y1={4}
        x2={16}
        y2={4}
        stroke={stroke}
        strokeWidth={width}
        strokeDasharray={dash}
        strokeLinecap={cap}
      />
    </svg>
  );
}
