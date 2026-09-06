/**
 * The core mark: a pricing curve, drawn from the function that defines it.
 *
 * A position's curve is not a table of points; it is `y = f(x)` for whatever invariant the strategy
 * encodes. So `CurveLine` takes the function itself, samples it across the domain, and draws the
 * result. Swap a constant-product hyperbola for a concentrated-liquidity payoff or a decayed
 * quote and nothing else about the chart changes.
 *
 * Samples that come back non-finite (the asymptote as a reserve approaches zero, a `NaN` from a
 * root outside its branch) break the path instead of being clamped, and the whole mark is meant to
 * sit inside `PlotArea` so a curve leaving the y domain is clipped rather than flattened.
 */
import { line as d3line, curveLinear, type CurveFactory } from 'd3-shape';
import { color } from '@/lib/ui/tokens';
import { sampleCurve } from './geometry';
import {
  dashArray,
  dashCap,
  round,
  type ChartPoint,
  type ColorToken,
  type ContinuousScale,
  type DashStyle,
} from './types';

/** Either the function and the interval to sample it over, or points you already have. */
export type CurveSource =
  | {
      /** Evaluated at `samples` points across `domain`. Must be pure: it runs on every resize. */
      fn: (x: number) => number;
      domain: readonly [number, number];
      /** Default 160. Clamped to 2..2000. */
      samples?: number;
      points?: undefined;
    }
  | {
      /** Already-measured series, in ascending `x`. */
      points: readonly ChartPoint[];
      fn?: undefined;
      domain?: undefined;
      samples?: undefined;
    };

export type CurveLineProps = CurveSource & {
  xScale: ContinuousScale;
  yScale: ContinuousScale;
  /** Default `'accent'`, the one hue reserved for your position. */
  stroke?: ColorToken;
  /** Default 2px, the series-line spec. Context and reference lines use 1.5. */
  strokeWidth?: number;
  /** Solid means measured. Dashed means hypothetical: a HODL baseline, a projection. */
  dash?: DashStyle;
  /** Default `curveLinear`. At 160 samples a straight interpolation is the honest one. */
  curve?: CurveFactory;
  opacity?: number;
  /** An 8px dot with a 2px surface ring at the last finite sample. */
  endDot?: boolean;
  /** Colour of the end dot's ring. Match the chart's background. Default `'surface'`. */
  ringColor?: ColorToken;
  className?: string;
};

/** Resolve either source form into points. Exported so a page can reuse the same samples. */
export function curvePoints(source: CurveSource): readonly ChartPoint[] {
  if (source.points) return source.points;
  return sampleCurve(source.fn, source.domain, source.samples);
}

export function CurveLine({
  xScale,
  yScale,
  stroke = 'accent',
  strokeWidth = 2,
  dash = 'solid',
  curve = curveLinear,
  opacity,
  endDot = false,
  ringColor = 'surface',
  className,
  ...source
}: CurveLineProps) {
  const points = curvePoints(source as CurveSource);

  const path = d3line<ChartPoint>()
    .defined((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .x((p) => xScale(p.x))
    .y((p) => yScale(p.y))
    .curve(curve)(points);

  if (!path) return null;

  let last: ChartPoint | undefined;
  if (endDot) {
    for (let i = points.length - 1; i >= 0; i -= 1) {
      if (Number.isFinite(points[i].y)) {
        last = points[i];
        break;
      }
    }
  }

  return (
    <g className={className}>
      <path
        d={path}
        fill="none"
        stroke={color(stroke)}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap={dashCap(dash)}
        strokeDasharray={dashArray(dash, strokeWidth)}
        opacity={opacity}
      />
      {last ? (
        <circle
          cx={round(xScale(last.x))}
          cy={round(yScale(last.y))}
          r={4}
          fill={color(stroke)}
          stroke={color(ringColor)}
          strokeWidth={2}
        />
      ) : null}
    </g>
  );
}
