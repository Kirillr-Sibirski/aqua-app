'use client';

/**
 * The offer's curve: what it will trade at, for every size a taker could ask for.
 *
 * Read left to right it is one sentence. Buyers take the risky asset out of the offer and pay the
 * stable one in, so the reserve point slides down the line; where it stops is the rate the next
 * trade gets. The dashed line is the same 62 bytes with the clock run out — a straight
 * `Y = K*(L - X)`, no Gaussian in it at all — and the solid line falls toward it as the date
 * approaches. That fall is the whole product.
 *
 * Every point on the solid line is one `stableFor` call into the router, sampled over a single
 * multicall, at whatever maturity the scrubber is holding. Every point on the dashed line is the
 * same call at a maturity that has already passed. The reserve point and the trade markers are
 * replayed from Aqua's own `Pushed`/`Pulled` ledger. There is no curve maths in this file, and the
 * only arithmetic it does is picking axis domains.
 *
 * The gap between the reserve point and the curve is NOT drawn here, on purpose. On a y-domain of
 * 0 to L*K it is between a hundredth and a couple of pixels, and a previous version of this chart
 * advertised it in the legend while drawing a path with a zero-by-zero bounding box. It is drawn
 * at its own scale in `GapChart`, and marked here with a leader and a figure so the reader knows
 * where it is and how big.
 */
import { useMemo } from 'react';
import { scaleLinear } from 'd3-scale';
import { Axis } from '@/components/charts/Axis';
import { ChartFrame, PlotArea, type ChartState } from '@/components/charts/ChartFrame';
import { CurveLine } from '@/components/charts/CurveLine';
import { Grid } from '@/components/charts/Grid';
import { formatChartNumber } from '@/components/charts/format';
import { estimateMonoTextWidth } from '@/components/charts/geometry';
import { round, type ChartGeometry, type ChartPoint } from '@/components/charts/types';
import { color, FONT_STACK } from '@/lib/ui/tokens';
import type { CurveSample } from '@/hooks/useCurveSamples';

export interface ReservePoint {
  x: number;
  y: number;
}

export interface FillMarker {
  id: string;
  x: number;
  y: number;
  label: string;
}

export interface PriceCurveProps {
  /** Samples at the maturity the scrubber is holding. */
  live: readonly CurveSample[];
  /** Samples at `tau = 0`. Ghosted, and the anchor for both domains so the axes never jump. */
  settlement: readonly CurveSample[];
  reserve?: ReservePoint;
  /** The far corner of the gap, in the same units, only used to size the callout. */
  gapStable?: number;
  fills?: readonly FillMarker[];
  riskySymbol: string;
  stableSymbol: string;
  subtitle?: React.ReactNode;
  /** True while the line is drawn at a time the reader dragged to rather than now. */
  scrubbed?: boolean;
  state?: ChartState;
  errorMessage?: string;
  height?: number;
}

const MARGIN = { top: 16, right: 18, bottom: 38, left: 66 };

function toPoints(samples: readonly CurveSample[]): ChartPoint[] {
  return samples.map((s) => ({ x: s.x, y: s.y }));
}

export function PriceCurve({
  live,
  settlement,
  reserve,
  gapStable,
  fills = [],
  riskySymbol,
  stableSymbol,
  subtitle,
  scrubbed = false,
  state = 'ready',
  errorMessage,
  height = 300,
}: PriceCurveProps) {
  const livePoints = useMemo(() => toPoints(live), [live]);
  const settlementPoints = useMemo(() => toPoints(settlement), [settlement]);

  // The settlement line runs from (0, L*K) to (L, 0) and always contains the live curve, so
  // anchoring the domains to it keeps the axes still while the scrubber moves.
  const anchor = settlementPoints.length > 0 ? settlementPoints : livePoints;
  const maxX = anchor.reduce((m, p) => Math.max(m, p.x), 0);
  const maxY = anchor.reduce((m, p) => Math.max(m, p.y), 0);

  const empty = livePoints.length === 0 && settlementPoints.length === 0;
  const resolvedState: ChartState = state === 'ready' && empty ? 'empty' : state;

  return (
    <ChartFrame
      title="What this offer trades at"
      description={`${stableSymbol} taken in against ${riskySymbol} still on offer. The solid line is where a trade clears ${scrubbed ? 'at the time dragged to' : 'right now'}; the dashed line is what the offer becomes on its date. X runs from 0 to ${formatChartNumber(maxX)} ${riskySymbol}; Y from 0 to ${formatChartNumber(maxY)} ${stableSymbol}.`}
      subtitle={subtitle}
      height={height}
      margin={MARGIN}
      state={resolvedState}
      errorMessage={errorMessage}
      emptyMessage="The router returned no points for this offer."
      legend={<Legend scrubbed={scrubbed} hasFills={fills.length > 0} />}
      footnote={
        <>
          Buyers take {riskySymbol} out and pay {stableSymbol} in, so every trade slides the dot down
          the line and the next buyer gets a different rate. Each point is one{' '}
          <span className="font-mono">stableFor</span> call into the router, sampled over one
          multicall — no curve maths runs in the browser.
        </>
      }
      table={
        <ValuesTable
          live={live}
          reserve={reserve}
          fills={fills}
          riskySymbol={riskySymbol}
          stableSymbol={stableSymbol}
        />
      }
      tableLabel="the numbers"
    >
      {(geometry) => {
        const x = scaleLinear()
          .domain([0, maxX || 1])
          .range([geometry.inner.x, geometry.inner.x + geometry.inner.width]);
        const y = scaleLinear()
          .domain([0, maxY || 1])
          .range([geometry.inner.y + geometry.inner.height, geometry.inner.y]);
        const compact = geometry.inner.width < 380;

        return (
          <>
            <Grid geometry={geometry} yScale={y} xScale={x} lines="both" />

            <PlotArea geometry={geometry}>
              {settlementPoints.length > 0 ? (
                <CurveLine
                  points={settlementPoints}
                  xScale={x}
                  yScale={y}
                  stroke="ink-3"
                  strokeWidth={1.5}
                  dash="dashed"
                />
              ) : null}

              {livePoints.length > 0 ? (
                <CurveLine points={livePoints} xScale={x} yScale={y} stroke="accent" strokeWidth={2} />
              ) : null}

              {reserve ? <ReserveDot cx={x(reserve.x)} cy={y(reserve.y)} /> : null}

              {/* After the reserve dot, and hollow. The most recent trade is what put the reserves
                  where they are, so its marker sits exactly under that dot — drawn first and filled
                  it would be invisible, which is the whole history of this offer disappearing behind
                  one circle. A ring larger than the dot reads as both at once. */}
              {fills.map((fill) => (
                <FillDot key={fill.id} cx={x(fill.x)} cy={y(fill.y)} />
              ))}
            </PlotArea>

            {/* The gap is real and it is under a pixel at this scale. Point at it and say how big
                rather than draw a mark whose size would be a lie; the panel below draws it. */}
            {reserve && gapStable !== undefined && gapStable > 0 ? (
              <GapCallout
                cx={x(reserve.x)}
                cy={y(reserve.y)}
                geometry={geometry}
                label={`gap ${formatChartNumber(gapStable, { significantDigits: 6, maxFractionDigits: 2 })} ${stableSymbol}`}
              />
            ) : null}

            <Axis
              geometry={geometry}
              scale={x}
              orientation="bottom"
              count={compact ? 3 : 5}
              label={`${riskySymbol} still on offer`}
            />
            <Axis geometry={geometry} scale={y} orientation="left" count={4} />
            <text
              x={geometry.inner.x}
              y={geometry.inner.y - 5}
              fontFamily={FONT_STACK.sans}
              fontSize={12}
              fill={color('ink-3')}
            >
              {stableSymbol} taken in
            </text>
          </>
        );
      }}
    </ChartFrame>
  );
}

/**
 * Where the gap is, and how big, at a scale that cannot draw it.
 *
 * A hairline from the reserve point out to a figure in the gap's own colour. It reads as an
 * annotation — the leader has no scale and the number is the measurement — rather than as a wedge
 * drawn at a size it does not have.
 */
function GapCallout({
  cx,
  cy,
  geometry,
  label,
}: {
  cx: number;
  cy: number;
  geometry: ChartGeometry;
  label: string;
}) {
  const width = estimateMonoTextWidth(label, 12);
  const flip = cx + 14 + width > geometry.inner.x + geometry.inner.width;
  const tx = flip ? cx - 14 : cx + 14;
  const ty = Math.max(geometry.inner.y + 10, cy - 18);

  return (
    <g aria-hidden="true">
      <line x1={cx} y1={cy} x2={tx} y2={ty + 4} stroke={color('warn')} strokeWidth={1} opacity={0.75} />
      <text
        x={tx + (flip ? -4 : 4)}
        y={ty}
        textAnchor={flip ? 'end' : 'start'}
        fontFamily={FONT_STACK.mono}
        fontSize={12}
        fill={color('warn')}
        style={{ fontVariantNumeric: 'tabular-nums slashed-zero' }}
      >
        {label}
      </text>
    </g>
  );
}

/** Where the offer sits now: an accent dot with a surface ring so it reads over the line. */
function ReserveDot({ cx, cy }: { cx: number; cy: number }) {
  return (
    <circle
      cx={round(cx)}
      cy={round(cy)}
      r={5}
      fill={color('accent')}
      stroke={color('surface')}
      strokeWidth={2}
    />
  );
}

/** A trade that happened: an open square, so it never reads as another reserve point. */
function FillDot({ cx, cy }: { cx: number; cy: number }) {
  return (
    <rect
      x={round(cx - 6.5)}
      y={round(cy - 6.5)}
      width={13}
      height={13}
      fill="none"
      stroke={color('pos')}
      strokeWidth={1.5}
    />
  );
}

function Legend({ scrubbed, hasFills }: { scrubbed: boolean; hasFills: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-mini text-ink-3">
      <span className="inline-flex items-center gap-1.5">
        <svg width={16} height={8} aria-hidden="true">
          <line x1={0} y1={4} x2={16} y2={4} stroke={color('accent')} strokeWidth={2} />
        </svg>
        {scrubbed ? 'At that time' : 'Now'}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width={16} height={8} aria-hidden="true">
          <line
            x1={0}
            y1={4}
            x2={16}
            y2={4}
            stroke={color('ink-3')}
            strokeWidth={1.5}
            strokeDasharray="4.5 3.4"
          />
        </svg>
        On its date
      </span>
      {hasFills ? (
        <span className="inline-flex items-center gap-1.5">
          <svg width={11} height={11} aria-hidden="true">
            <rect x={0.75} y={0.75} width={9} height={9} fill="none" stroke={color('pos')} strokeWidth={1.5} />
          </svg>
          A trade
        </span>
      ) : null}
    </span>
  );
}

/**
 * The chart's accessible twin.
 *
 * The line is subsampled to nine rows, because a hundred is not a reading; the reserve point and
 * every trade are listed in full, since those are the values a reader would otherwise have to
 * hover to reach.
 */
function ValuesTable({
  live,
  reserve,
  fills,
  riskySymbol,
  stableSymbol,
}: {
  live: readonly CurveSample[];
  reserve?: ReservePoint;
  fills: readonly FillMarker[];
  riskySymbol: string;
  stableSymbol: string;
}) {
  const step = Math.max(1, Math.floor(live.length / 8));
  const rows = live.filter((_, i) => i % step === 0 || i === live.length - 1);

  return (
    <table className="w-full min-w-[26rem] border-collapse text-meta">
      <caption className="sr-only">
        Points on the curve, where the offer sits now, and every trade against it
      </caption>
      <thead>
        <tr className="border-b border-line-strong text-left text-mini text-ink-2">
          <th scope="col" className="py-2 pr-3 font-medium">
            Point
          </th>
          <th scope="col" className="py-2 pr-3 text-right font-medium">
            {riskySymbol} on offer
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            {stableSymbol} taken in
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((sample) => (
          <Row
            key={sample.xWad.toString()}
            label="Curve"
            x={sample.x}
            y={sample.y}
          />
        ))}
        {reserve ? <Row label="Where it sits now" x={reserve.x} y={reserve.y} strong /> : null}
        {fills.map((fill) => (
          <Row key={fill.id} label={fill.label} x={fill.x} y={fill.y} />
        ))}
      </tbody>
    </table>
  );
}

function Row({ label, x, y, strong }: { label: string; x: number; y: number; strong?: boolean }) {
  return (
    <tr className={`border-b border-line ${strong ? 'bg-accent-soft' : ''}`}>
      <td className="py-1.5 pr-3 text-ink-2">{label}</td>
      <td className="py-1.5 pr-3 text-right font-mono tnum text-ink">{formatChartNumber(x)}</td>
      <td className="py-1.5 text-right font-mono tnum text-ink">{formatChartNumber(y)}</td>
    </tr>
  );
}
