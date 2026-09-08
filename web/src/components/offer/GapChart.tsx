'use client';

/**
 * The gap, drawn at the only scale it can be drawn at: its own.
 *
 * With liquidity fixed and no invariant offset, an offer's reserves sit exactly ON its curve the
 * moment it is published. Time then moves the curve away from them, in both directions at once,
 * and a trade only clears once it is big enough to close that distance. So the distance IS the
 * premium: whoever crosses it hands it to the maker. Nothing happened on chain to open it, and
 * nobody signed anything.
 *
 * The reason this is its own panel rather than a shaded wedge on the curve above: on a y-domain of
 * zero to L*K the gap on a freshly published offer is about four ten-thousandths of one pixel, and
 * a chart that shaded it was drawing a path with a zero-by-zero bounding box while its legend said
 * the wedge was there. The honest fix is not a bigger stroke. It is to put the wedge on axes that
 * start where the offer actually sits and measure outward in the units a taker would bring.
 *
 * BOTH AXES ARE OFFSETS. The origin is the live reserve point, so a tick reading `+0.02` means two
 * hundredths more of that token than the offer holds right now. Absolute reserves would need six
 * significant digits per tick to show a difference in the fourth, which is a wall of numbers with
 * the interesting part in the noise.
 *
 * Both corners come from `bandFor`. The straight edge between them is the curve: across a span this
 * narrow the sampled polyline's own sag between two neighbouring points is several times the whole
 * wedge, so drawing the samples here would put the "curve" visibly off the corners it must pass
 * through. Two chain-read corners and the segment between them is the more accurate picture.
 */
import { scaleLinear } from 'd3-scale';
import { Axis } from '@/components/charts/Axis';
import { ChartFrame, PlotArea, type ChartState } from '@/components/charts/ChartFrame';
import { formatChartNumber } from '@/components/charts/format';
import { round } from '@/components/charts/types';
import { color, colorMix, FONT_STACK } from '@/lib/ui/tokens';

export interface GapChartProps {
  /** Smallest extra stable input that clears, in the offer's own units (not raw). */
  gapStable: number;
  /** Smallest extra risky input that clears, same units. */
  gapRisky: number;
  riskySymbol: string;
  stableSymbol: string;
  /**
   * The full stable range of the curve above (`L * K`), used only for the magnification figure.
   * It is the number that makes the panel honest: it says how much bigger than life this is.
   */
  fullStableRange?: number;
  /** Labels the two corners with the raw-unit amounts a taker would actually send. */
  stableLabel?: string;
  riskyLabel?: string;
  subtitle?: React.ReactNode;
  scrubbed?: boolean;
  state?: ChartState;
  errorMessage?: string;
  height?: number;
}

const MARGIN = { top: 18, right: 58, bottom: 40, left: 74 };

/** Air around the wedge, as a fraction of its own size. */
const PAD = 0.28;

/** Two significant figures: "about 221,522x" is a precision the word "about" already disclaimed. */
function twoFigures(value: number): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  const step = 10 ** (Math.floor(Math.log10(Math.abs(value))) - 1);
  return Math.round(value / step) * step;
}

export function GapChart({
  gapStable,
  gapRisky,
  riskySymbol,
  stableSymbol,
  fullStableRange,
  stableLabel,
  riskyLabel,
  subtitle,
  scrubbed = false,
  state = 'ready',
  errorMessage,
  height = 260,
}: GapChartProps) {
  const hasWedge = gapStable > 0 && gapRisky > 0;
  const resolvedState: ChartState = state === 'ready' && !hasWedge ? 'empty' : state;

  const magnification =
    fullStableRange && gapStable > 0 ? twoFigures(fullStableRange / (gapStable * (1 + 2 * PAD))) : 0;

  return (
    <ChartFrame
      title="The gap a trade has to cross"
      description={`The wedge between where this offer's reserves sit and where its curve now is. A buyer must bring ${formatChartNumber(gapStable, { significantDigits: 4 })} ${stableSymbol} more than the offer holds before a trade clears, or a seller ${formatChartNumber(gapRisky, { significantDigits: 4 })} ${riskySymbol} more. Both axes are measured outward from where the offer sits now.`}
      subtitle={subtitle}
      height={height}
      margin={MARGIN}
      state={resolvedState}
      errorMessage={errorMessage}
      emptyMessage="This offer's reserves are still exactly on its curve, so there is no gap to draw yet. Drag the time slider forward to watch one open."
      legend={
        <span className="flex items-center gap-1.5 text-mini text-ink-3">
          <svg width={16} height={10} aria-hidden="true">
            <rect
              width={16}
              height={10}
              fill={colorMix('warn', 18)}
              stroke={color('warn')}
              strokeWidth={1}
            />
          </svg>
          {scrubbed ? 'What has built up by then' : 'What has built up so far'}
        </span>
      }
      footnote={
        <>
          Shown about{' '}
          <span className="font-mono tnum">{formatChartNumber(magnification)}×</span> larger than it
          is on the curve above, which is why it needs a panel of its own. Both corners are{' '}
          <span className="font-mono">bandFor</span> reads from the router; the origin is this
          offer&rsquo;s live reserves from Aqua&rsquo;s ledger. Nobody sent a transaction to open
          this. It grows on its own, and whoever eventually trades pays it to the maker.
        </>
      }
    >
      {(geometry) => {
        const padX = gapRisky * PAD;
        const padY = gapStable * PAD;
        const x = scaleLinear()
          .domain([-padX, gapRisky + padX])
          .range([geometry.inner.x, geometry.inner.x + geometry.inner.width]);
        const y = scaleLinear()
          .domain([-padY, gapStable + padY])
          .range([geometry.inner.y + geometry.inner.height, geometry.inner.y]);

        const x0 = x(0);
        const y0 = y(0);
        const xEnd = x(gapRisky);
        const yEnd = y(gapStable);

        return (
          <>
            <PlotArea geometry={geometry}>
              {/* The wedge: bounded below by the offer's own stable level, on the left by its risky
                  level, and above by the curve that has moved away from both. */}
              <path
                d={`M${round(x0)},${round(y0)} L${round(x0)},${round(yEnd)} L${round(xEnd)},${round(y0)} Z`}
                fill={colorMix('warn', 18)}
                stroke={color('warn')}
                strokeWidth={1.25}
                strokeLinejoin="round"
              />

              {/* Where the offer sits now: the origin of both axes. */}
              <circle cx={round(x0)} cy={round(y0)} r={4.5} fill={color('accent')} stroke={color('surface')} strokeWidth={2} />

              <CornerTick cx={x0} cy={yEnd} />
              <CornerTick cx={xEnd} cy={y0} />
            </PlotArea>

            {/* Corner labels sit outside the plot so they are never over the fill. */}
            <text
              x={x0 + 8}
              y={yEnd - 7}
              fontFamily={FONT_STACK.mono}
              fontSize={12}
              fill={color('warn')}
              style={{ fontVariantNumeric: 'tabular-nums slashed-zero' }}
            >
              {stableLabel ?? `${formatChartNumber(gapStable, { significantDigits: 4 })} ${stableSymbol}`}
            </text>
            <text
              x={xEnd + 6}
              y={y0 - 6}
              fontFamily={FONT_STACK.mono}
              fontSize={12}
              fill={color('warn')}
              style={{ fontVariantNumeric: 'tabular-nums slashed-zero' }}
            >
              {riskyLabel ?? `${formatChartNumber(gapRisky, { significantDigits: 4 })} ${riskySymbol}`}
            </text>

            <Axis
              geometry={geometry}
              scale={x}
              orientation="bottom"
              count={3}
              format={(v) => `+${formatChartNumber(Number(v), { significantDigits: 2 })}`}
              label={`extra ${riskySymbol} in`}
            />
            <Axis
              geometry={geometry}
              scale={y}
              orientation="left"
              count={3}
              format={(v) => `+${formatChartNumber(Number(v), { significantDigits: 3 })}`}
            />
            <text
              x={geometry.inner.x}
              y={geometry.inner.y - 6}
              fontFamily={FONT_STACK.sans}
              fontSize={12}
              fill={color('ink-3')}
            >
              extra {stableSymbol} in
            </text>
            <text
              x={geometry.inner.x + 6}
              y={geometry.inner.y + geometry.inner.height + 26}
              fontFamily={FONT_STACK.sans}
              fontSize={11}
              fill={color('ink-3')}
            >
              where it sits now
            </text>
          </>
        );
      }}
    </ChartFrame>
  );
}

/** A small tick at a corner the router named, so the shape reads as measured rather than drawn. */
function CornerTick({ cx, cy }: { cx: number; cy: number }) {
  return (
    <circle
      cx={round(cx)}
      cy={round(cy)}
      r={3}
      fill={color('surface')}
      stroke={color('warn')}
      strokeWidth={1.5}
    />
  );
}
