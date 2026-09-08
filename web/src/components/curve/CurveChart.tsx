'use client';

/**
 * The trading curve `Y(X)`, drawn from samples the router returned.
 *
 * Four things are on it, and each answers a different question:
 *
 *  - the **live curve**, where a trade would clear right now;
 *  - the **settlement line** `Y = K*(L - X)`, ghosted, which the live curve becomes at `tau = 0` —
 *    the same 62 bytes, in closed form, with no Gaussian and no oracle;
 *  - the **theta band**, the wedge between the stale reserve point and the curve that has moved
 *    away from it. Nothing happened on chain to open it. Whoever crosses it pays the maker;
 *  - the **reserve point** and the **fills** that walked it there, replayed from Aqua's own ledger.
 *
 * Not on it: anything computed from a model. The curve's shape comes from `stableFor`, the band's
 * size from `bandFor`, and the points from `Pushed`/`Pulled`.
 */
import { useMemo, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import { line as d3line, curveLinear } from 'd3-shape';
import { Axis } from '@/components/charts/Axis';
import { ChartFrame, PlotArea, type ChartState } from '@/components/charts/ChartFrame';
import { CurveLine } from '@/components/charts/CurveLine';
import { Grid } from '@/components/charts/Grid';
import { formatChartNumber } from '@/components/charts/format';
import { round, type ChartPoint } from '@/components/charts/types';
import {
  SegmentedControl,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui';
import { color, colorMix, FONT_STACK } from '@/lib/ui/tokens';
import type { CurveSample } from '@/hooks/useCurveSamples';

export interface ReservePoint {
  x: number;
  y: number;
}

export interface BandCorner {
  /** Where the curve says the stable reserve should be, at the live risky reserve. */
  yOnCurve: number;
  /** Where it says the risky reserve should be, at the live stable reserve. */
  xOnCurve: number;
}

export interface FillMarker {
  id: string;
  x: number;
  y: number;
  /** One line for the values table: what moved, and which way. */
  label: string;
}

export interface CurveChartProps {
  /** Samples at the position the scrubber is on. */
  live: readonly CurveSample[];
  /** Samples at `tau = 0`. Drawn ghosted, and used as the y-domain anchor so it never rescales. */
  settlement: readonly CurveSample[];
  reserve?: ReservePoint;
  band?: BandCorner;
  fills?: readonly FillMarker[];
  riskySymbol: string;
  stableSymbol: string;
  /** Caption line under the title: the tau the live curve was sampled at. */
  subtitle?: React.ReactNode;
  /** True while the live curve is at a synthetic maturity, so the legend can say so. */
  scrubbed?: boolean;
  state?: ChartState;
  errorMessage?: string;
  height?: number;
}

const MARGIN = { top: 14, right: 20, bottom: 34, left: 68 };

/** A theta wedge thinner than this many pixels is not a mark; the legend must not claim it is. */
const WEDGE_VISIBLE_PX = 2;

/** How much of the full risky range the zoomed view keeps either side of what it has to contain. */
const ZOOM_PAD = 0.06;

/** Breathing room around the wedge in the band window, as a fraction of the wedge's own size. */
const BAND_PAD = 0.35;

function toPoints(samples: readonly CurveSample[]): ChartPoint[] {
  return samples.map((s) => ({ x: s.x, y: s.y }));
}

export function CurveChart({
  live,
  settlement,
  reserve,
  band,
  fills = [],
  riskySymbol,
  stableSymbol,
  subtitle,
  scrubbed = false,
  state = 'ready',
  errorMessage,
  height = 320,
}: CurveChartProps) {
  const livePoints = useMemo(() => toPoints(live), [live]);
  const settlementPoints = useMemo(() => toPoints(settlement), [settlement]);
  const [zoom, setZoom] = useState<Zoom>('full');

  // The settlement line runs from (0, L*K) to (L, 0) and always contains the live curve, so
  // anchoring the domains to it keeps the axes still while the scrubber moves.
  const anchor = settlementPoints.length > 0 ? settlementPoints : livePoints;
  const maxX = anchor.reduce((m, p) => Math.max(m, p.x), 0);
  const maxY = anchor.reduce((m, p) => Math.max(m, p.y), 0);

  const empty = livePoints.length === 0 && settlementPoints.length === 0;
  const resolvedState: ChartState = state === 'ready' && empty ? 'empty' : state;

  // Both sides of the wedge, in reserve units. `bandFor` returns zero on whichever side the curve
  // has not moved away from yet, and a window built on a zero extent has no scale to draw at.
  const bandDx = band && reserve ? band.xOnCurve - reserve.x : 0;
  const bandDy = band && reserve ? band.yOnCurve - reserve.y : 0;

  const canZoom = Boolean(reserve) && maxX > 0 && maxY > 0;
  const canZoomBand = canZoom && bandDx > 0 && bandDy > 0;
  // The band scale can disappear underneath a selection -- a fill lands, the reserves snap back to
  // the curve, and there is no wedge left to scale to -- so the rendered scale is derived rather
  // than trusted, and falls back to the whole curve instead of drawing a window of nothing.
  const scale: Zoom = zoom === 'band' && !canZoomBand ? 'full' : canZoom ? zoom : 'full';
  const atBand = scale === 'band';
  const zoomed = scale === 'reserve';
  const domain = useMemo(
    () =>
      reserve && band && scale === 'band'
        ? bandWindow(reserve, band)
        : reserve && scale === 'reserve'
          ? reserveWindow({ live: livePoints, settlement: settlementPoints, reserve, band, maxX, maxY })
          : { x: [0, maxX || 1] as const, y: [0, maxY || 1] as const },
    [scale, reserve, band, livePoints, settlementPoints, maxX, maxY],
  );

  // The wedge in pixels, not in reserve units. On a full-range y-domain of 0..L*K the band right
  // after a ship is a few thousandths of one percent of the range, so the legend used to advertise
  // an ochre swatch pointing at a path with a 0x0 bounding box. Measured here rather than guessed:
  // this is the same domain the marks are drawn against.
  const plotHeight = height - MARGIN.top - MARGIN.bottom;
  const wedgePx = band && reserve ? (bandDy / (domain.y[1] - domain.y[0] || 1)) * plotHeight : 0;
  const wedgeVisible = Boolean(band) && wedgePx >= WEDGE_VISIBLE_PX;

  // How far the band window is blown up past the whole curve, for the caption. One number, because
  // both axes are windowed on the same wedge with the same padding.
  const magnification = atBand ? maxY / (domain.y[1] - domain.y[0] || 1) : 0;

  return (
    <ChartFrame
      title="How this offer prices a trade"
      description={`${stableSymbol} against ${riskySymbol} for this offer. The solid line is where a trade clears ${scrubbed ? 'at the time you dragged to' : 'right now'}, the dashed line is what the offer becomes on the date it runs to, and the shaded wedge is the gap a buyer has to cross to reach it. X runs from 0 to ${formatChartNumber(maxX)} ${riskySymbol}; Y from 0 to ${formatChartNumber(maxY)} ${stableSymbol}.`}
      subtitle={subtitle}
      height={height}
      margin={MARGIN}
      state={resolvedState}
      errorMessage={errorMessage}
      emptyMessage="The router returned no curve samples for this leg."
      legend={<Legend scrubbed={scrubbed} hasBand={wedgeVisible} hasSettlement={!atBand} />}
      actions={
        canZoom ? (
          <SegmentedControl
            label="Scale"
            size="sm"
            items={[
              { value: 'full', label: 'Whole offer' },
              { value: 'reserve', label: 'Where it sits now' },
              {
                value: 'band',
                label: 'The gap, to scale',
                disabled: !canZoomBand,
                disabledReason:
                  'The price has not moved off the reserve point yet, so there is no gap to scale to.',
              },
            ]}
            value={scale}
            onValueChange={(next) => setZoom(next as Zoom)}
          />
        ) : undefined
      }
      footnote={
        atBand ? (
          <>
            The same wedge, blown up about{' '}
            <span className="font-mono tnum">
              {formatChartNumber(magnification, { significantDigits: 2 })}×
            </span>{' '}
            so it is a mark rather than a rounding error. Its three corners are chain reads: the
            reserve point from Aqua&rsquo;s ledger, the two others from{' '}
            <span className="font-mono">bandFor</span>. Across a span this narrow the curve between
            them is straight to a billionth of a {stableSymbol}, so the sampled polyline and the
            expiry line are left off rather than drawn at a resolution they do not have.
          </>
        ) : (
          <>
            {band && reserve && !wedgeVisible ? (
              <>
                The gap here is{' '}
                <span className="font-mono tnum">
                  {formatChartNumber(bandDy, { significantDigits: 3, maxFractionDigits: 6 })}{' '}
                  {stableSymbol}
                </span>
                , under one pixel at this scale, so it is marked rather than drawn to size and the
                legend does not claim it.{' '}
                {canZoomBand
                  ? 'Switch the scale to "The gap, to scale" to see it, or scrub'
                  : 'Scrub'}{' '}
                toward expiry to watch it open.{' '}
              </>
            ) : null}
            Every point is a <span className="font-mono">stableFor</span> call into the router, sampled over
            one multicall. No curve maths runs in the browser.
            {zoomed ? ' The axes are windowed on the reserve point and do not start at zero.' : null}
          </>
        )
      }
      table={
        <ValuesTable
          live={live}
          reserve={reserve}
          band={band}
          fills={fills}
          riskySymbol={riskySymbol}
          stableSymbol={stableSymbol}
        />
      }
      tableLabel="the sampled points"
    >
      {(geometry) => {
        const x = scaleLinear()
          .domain([domain.x[0], domain.x[1]])
          .range([geometry.inner.x, geometry.inner.x + geometry.inner.width]);
        const y = scaleLinear()
          .domain([domain.y[0], domain.y[1]])
          .range([geometry.inner.y + geometry.inner.height, geometry.inner.y]);
        const compact = geometry.inner.width < 380;

        return (
          <>
            <Grid geometry={geometry} yScale={y} xScale={x} lines="both" />

            <PlotArea geometry={geometry}>
              {band && reserve ? (
                <ThetaWedge
                  points={livePoints}
                  reserve={reserve}
                  band={band}
                  xScale={x}
                  yScale={y}
                />
              ) : null}

              {/* At band scale the 48-point polyline is a chain of secants whose sag between two
                  neighbouring samples is several times the whole wedge, so drawing it here would
                  put the "curve" visibly off the corners it is supposed to pass through. The two
                  corners ARE the curve at this width, to a billionth of a stable unit; that segment
                  is the wedge's own top edge, already drawn above. Same for the settlement line,
                  which is hundreds of units away and would only be a stripe along one edge. */}
              {!atBand && settlementPoints.length > 0 ? (
                <CurveLine
                  points={settlementPoints}
                  xScale={x}
                  yScale={y}
                  stroke="ink-3"
                  strokeWidth={1.5}
                  dash="dashed"
                />
              ) : null}

              {!atBand && livePoints.length > 0 ? (
                <CurveLine points={livePoints} xScale={x} yScale={y} stroke="accent" strokeWidth={2} />
              ) : null}

              {atBand && band && reserve ? (
                <CurveLine
                  points={[
                    { x: reserve.x, y: band.yOnCurve },
                    { x: band.xOnCurve, y: reserve.y },
                  ]}
                  xScale={x}
                  yScale={y}
                  stroke="accent"
                  strokeWidth={2}
                />
              ) : null}

              {fills.map((fill) => (
                <FillDot key={fill.id} cx={x(fill.x)} cy={y(fill.y)} />
              ))}

              {reserve ? <ReserveDot cx={x(reserve.x)} cy={y(reserve.y)} /> : null}
            </PlotArea>

            {/* The wedge exists but is under a pixel: mark where it is and say how big, rather than
                draw a mark whose size would be a lie. The label is the same figure the footnote and
                the terms rail print, so the annotation adds a position, not a number. */}
            {band && reserve && !wedgeVisible && bandDy > 0 ? (
              <BandCallout
                cx={x(reserve.x)}
                cy={y(reserve.y)}
                geometry={geometry}
                label={`${formatChartNumber(bandDy, { significantDigits: 3, maxFractionDigits: 6 })} ${stableSymbol}`}
              />
            ) : null}

            {/* Below ~380px the unit doubles every label's width and the axis smears. It moves to
                the axis name, which is said once. The band window's ticks carry six or seven
                decimals, which is wide enough that the unit has to move for the same reason. */}
            <Axis
              geometry={geometry}
              scale={x}
              orientation="bottom"
              count={compact || atBand ? 3 : 5}
              unit={compact ? undefined : riskySymbol}
              label={compact ? riskySymbol : undefined}
            />
            <Axis geometry={geometry} scale={y} orientation="left" count={4} />
            <text
              x={geometry.inner.x}
              y={geometry.inner.y - 4}
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

type Zoom = 'full' | 'reserve' | 'band';

/**
 * Axis domains windowed on the theta band itself.
 *
 * The reserve window below is 12% of the risky range wide, which is four orders of magnitude more
 * than the wedge on a freshly shipped leg: measured on the demo leg, the wedge's bounding box came
 * out 0.02 x 0.01 CSS pixels there, and 0 x 0 on the full curve. Nothing short of scaling to the
 * wedge's own size shows it, so this window is built from the wedge and nothing else -- the three
 * corners plus a third of their own span as air.
 */
function bandWindow(
  reserve: ReservePoint,
  band: BandCorner,
): { x: readonly [number, number]; y: readonly [number, number] } {
  const dx = band.xOnCurve - reserve.x;
  const dy = band.yOnCurve - reserve.y;
  const padX = dx * BAND_PAD;
  const padY = dy * BAND_PAD;
  return {
    x: [Math.max(0, reserve.x - padX), band.xOnCurve + padX] as const,
    y: [Math.max(0, reserve.y - padY), band.yOnCurve + padY] as const,
  };
}

/**
 * Axis domains windowed on the reserve point.
 *
 * The full range is 0..L on x and 0..L*K on y, and the RMM curvature is about 3% of that: on a
 * 320px plot the whole mechanism is eight pixels of bow, and the gap between now and expiry — the
 * thing the screen exists to show — is invisible. This keeps the reserve point, both band corners
 * and enough curve either side to read the shape, and lets the axis labels say the rest.
 */
function reserveWindow({
  live,
  settlement,
  reserve,
  band,
  maxX,
  maxY,
}: {
  live: readonly ChartPoint[];
  settlement: readonly ChartPoint[];
  reserve: ReservePoint;
  band?: BandCorner;
  maxX: number;
  maxY: number;
}): { x: readonly [number, number]; y: readonly [number, number] } {
  const padX = maxX * ZOOM_PAD;
  const lo = Math.max(0, Math.min(reserve.x, band?.xOnCurve ?? reserve.x) - padX);
  const hi = Math.min(maxX, Math.max(reserve.x, band?.xOnCurve ?? reserve.x) + padX);

  const inWindow = [...live, ...settlement].filter((p) => p.x >= lo && p.x <= hi);
  const ys = [reserve.y, ...(band ? [band.yOnCurve] : []), ...inWindow.map((p) => p.y)];
  const yLo = Math.min(...ys);
  const yHi = Math.max(...ys);
  // A floor on the y span, so a band of a few wei does not blow the axis up into pure rounding.
  const padY = Math.max((yHi - yLo) * 0.15, maxY * 1e-4);

  return {
    x: [lo, hi] as const,
    y: [Math.max(0, yLo - padY), Math.min(maxY, yHi + padY)] as const,
  };
}

/**
 * The decay wedge.
 *
 * Bounded below by the reserve point's own stable level, on the left by its risky level, and above
 * by the curve, which at the live risky reserve now requires `y + minStableIn` and at
 * `x + minRiskyIn` has fallen back to the live stable reserve. Those two corners come from
 * `bandFor`, so the wedge is pinned to the chain's numbers and only its interior is drawn from
 * samples.
 */
function ThetaWedge({
  points,
  reserve,
  band,
  xScale,
  yScale,
}: {
  points: readonly ChartPoint[];
  reserve: ReservePoint;
  band: BandCorner;
  xScale: (v: number) => number;
  yScale: (v: number) => number;
}) {
  const interior = points.filter((p) => p.x > reserve.x && p.x < band.xOnCurve);
  const outline: ChartPoint[] = [
    { x: reserve.x, y: reserve.y },
    { x: reserve.x, y: band.yOnCurve },
    ...interior,
    { x: band.xOnCurve, y: reserve.y },
  ];

  if (band.xOnCurve <= reserve.x && band.yOnCurve <= reserve.y) return null;

  const path = d3line<ChartPoint>()
    .x((p) => xScale(p.x))
    .y((p) => yScale(p.y))
    .curve(curveLinear)(outline);
  if (!path) return null;

  return (
    <g>
      <path d={`${path}Z`} fill={colorMix('warn', 16)} stroke="none" />
      <path d={path} fill="none" stroke={color('warn')} strokeWidth={1} opacity={0.7} />
    </g>
  );
}

/**
 * Where the wedge is, and how big, when it is too small to draw.
 *
 * A leg that shipped a minute ago has a band of a couple of cents against a y-range of thousands,
 * so the honest mark is no mark. That left the one thing the screen exists to show with nothing on
 * the plot pointing at it at all. This points: a hairline from the reserve point out to a figure in
 * the band's own colour. It is an annotation and reads as one -- the leader has no scale and the
 * number is the measurement -- rather than a wedge drawn at a size it does not have.
 */
function BandCallout({
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
  // Up and to the right of the reserve dot, which is the direction the wedge opens in; flipped to
  // the left when the point sits near the right edge, so the figure never leaves the plot.
  const flip = cx + 14 + width > geometry.inner.x + geometry.inner.width;
  const tx = flip ? cx - 14 : cx + 14;
  const ty = Math.max(geometry.inner.y + 10, cy - 16);

  return (
    <g aria-hidden="true">
      <line x1={cx} y1={cy} x2={tx} y2={ty + 4} stroke={color('warn')} strokeWidth={1} opacity={0.7} />
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

/** The live reserve point: an accent dot with a surface ring so it reads over the curve. */
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

/** A realised fill: a hollow square, so it never reads as another reserve point. */
function FillDot({ cx, cy }: { cx: number; cy: number }) {
  return (
    <rect
      x={round(cx - 3.5)}
      y={round(cy - 3.5)}
      width={7}
      height={7}
      fill={color('surface')}
      stroke={color('pos')}
      strokeWidth={1.5}
    />
  );
}

function Legend({
  scrubbed,
  hasBand,
  hasSettlement,
}: {
  scrubbed: boolean;
  hasBand: boolean;
  hasSettlement: boolean;
}) {
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-mini text-ink-3">
      <LegendItem>
        <svg width={16} height={8} aria-hidden="true">
          <line x1={0} y1={4} x2={16} y2={4} stroke={color('accent')} strokeWidth={2} />
        </svg>
        {scrubbed ? 'At that time' : 'Now'}
      </LegendItem>
      {/* Only when it is on the plot. At band scale the settlement line is hundreds of stable units
          away, off every edge of the window, and a legend entry for it would be the same lie the
          band swatch used to tell in the other direction. */}
      {hasSettlement ? (
        <LegendItem>
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
        </LegendItem>
      ) : null}
      {hasBand ? (
        <LegendItem>
          <svg width={16} height={8} aria-hidden="true">
            <rect width={16} height={8} fill={colorMix('warn', 16)} stroke={color('warn')} strokeWidth={1} />
          </svg>
          <span title={scrubbed ? 'Theta band at that time' : 'Theta band'}>
            {scrubbed ? 'Minimum trade then' : 'Minimum trade'}
          </span>
        </LegendItem>
      ) : null}
    </span>
  );
}

function LegendItem({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5">{children}</span>;
}

/**
 * The chart's accessible twin.
 *
 * The curve is subsampled to nine rows, because a hundred is not a reading; the reserve point, the
 * band corners and every fill are listed in full, since those are the values a maker would
 * otherwise have to hover to reach.
 */
function ValuesTable({
  live,
  reserve,
  band,
  fills,
  riskySymbol,
  stableSymbol,
}: {
  live: readonly CurveSample[];
  reserve?: ReservePoint;
  band?: BandCorner;
  fills: readonly FillMarker[];
  riskySymbol: string;
  stableSymbol: string;
}) {
  const step = Math.max(1, Math.floor(live.length / 8));
  const rows = live.filter((_, i) => i % step === 0 || i === live.length - 1);

  return (
    <Table caption="Sampled curve points, where the offer sits now, and every trade" hideCaption minWidth="30rem">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Point</TableHeaderCell>
          <TableHeaderCell numeric>X ({riskySymbol})</TableHeaderCell>
          <TableHeaderCell numeric>Y ({stableSymbol})</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((sample) => (
          <TableRow key={sample.xWad.toString()}>
            <TableCell>Curve</TableCell>
            <TableCell numeric>{formatChartNumber(sample.x)}</TableCell>
            <TableCell numeric>{formatChartNumber(sample.y)}</TableCell>
          </TableRow>
        ))}
        {reserve ? (
          <TableRow highlighted>
            <TableCell>Where it sits now</TableCell>
            <TableCell numeric>{formatChartNumber(reserve.x)}</TableCell>
            <TableCell numeric>{formatChartNumber(reserve.y)}</TableCell>
          </TableRow>
        ) : null}
        {band ? (
          <TableRow>
            <TableCell>Minimum trade corners</TableCell>
            <TableCell numeric>{formatChartNumber(band.xOnCurve)}</TableCell>
            <TableCell numeric>{formatChartNumber(band.yOnCurve)}</TableCell>
          </TableRow>
        ) : null}
        {fills.map((fill) => (
          <TableRow key={fill.id}>
            <TableCell>{fill.label}</TableCell>
            <TableCell numeric>{formatChartNumber(fill.x)}</TableCell>
            <TableCell numeric>{formatChartNumber(fill.y)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
