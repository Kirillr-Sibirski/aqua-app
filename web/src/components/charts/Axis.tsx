/**
 * An axis: a solid hairline rule, short ticks, and mono labels.
 *
 * Labels are set in Geist Mono at 12px in `--ink-3` (5.27:1 on `--surface`, 5.69:1 on `--bg`,
 * both clear of the 4.5:1 floor) with `tabular-nums slashed-zero`, so ticks form a column that
 * lines up and a `0` never reads as an `O`. Formatting goes through {@link tickFormatter}, which
 * gives every tick on one axis the same fraction-digit count.
 *
 * The whole group is `aria-hidden`: the accessible reading of a chart is its `<desc>` plus the
 * table view on `ChartFrame`, not a screen reader walking 40 tick labels.
 */
import { color, FONT_STACK } from '@/lib/ui/tokens';
import { estimateMonoTextWidth } from './geometry';
import { tickFormatter } from './format';
import {
  isBandScale,
  round,
  type AnyScale,
  type ChartGeometry,
  type ColorToken,
  type ContinuousScale,
} from './types';

export type AxisOrientation = 'bottom' | 'left' | 'top' | 'right';

export interface AxisProps {
  geometry: ChartGeometry;
  scale: AnyScale;
  orientation: AxisOrientation;
  /** Explicit tick values. Defaults to `scale.ticks(count)`, or every band. */
  values?: readonly (number | string)[];
  /** Target tick count for a continuous scale. Default 5 across, 4 up. Keep it low. */
  count?: number;
  /** Overrides the derived formatter. Receives the domain value. */
  format?: (value: number | string, index: number) => string;
  /** Unit appended to every tick, e.g. `'%'`. For a unit shown once, use `label`. */
  unit?: string;
  /** Axis name, drawn once at the far end of the axis in `--ink-3`. */
  label?: string;
  /** Draw the axis rule itself. Default true. */
  rule?: boolean;
  /** Tick mark length in px. Default 4. */
  tickSize?: number;
  /** Default 12px, the `--text-mini` step the token scale reserves for chart ticks. */
  fontSize?: number;
  /** Default `'ink-3'`. */
  textColor?: ColorToken;
}

function continuousTicks(scale: ContinuousScale, count: number): number[] {
  return scale.ticks ? scale.ticks(count) : scale.domain();
}

export function Axis({
  geometry,
  scale,
  orientation,
  values,
  count,
  format,
  unit,
  label,
  rule = true,
  tickSize = 4,
  fontSize = 12,
  textColor = 'ink-3',
}: AxisProps) {
  const { inner } = geometry;
  const horizontal = orientation === 'bottom' || orientation === 'top';
  const band = isBandScale(scale);

  const ticks: { value: number | string; at: number }[] = [];
  if (band) {
    const domain = (values as readonly string[] | undefined) ?? scale.domain();
    for (const v of domain) {
      const at = scale(v);
      if (at !== undefined) ticks.push({ value: v, at: at + scale.bandwidth() / 2 });
    }
  } else {
    const domain =
      (values as readonly number[] | undefined) ??
      continuousTicks(scale, count ?? (horizontal ? 5 : 4));
    for (const v of domain) ticks.push({ value: v, at: scale(v) });
  }

  let formatValue: (value: number | string, index: number) => string;
  if (format) {
    formatValue = format;
  } else if (band) {
    formatValue = (value) => String(value);
  } else {
    const numeric = tickFormatter(
      ticks.map((t) => t.value as number),
      { unit },
    );
    formatValue = (value) => numeric(value as number);
  }

  const axisAt =
    orientation === 'bottom'
      ? inner.y + inner.height
      : orientation === 'top'
        ? inner.y
        : orientation === 'left'
          ? inner.x
          : inner.x + inner.width;

  const tickDirection = orientation === 'bottom' || orientation === 'right' ? 1 : -1;
  const textGap = tickSize + 4;

  return (
    <g aria-hidden="true" className="pointer-events-none">
      {rule ? (
        <line
          x1={horizontal ? inner.x : axisAt}
          x2={horizontal ? inner.x + inner.width : axisAt}
          y1={horizontal ? axisAt : inner.y}
          y2={horizontal ? axisAt : inner.y + inner.height}
          stroke={color('line-strong')}
          strokeWidth={1}
          shapeRendering="crispEdges"
        />
      ) : null}

      {ticks.map(({ value, at }, index) => {
        const text = formatValue(value, index);
        const pos = round(at);

        if (horizontal) {
          if (pos < inner.x - 1 || pos > inner.x + inner.width + 1) return null;
          // Pull the outermost labels inward so an axis never bleeds into the neighbouring column.
          const half = estimateMonoTextWidth(text, fontSize) / 2;
          const anchor =
            pos - half < inner.x - 4 ? 'start' : pos + half > inner.x + inner.width + 4 ? 'end' : 'middle';
          const x = anchor === 'start' ? Math.max(pos, inner.x) : anchor === 'end' ? Math.min(pos, inner.x + inner.width) : pos;
          return (
            <g key={`${value}`}>
              <line
                x1={pos}
                x2={pos}
                y1={axisAt}
                y2={axisAt + tickSize * tickDirection}
                stroke={color('line-strong')}
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text
                x={x}
                y={axisAt + textGap * tickDirection}
                dy={orientation === 'bottom' ? '0.71em' : '-0.29em'}
                textAnchor={anchor}
                fontFamily={FONT_STACK.mono}
                fontSize={fontSize}
                fill={color(textColor)}
                style={{ fontVariantNumeric: 'tabular-nums slashed-zero' }}
              >
                {text}
              </text>
            </g>
          );
        }

        if (pos < inner.y - 1 || pos > inner.y + inner.height + 1) return null;
        return (
          <g key={`${value}`}>
            <line
              x1={axisAt}
              x2={axisAt + tickSize * tickDirection}
              y1={pos}
              y2={pos}
              stroke={color('line-strong')}
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <text
              x={axisAt + textGap * tickDirection}
              y={pos}
              dy="0.32em"
              textAnchor={orientation === 'left' ? 'end' : 'start'}
              fontFamily={FONT_STACK.mono}
              fontSize={fontSize}
              fill={color(textColor)}
              style={{ fontVariantNumeric: 'tabular-nums slashed-zero' }}
            >
              {text}
            </text>
          </g>
        );
      })}

      {/* The axis name sits clear of the tick labels: a line below them on a horizontal axis, and
          above the plot on a vertical one. A `label` therefore wants `margin.bottom >= 48` (or
          `margin.top >= 24`) from the frame. */}
      {label ? (
        <text
          x={horizontal ? inner.x + inner.width : inner.x}
          y={
            horizontal
              ? axisAt + (textGap + fontSize + 6) * tickDirection
              : inner.y - 10
          }
          dy={horizontal ? (orientation === 'bottom' ? '0.71em' : '-0.29em') : 0}
          textAnchor={horizontal ? 'end' : 'start'}
          fontFamily={FONT_STACK.sans}
          fontSize={fontSize}
          fill={color(textColor)}
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}
