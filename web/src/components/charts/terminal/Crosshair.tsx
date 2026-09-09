/**
 * The cursor, drawn.
 *
 * A hairline down the plot, a ringed dot on every series it crosses, and the x value in a chip
 * pinned to the axis band. The numbers themselves live in the readout above the plot rather than in
 * a floating tooltip: a tooltip covers the marks it is describing, and on a chart whose whole
 * subject is the distance between two lines, covering them is the one thing it must not do.
 *
 * Pure. It is handed pixels and draws them, so it renders identically on the server and after a
 * resize, and the interaction that produces those pixels lives in `Plot`.
 */
import { color, FONT_STACK } from '@/lib/ui/tokens';
import { clamp, estimateMonoTextWidth } from '../geometry';
import { round, type ChartGeometry, type ColorToken } from '../types';

export interface CrosshairDot {
  id: string;
  /** px */
  y: number;
  color: ColorToken;
}

export interface CrosshairProps {
  geometry: ChartGeometry;
  /** px along the x axis. */
  x: number;
  dots?: readonly CrosshairDot[];
  /** The x value, already formatted. Drawn in a chip on the axis band. */
  label?: string;
}

const CHIP_HEIGHT = 16;
const CHIP_PAD = 5;
const FONT_SIZE = 11;

export function Crosshair({ geometry, x, dots = [], label }: CrosshairProps) {
  const { inner } = geometry;
  if (!Number.isFinite(x)) return null;

  const at = round(clamp(x, inner.x, inner.x + inner.width));
  const chipWidth = label ? estimateMonoTextWidth(label, FONT_SIZE) + CHIP_PAD * 2 : 0;
  const chipX = clamp(at - chipWidth / 2, inner.x, inner.x + inner.width - chipWidth);
  const chipY = inner.y + inner.height + 3;

  return (
    <g className="pointer-events-none" aria-hidden="true">
      <line
        x1={at}
        x2={at}
        y1={inner.y}
        y2={inner.y + inner.height}
        stroke={color('line-strong')}
        strokeWidth={1}
        shapeRendering="crispEdges"
      />
      {dots.map((dot) =>
        Number.isFinite(dot.y) ? (
          <circle
            key={dot.id}
            cx={at}
            cy={round(clamp(dot.y, inner.y - 2, inner.y + inner.height + 2))}
            r={3.5}
            fill={color(dot.color)}
            stroke={color('bg')}
            strokeWidth={1.5}
          />
        ) : null,
      )}
      {label ? (
        <g>
          <rect
            x={round(chipX)}
            y={round(chipY)}
            width={round(chipWidth)}
            height={CHIP_HEIGHT}
            rx={4}
            fill={color('surface-3')}
            stroke={color('line-strong')}
            strokeWidth={1}
          />
          <text
            x={round(chipX + chipWidth / 2)}
            y={round(chipY + CHIP_HEIGHT / 2)}
            dy="0.34em"
            textAnchor="middle"
            fontFamily={FONT_STACK.mono}
            fontSize={FONT_SIZE}
            fill={color('ink')}
            style={{ fontVariantNumeric: 'tabular-nums slashed-zero' }}
          >
            {label}
          </text>
        </g>
      ) : null}
    </g>
  );
}
