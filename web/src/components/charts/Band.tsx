/**
 * A shaded interval along one axis: the price range a concentrated position is active in, a
 * bounds pair, a window under review.
 *
 * The fill is the accent at 14% and the two boundaries carry `--accent-dim` hairlines, so the band
 * has readable edges without a border around a mark. An edge that falls outside the plot is not
 * drawn, which is how a reader tells "the range starts here" from "the range continues past the
 * left of this view".
 */
import { color, colorMix, FONT_STACK } from '@/lib/ui/tokens';
import { clamp, estimateMonoTextWidth } from './geometry';
import { round, type ChartGeometry, type ColorToken, type ContinuousScale } from './types';

export interface BandProps {
  geometry: ChartGeometry;
  scale: ContinuousScale;
  /** Interval in domain units. Order does not matter. */
  from: number;
  to: number;
  /** `'x'` shades a vertical slab (a price range); `'y'` shades a horizontal one. Default `'x'`. */
  orientation?: 'x' | 'y';
  /** Default `'accent'`. */
  fill?: ColorToken;
  /** Percent of `fill` that survives the mix with transparent. Default 14. */
  tint?: number;
  /** Hairlines at the two boundaries. Default true. */
  edges?: boolean;
  /** Default `'accent-dim'`. */
  edgeColor?: ColorToken;
  /** Short mono label pinned inside the band at its leading edge. */
  label?: string;
  /** Default `'ink-2'`. Text never wears the series hue. */
  labelColor?: ColorToken;
  className?: string;
}

export function Band({
  geometry,
  scale,
  from,
  to,
  orientation = 'x',
  fill = 'accent',
  tint = 14,
  edges = true,
  edgeColor = 'accent-dim',
  label,
  labelColor = 'ink-2',
  className,
}: BandProps) {
  const { inner } = geometry;
  const a = scale(Math.min(from, to));
  const b = scale(Math.max(from, to));
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);

  const axisMin = orientation === 'x' ? inner.x : inner.y;
  const axisMax = orientation === 'x' ? inner.x + inner.width : inner.y + inner.height;

  // Entirely outside the view: draw nothing rather than a zero-width sliver on the frame.
  if (hi < axisMin || lo > axisMax) return null;

  const start = clamp(lo, axisMin, axisMax);
  const end = clamp(hi, axisMin, axisMax);
  const size = Math.max(0, end - start);

  const rect =
    orientation === 'x'
      ? { x: round(start), y: inner.y, width: round(size), height: inner.height }
      : { x: inner.x, y: round(start), width: inner.width, height: round(size) };

  const fontSize = 12;
  const labelWidth = label ? estimateMonoTextWidth(label, fontSize) : 0;
  const labelFits = label ? size >= labelWidth + 12 : false;

  return (
    <g className={className}>
      <rect {...rect} fill={colorMix(fill, tint)} />
      {edges ? (
        <g shapeRendering="crispEdges">
          {lo >= axisMin ? (
            <line
              x1={orientation === 'x' ? round(lo) : inner.x}
              x2={orientation === 'x' ? round(lo) : inner.x + inner.width}
              y1={orientation === 'x' ? inner.y : round(lo)}
              y2={orientation === 'x' ? inner.y + inner.height : round(lo)}
              stroke={color(edgeColor)}
              strokeWidth={1}
            />
          ) : null}
          {hi <= axisMax ? (
            <line
              x1={orientation === 'x' ? round(hi) : inner.x}
              x2={orientation === 'x' ? round(hi) : inner.x + inner.width}
              y1={orientation === 'x' ? inner.y : round(hi)}
              y2={orientation === 'x' ? inner.y + inner.height : round(hi)}
              stroke={color(edgeColor)}
              strokeWidth={1}
            />
          ) : null}
        </g>
      ) : null}
      {/* A label that does not fit is dropped, never clipped. The legend and the readout carry it. */}
      {label && labelFits ? (
        <text
          x={orientation === 'x' ? round(start + 6) : inner.x + 6}
          y={orientation === 'x' ? inner.y + 6 : round(start + 6)}
          dy="0.71em"
          fontFamily={FONT_STACK.mono}
          fontSize={fontSize}
          fill={color(labelColor)}
          style={{ fontVariantNumeric: 'tabular-nums slashed-zero' }}
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}
