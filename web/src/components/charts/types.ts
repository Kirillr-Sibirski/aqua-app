/**
 * Shared shapes for the chart layer.
 *
 * The whole library is hand-rolled SVG over `d3-scale` and `d3-shape`. There is no charting
 * component library underneath, so nothing arrives pre-styled and there is no default look to
 * fight. Colour always arrives as a design token name, never as a literal, so `scripts/contrast.mjs`
 * stays the single audit of every pixel that carries meaning.
 */
import type { ScaleBand, ScaleContinuousNumeric } from 'd3-scale';
import type { ColorToken } from '@/lib/ui/tokens';

/** Any numeric d3 scale: linear, log, pow, sqrt, time. */
export type ContinuousScale = ScaleContinuousNumeric<number, number>;

/** The categorical scale used by {@link BarsProps}. */
export type BandScale = ScaleBand<string>;

/** Either kind, for components that draw an axis or a grid against whatever they are handed. */
export type AnyScale = ContinuousScale | BandScale;

/** True for a band scale. The only runtime discriminator d3 gives us. */
export function isBandScale(scale: AnyScale): scale is BandScale {
  return typeof (scale as BandScale).bandwidth === 'function';
}

/** Reserved space around the plot, in px. Axis bands live here. */
export interface ChartMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A rectangle in SVG user units, `x`/`y` being its top-left corner. */
export interface ChartRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What `ChartFrame` measures and hands to every mark.
 *
 * `width`/`height` are the whole SVG box. `inner` is the plot rect that remains once the margins
 * have taken their share, so a fixed `height` always includes the x-axis band and a card can never
 * end up with a nested scrollbar.
 */
export interface ChartGeometry {
  width: number;
  height: number;
  margin: ChartMargin;
  inner: ChartRect;
  /** `id` of the `<clipPath>` that `ChartFrame` renders for the plot rect. See `PlotArea`. */
  clipId: string;
}

/** A sampled or measured point in domain space. */
export interface ChartPoint {
  x: number;
  y: number;
}

/** Stroke treatment. Solid means "measured"; dashed means "reference, hypothetical or projected". */
export type DashStyle = 'solid' | 'dashed' | 'dotted';

/**
 * `stroke-dasharray` for a dash style, scaled to the stroke width so a 1px hairline and a 2px
 * series line read as the same pattern. Returns `undefined` for `solid`.
 */
export function dashArray(style: DashStyle, strokeWidth: number): string | undefined {
  if (style === 'solid') return undefined;
  if (style === 'dotted') return `0 ${round(strokeWidth * 2.4)}`;
  return `${round(strokeWidth * 3)} ${round(strokeWidth * 2.25)}`;
}

/** `stroke-linecap` that makes `dotted` render as dots rather than as nothing. */
export function dashCap(style: DashStyle): 'round' | 'butt' {
  return style === 'dotted' ? 'round' : 'butt';
}

/** Two decimals is below a device pixel at any sane DPR and keeps path strings short. */
export function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Colour roles a mark can take. Re-exported so a mark's props never mention a literal. */
export type { ColorToken };
