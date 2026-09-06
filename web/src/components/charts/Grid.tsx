/**
 * Gridlines. Solid hairlines one step off the surface, never dashed, never in front of the data.
 *
 * The quiet default is horizontal rules only: a value chart is read across, and vertical rules
 * mostly restate the x-axis ticks. Ask for `'both'` when the x positions themselves carry meaning
 * (a bucketed bar chart, a date grid).
 */
import { color } from '@/lib/ui/tokens';
import { isBandScale, round, type AnyScale, type ChartGeometry, type ColorToken, type ContinuousScale } from './types';

export interface GridProps {
  geometry: ChartGeometry;
  /** Horizontal rules are drawn at this scale's ticks. */
  yScale?: ContinuousScale;
  /** Vertical rules are drawn at this scale's ticks, or at each band's centre. */
  xScale?: AnyScale;
  /** Explicit y positions, in domain units. Overrides `yCount`. */
  yValues?: readonly number[];
  /** Explicit x positions, in domain units. Overrides `xCount`. */
  xValues?: readonly (number | string)[];
  /** Target number of horizontal rules. Default 4. */
  yCount?: number;
  /** Target number of vertical rules. Default 5. */
  xCount?: number;
  /** Which directions to draw. Default `'y'`. */
  lines?: 'x' | 'y' | 'both';
  /** Default `'line'`, the hairline token. */
  stroke?: ColorToken;
  /**
   * Draw a stronger rule where the y scale crosses zero. A diverging chart needs it: it is what
   * makes "above" and "below" readable without relying on the pos/neg hues.
   */
  zeroRule?: boolean;
}

function continuousTicks(scale: ContinuousScale, count: number): number[] {
  return scale.ticks ? scale.ticks(count) : scale.domain();
}

export function Grid({
  geometry,
  yScale,
  xScale,
  yValues,
  xValues,
  yCount = 4,
  xCount = 5,
  lines = 'y',
  stroke = 'line',
  zeroRule = false,
}: GridProps) {
  const { inner } = geometry;
  const drawX = lines === 'x' || lines === 'both';
  const drawY = lines === 'y' || lines === 'both';

  const horizontals: number[] = [];
  if (drawY && yScale) {
    for (const v of yValues ?? continuousTicks(yScale, yCount)) horizontals.push(yScale(v));
  }

  const verticals: number[] = [];
  if (drawX && xScale) {
    if (isBandScale(xScale)) {
      const values = (xValues as readonly string[] | undefined) ?? xScale.domain();
      for (const v of values) {
        const at = xScale(v);
        if (at !== undefined) verticals.push(at + xScale.bandwidth() / 2);
      }
    } else {
      const values = (xValues as readonly number[] | undefined) ?? continuousTicks(xScale, xCount);
      for (const v of values) verticals.push(xScale(v));
    }
  }

  const zeroAt =
    zeroRule && yScale && Math.min(...yScale.domain()) < 0 && Math.max(...yScale.domain()) > 0
      ? yScale(0)
      : null;

  return (
    <g aria-hidden="true" className="pointer-events-none" shapeRendering="crispEdges">
      {horizontals.map((at) => {
        const y = round(at);
        if (y < inner.y - 0.5 || y > inner.y + inner.height + 0.5) return null;
        return (
          <line
            key={`h-${y}`}
            x1={inner.x}
            x2={inner.x + inner.width}
            y1={y}
            y2={y}
            stroke={color(stroke)}
            strokeWidth={1}
          />
        );
      })}
      {verticals.map((at) => {
        const x = round(at);
        if (x < inner.x - 0.5 || x > inner.x + inner.width + 0.5) return null;
        return (
          <line
            key={`v-${x}`}
            x1={x}
            x2={x}
            y1={inner.y}
            y2={inner.y + inner.height}
            stroke={color(stroke)}
            strokeWidth={1}
          />
        );
      })}
      {zeroAt !== null ? (
        <line
          x1={inner.x}
          x2={inner.x + inner.width}
          y1={round(zeroAt)}
          y2={round(zeroAt)}
          stroke={color('line-strong')}
          strokeWidth={1}
        />
      ) : null}
    </g>
  );
}
