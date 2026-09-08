/**
 * Reference lines: the current price, the oracle price, a strike, a liquidation bound.
 *
 * The label is set in mono with a 4px halo in the surface colour (`paint-order: stroke`), which is
 * the SVG form of the 2px surface ring the mark spec asks for. No chip, no box, no border drawn
 * around a mark: the halo is what keeps the text legible where it crosses a curve.
 *
 * Two markers a few dollars apart would otherwise stack their labels on top of each other, so
 * {@link MarkerLayer} lays a set out with {@link dodge1d} and draws a leader line from any label it
 * had to move. Labels never overlap and are never clipped.
 */
import { color, FONT_STACK } from '@/lib/ui/tokens';
import { dodge1d, estimateMonoTextWidth } from './geometry';
import {
  dashArray,
  dashCap,
  round,
  type ChartGeometry,
  type ColorToken,
  type ContinuousScale,
  type DashStyle,
} from './types';

export interface MarkerProps {
  geometry: ChartGeometry;
  scale: ContinuousScale;
  /** Where the rule sits, in domain units. */
  value: number;
  /** `'x'` draws a vertical rule at an x value (the default); `'y'` a horizontal one. */
  orientation?: 'x' | 'y';
  /** Default `'ink-2'`. Reserve `'warn'` for a stale oracle, `'accent'` for your own price. */
  stroke?: ColorToken;
  /** Default `'dashed'`: a reference line is not a measurement. */
  dash?: DashStyle;
  strokeWidth?: number;
  label?: string;
  /** Default `'ink'`. Text never wears the mark colour. */
  labelColor?: ColorToken;
  /** Background the halo paints, so the label stays legible over marks. Default `'surface'`. */
  haloColor?: ColorToken;
  /** Which end of the rule the label sits at. Default `'start'` (the top, for an x marker). */
  labelSide?: 'start' | 'end';
  /**
   * Centre of the label along the axis, in px. Defaults to the rule position. `MarkerLayer` sets
   * this after dodging; a lone marker rarely needs it.
   */
  labelPosition?: number;
  fontSize?: number;
  className?: string;
}

const LABEL_INSET = 4;
/** How far into the margin the leader's elbow sits, between the plot edge and the label baseline. */
const LEADER_ELBOW = 5;

/**
 * The elbow that joins a dodged label back to the rule it belongs to.
 *
 * `MarkerLayer` slides overlapping labels apart along the axis; without a leader, a label that
 * moved 20px would read as belonging to its neighbour. Three points: up out of the plot edge,
 * across to the label's new centre, then a short stub to the text.
 */
function leaderPoints(
  labelAt: number,
  pos: number,
  cross: number,
  labelSide: 'start' | 'end',
): string {
  const direction = labelSide === 'start' ? -1 : 1;
  const elbow = cross + direction * LEADER_ELBOW;
  const stub = cross + direction * LABEL_INSET;
  return `${pos},${cross} ${pos},${elbow} ${labelAt},${elbow} ${labelAt},${stub}`;
}

export function Marker({
  geometry,
  scale,
  value,
  orientation = 'x',
  stroke = 'ink-2',
  dash = 'dashed',
  strokeWidth = 1,
  label,
  labelColor = 'ink',
  haloColor = 'surface',
  labelSide = 'start',
  labelPosition,
  fontSize = 12,
  className,
}: MarkerProps) {
  const { inner } = geometry;
  const at = scale(value);

  const axisMin = orientation === 'x' ? inner.x : inner.y;
  const axisMax = orientation === 'x' ? inner.x + inner.width : inner.y + inner.height;
  if (!Number.isFinite(at) || at < axisMin - 0.5 || at > axisMax + 0.5) return null;

  const pos = round(at);
  const labelAt = round(labelPosition ?? at);
  const moved = Math.abs(labelAt - pos) > 1;

  // The label rides just outside the plot on the chosen end, so it never sits on top of the curve.
  const crossStart = orientation === 'x' ? inner.y : inner.x;
  const crossEnd = orientation === 'x' ? inner.y + inner.height : inner.x + inner.width;
  const labelCross = labelSide === 'start' ? crossStart - LABEL_INSET : crossEnd + LABEL_INSET;

  const halfWidth = label ? estimateMonoTextWidth(label, fontSize) / 2 : 0;
  const anchor =
    labelAt - halfWidth < inner.x
      ? 'start'
      : labelAt + halfWidth > inner.x + inner.width
        ? 'end'
        : 'middle';

  return (
    <g className={className}>
      <line
        x1={orientation === 'x' ? pos : inner.x}
        x2={orientation === 'x' ? pos : inner.x + inner.width}
        y1={orientation === 'x' ? inner.y : pos}
        y2={orientation === 'x' ? inner.y + inner.height : pos}
        stroke={color(stroke)}
        strokeWidth={strokeWidth}
        strokeDasharray={dashArray(dash, Math.max(1.5, strokeWidth))}
        strokeLinecap={dashCap(dash)}
        shapeRendering={dash === 'solid' ? 'crispEdges' : undefined}
      />
      {/* Only drawn when dodging pulled the label off its rule, so it stays attached to its line. */}
      {label && moved && orientation === 'x' ? (
        <polyline
          points={leaderPoints(labelAt, pos, labelSide === 'start' ? crossStart : crossEnd, labelSide)}
          fill="none"
          stroke={color('line-strong')}
          strokeWidth={1}
        />
      ) : null}
      {label ? (
        <text
          x={orientation === 'x' ? labelAt : inner.x + inner.width}
          y={orientation === 'x' ? labelCross : pos}
          dy={orientation === 'x' ? (labelSide === 'start' ? '-0.1em' : '0.9em') : '-0.45em'}
          textAnchor={orientation === 'x' ? anchor : 'end'}
          fontFamily={FONT_STACK.mono}
          fontSize={fontSize}
          fill={color(labelColor)}
          stroke={color(haloColor)}
          strokeWidth={4}
          strokeLinejoin="round"
          paintOrder="stroke"
          style={{ fontVariantNumeric: 'tabular-nums slashed-zero' }}
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}

export interface MarkerSpec {
  /** Stable key. Use the thing the marker means, not its index. */
  id: string;
  value: number;
  label?: string;
  stroke?: ColorToken;
  labelColor?: ColorToken;
  dash?: DashStyle;
  strokeWidth?: number;
}

export interface MarkerLayerProps {
  geometry: ChartGeometry;
  scale: ContinuousScale;
  items: readonly MarkerSpec[];
  orientation?: 'x' | 'y';
  labelSide?: 'start' | 'end';
  haloColor?: ColorToken;
  fontSize?: number;
  /** Minimum px between two labels. Default 8. */
  gap?: number;
  className?: string;
}

/**
 * Several markers on one axis, with their labels pushed apart so none overlaps and none leaves the
 * plot. Widths come from {@link estimateMonoTextWidth}, which is exact for a monospace label and
 * needs no DOM measurement, so the layout is identical on the server and in the browser.
 */
export function MarkerLayer({
  geometry,
  scale,
  items,
  orientation = 'x',
  labelSide = 'start',
  haloColor = 'surface',
  fontSize = 12,
  gap = 8,
  className,
}: MarkerLayerProps) {
  const { inner } = geometry;
  const extent: [number, number] =
    orientation === 'x'
      ? [inner.x, inner.x + inner.width]
      : [inner.y, inner.y + inner.height];

  const centers = items.map((item) => scale(item.value));
  const sizes = items.map((item) =>
    item.label ? estimateMonoTextWidth(item.label, fontSize) : 0,
  );
  const placed = orientation === 'x' ? dodge1d(centers, sizes, extent, gap) : centers;

  return (
    <g className={className}>
      {items.map((item, index) => (
        <Marker
          key={item.id}
          geometry={geometry}
          scale={scale}
          value={item.value}
          orientation={orientation}
          stroke={item.stroke}
          labelColor={item.labelColor}
          dash={item.dash}
          strokeWidth={item.strokeWidth}
          label={item.label}
          labelSide={labelSide}
          labelPosition={placed[index]}
          haloColor={haloColor}
          fontSize={fontSize}
        />
      ))}
    </g>
  );
}
