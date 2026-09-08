'use client';

/**
 * The gap over the rest of the offer's life: the product's own sentence, drawn.
 *
 * *The longer nobody takes it, the more the taker has to pay.* Every point on this line is the
 * router answering what the minimum clearing trade would be on an offer with these terms, these
 * reserves, and that much less time left — which is precisely the offer this one becomes if nobody
 * touches it. One `bandFor` per point, all of them in a single multicall.
 *
 * The assumption is stated rather than hidden: reserves are held where they are now. A trade in
 * between puts the reserve point back on the curve and resets the line to zero, which is the
 * mechanism working, not the chart being wrong.
 */
import { scaleLinear } from 'd3-scale';
import { AreaFill } from '@/components/charts/AreaFill';
import { Axis } from '@/components/charts/Axis';
import { ChartFrame, PlotArea, type ChartState } from '@/components/charts/ChartFrame';
import { CurveLine } from '@/components/charts/CurveLine';
import { Grid } from '@/components/charts/Grid';
import { formatChartNumber } from '@/components/charts/format';
import { round, type ChartPoint } from '@/components/charts/types';
import { color, FONT_STACK } from '@/lib/ui/tokens';
import type { BandPoint } from './useBandSeries';

export interface GapGrowthProps {
  points: readonly BandPoint[];
  stableSymbol: string;
  /** Days from now the scrubber is holding, marked on the line. */
  markerDays?: number;
  state?: ChartState;
  errorMessage?: string;
  height?: number;
}

const MARGIN = { top: 16, right: 20, bottom: 38, left: 66 };

export function GapGrowth({
  points,
  stableSymbol,
  markerDays,
  state = 'ready',
  errorMessage,
  height = 220,
}: GapGrowthProps) {
  const series: ChartPoint[] = points.map((p) => ({ x: p.days, y: p.stable }));
  const maxDays = series.reduce((m, p) => Math.max(m, p.x), 0);
  const maxValue = series.reduce((m, p) => Math.max(m, p.y), 0);

  const resolvedState: ChartState = state === 'ready' && series.length < 2 ? 'empty' : state;

  return (
    <ChartFrame
      title="What the wait is worth, if nobody trades"
      description={`The smallest ${stableSymbol} trade this offer will accept, over the rest of its life, on the assumption that nobody trades in between. It runs from ${formatChartNumber(series[0]?.y ?? 0, { significantDigits: 3 })} today to ${formatChartNumber(maxValue, { significantDigits: 3 })} ${stableSymbol} after ${formatChartNumber(maxDays, { maxFractionDigits: 1 })} days.`}
      height={height}
      margin={MARGIN}
      state={resolvedState}
      errorMessage={errorMessage}
      emptyMessage="This offer is inside its last hour, where the clock stops shortening and the gap holds still until the date passes."
      footnote={
        <>
          Read it as the toll a buyer pays to re-open the curve, and the maker collects. It is
          {' '}
          <span className="font-mono">bandFor</span> at{' '}
          <span className="font-mono tnum">{points.length}</span> different maturities, one
          multicall, reserves held where they are now. Take a trade in between and the line resets
          to nothing: that trade paid whatever had built up by then.
        </>
      }
    >
      {(geometry) => {
        const x = scaleLinear()
          .domain([0, maxDays || 1])
          .range([geometry.inner.x, geometry.inner.x + geometry.inner.width]);
        const y = scaleLinear()
          .domain([0, maxValue || 1])
          .nice()
          .range([geometry.inner.y + geometry.inner.height, geometry.inner.y]);

        const markerPoint =
          markerDays === undefined
            ? undefined
            : series.reduce<ChartPoint | undefined>(
                (best, p) =>
                  best === undefined || Math.abs(p.x - markerDays) < Math.abs(best.x - markerDays)
                    ? p
                    : best,
                undefined,
              );

        return (
          <>
            <Grid geometry={geometry} yScale={y} lines="y" />
            <PlotArea geometry={geometry}>
              <AreaFill points={series} xScale={x} yScale={y} fill="warn" tint={14} baseline={0} />
              <CurveLine points={series} xScale={x} yScale={y} stroke="warn" strokeWidth={2} />
              {markerPoint && markerDays !== undefined && markerDays > 0 ? (
                <>
                  <line
                    x1={round(x(markerPoint.x))}
                    y1={round(y(0))}
                    x2={round(x(markerPoint.x))}
                    y2={round(y(markerPoint.y))}
                    stroke={color('accent')}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                  <circle
                    cx={round(x(markerPoint.x))}
                    cy={round(y(markerPoint.y))}
                    r={4.5}
                    fill={color('accent')}
                    stroke={color('surface')}
                    strokeWidth={2}
                  />
                </>
              ) : null}
            </PlotArea>

            <Axis
              geometry={geometry}
              scale={x}
              orientation="bottom"
              count={4}
              format={(v) => (Number(v) === 0 ? 'today' : `+${formatChartNumber(Number(v), { maxFractionDigits: 1 })}d`)}
              label="days from now"
            />
            <Axis geometry={geometry} scale={y} orientation="left" count={4} />
            <text
              x={geometry.inner.x}
              y={geometry.inner.y - 5}
              fontFamily={FONT_STACK.sans}
              fontSize={12}
              fill={color('ink-3')}
            >
              smallest {stableSymbol} trade it will take
            </text>
          </>
        );
      }}
    </ChartFrame>
  );
}

/** The last value in the series, for a caption that wants the endpoint without re-deriving it. */
export function endOfSeries(points: readonly BandPoint[]): BandPoint | undefined {
  return points.at(-1);
}
