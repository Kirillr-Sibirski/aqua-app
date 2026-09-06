/**
 * The wash under a curve: the same series hue at ~10% so it reads as region, not as block.
 *
 * It shares `CurveSource` with `CurveLine`, so a chart draws the fill and the line from one set of
 * samples and the two can never disagree. Pair them; a fill on its own has no crisp edge to read.
 */
import { area as d3area, curveLinear, type CurveFactory } from 'd3-shape';
import { colorMix } from '@/lib/ui/tokens';
import { sampleCurve } from './geometry';
import type { CurveSource } from './CurveLine';
import type { ChartPoint, ColorToken, ContinuousScale } from './types';

export type AreaFillProps = CurveSource & {
  xScale: ContinuousScale;
  yScale: ContinuousScale;
  /**
   * Domain value the fill runs back to. Defaults to zero when the y domain contains it, otherwise
   * to the bottom of the domain, so a price chart fills down and a PnL chart fills to its baseline.
   */
  baseline?: number;
  /** Default `'accent'`. */
  fill?: ColorToken;
  /** Percent of the token that survives the mix with transparent. Default 10. */
  tint?: number;
  curve?: CurveFactory;
  className?: string;
};

export function AreaFill({
  xScale,
  yScale,
  baseline,
  fill = 'accent',
  tint = 10,
  curve = curveLinear,
  className,
  ...source
}: AreaFillProps) {
  const points = source.points ?? sampleCurve(source.fn, source.domain, source.samples);

  const [lo, hi] = yScale.domain() as [number, number];
  const min = Math.min(lo, hi);
  const max = Math.max(lo, hi);
  const y0 = baseline ?? (min <= 0 && max >= 0 ? 0 : min);

  const path = d3area<ChartPoint>()
    .defined((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .x((p) => xScale(p.x))
    .y0(yScale(y0))
    .y1((p) => yScale(p.y))
    .curve(curve)(points);

  if (!path) return null;

  return <path className={className} d={path} fill={colorMix(fill, tint)} stroke="none" />;
}
