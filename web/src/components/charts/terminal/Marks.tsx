/**
 * The marks the three views share, and why each one exists.
 *
 * They are about the same problem: a plot that draws its subject correctly and does not say
 * what the subject is. A legend in the strip above solves that badly — it puts the names as far
 * from the lines as the layout allows, and it spends a row of chrome on a chart that already has
 * two axes it could be labelling instead. So the y axis carries its series' name and colour
 * (`AxisName`), the x axis carries what it measures and what its two ends mean (`AxisBand`), a line
 * carries its own label where there is room (`SeriesLabel`), and the strip keeps the room for the
 * readout.
 *
 * Pure: handed pixels and tokens, returns SVG. The measurement lives in `Plot`, the arithmetic in
 * `payoff.ts` and the reads in the hooks, so nothing here can disagree with the chain.
 */
import type { ReactNode } from 'react';
import { color, colorMix, FONT_STACK } from '@/lib/ui/tokens';
import { dashArray, round, type ChartGeometry, type ColorToken, type DashStyle } from '../types';
import classes from './chart.module.css';

/**
 * An axis's name, in the reader's words, at the corner the axis starts from.
 *
 * It replaces `Axis`'s own `label`, which paints the name in the tick colour and cannot carry a
 * swatch. Two things changed here and both were legibility bugs rather than taste:
 *
 *  - The name is what the axis MEASURES, not the token it is counted in. `USDC` over a column of
 *    numbers says nothing a reader did not already assume; `a buyer brings · USDC` says what the
 *    number is and keeps the unit.
 *  - The rule beside it is the series that lives on this axis, in that series' own colour and dash.
 *    A two-axis chart has no other honest way to say which line belongs to which scale, and it is
 *    what lets the strip drop its legend entirely.
 *
 * The name sits in `--ink-2` and the ticks stay in `--ink-3`, so the axis reads name-then-values
 * rather than as one grey block.
 */
export function AxisName({
  geometry,
  side,
  swatch,
  dash = 'solid',
  children,
  className,
}: {
  geometry: ChartGeometry;
  side: 'left' | 'right';
  /** Colour of the series rule drawn beside the name. Omit for an axis no single series owns. */
  swatch?: ColorToken;
  dash?: DashStyle;
  children: string;
  className?: string;
}) {
  const { inner } = geometry;
  const right = inner.x + inner.width;
  const y = inner.y - 10;
  const RULE = 12;
  const GAP = 6;

  return (
    <g aria-hidden="true" className={className}>
      {swatch ? (
        <line
          x1={side === 'left' ? inner.x : right - RULE}
          x2={side === 'left' ? inner.x + RULE : right}
          y1={y - 4}
          y2={y - 4}
          stroke={color(swatch)}
          strokeWidth={1.75}
          strokeDasharray={dashArray(dash, 1.75)}
        />
      ) : null}
      <text
        x={side === 'left' ? inner.x + (swatch ? RULE + GAP : 0) : right - (swatch ? RULE + GAP : 0)}
        y={y}
        textAnchor={side === 'left' ? 'start' : 'end'}
        fontFamily={FONT_STACK.sans}
        fontSize={12}
        fill={color('ink-2')}
      >
        {children}
      </text>
    </g>
  );
}

/**
 * A line's name, written on the line.
 *
 * The halo is the same device `Marker` uses — a 4px stroke of the page ground under the glyphs,
 * painted first — so a label crossing a curve or a shaded region stays readable without a chip, a
 * box or a leader. Sans rather than mono, because this is a word and not a figure; a figure written
 * beside a mark (the premium at the payoff's kink) sets `mono` and gets tabular digits.
 */
export function SeriesLabel({
  x,
  y,
  anchor = 'start',
  tone = 'ink-2',
  mono = false,
  fontSize = 12,
  children,
  className,
}: {
  x: number;
  y: number;
  anchor?: 'start' | 'middle' | 'end';
  tone?: ColorToken;
  mono?: boolean;
  fontSize?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <text
      x={round(x)}
      y={round(y)}
      textAnchor={anchor}
      fontFamily={mono ? FONT_STACK.mono : FONT_STACK.sans}
      fontSize={fontSize}
      fill={color(tone)}
      stroke={color('bg')}
      strokeWidth={4}
      strokeLinejoin="round"
      paintOrder="stroke"
      className={className}
      aria-hidden="true"
      style={mono ? { fontVariantNumeric: 'tabular-nums slashed-zero' } : undefined}
    >
      {children}
    </text>
  );
}

/**
 * The series reveal: everything inside is wiped in from the left when it first appears.
 *
 * It is a `clip-path` on a RENDERED group, and both halves of that sentence are the result of the
 * first attempt failing.
 *
 *  - `clip-path`, not a transform on the marks. A `scaleX` would stretch every stroke and every
 *    dash pattern on its way in, so the geometry reaching the screen would not be the geometry that
 *    was measured. Only the window moves.
 *  - RENDERED, not a `<rect>` inside a `<clipPath>` inside `<defs>`. That was the obvious way to
 *    write it and it is silently broken: `<defs>` content is not rendered, Chrome does not run CSS
 *    animations on it, and what shipped was a chart frozen at whatever fraction of the wipe the
 *    first style recalculation happened to land on — a curve cut off at day 1.4 of 9, with a clean
 *    vertical edge that reads as data rather than as a bug. A reveal that can fail into "the chart
 *    is wrong" is not worth having.
 *
 * The spacer rect is what stops the final frame from shaving a stroke. `inset()` resolves against
 * the group's fill box, which excludes stroke width, so a 2px series line sitting on the domain
 * edge would lose its outer pixel when the wipe finished. An invisible rect inflated past the plot
 * on every side makes the fill box bigger than anything drawn in it; `fill="none"` still counts
 * toward a bounding box, so it costs nothing to paint.
 */
export function Wipe({ geometry, children }: { geometry: ChartGeometry; children: ReactNode }) {
  const { inner } = geometry;
  return (
    <g className={classes.wipe}>
      <rect
        aria-hidden="true"
        fill="none"
        stroke="none"
        pointerEvents="none"
        x={inner.x - 6}
        y={inner.y - 16}
        width={inner.width + 12}
        height={inner.height + 32}
      />
      {children}
    </g>
  );
}

/**
 * The live reserve point: a dot, a soft ring, and a drop line to the axis so its own x is readable
 * off the ticks.
 *
 * This is the mark the price view is FOR, and it used to be a 4px circle at the far end of a curve
 * that ran the width of the plot — smaller than the end dot on a series and quieter than the shaded
 * region behind it. An 11px ring of the accent at 22% gives the dot weight without becoming a second
 * mark, and it is what makes the point findable in the corner a freshly written covered call always
 * puts it in: all of the risky still unsold, so `x = L` and the point sits hard against the axis.
 * The dot itself is ringed in the page ground, so it stays legible where it lands on a line.
 *
 * It does not pulse. A loop here would say "live" — which the block number in the app bar already
 * says — and the one loop this chart spends is on the arrow beside it, which says something a still
 * frame cannot.
 */
export function LivePoint({
  x,
  y,
  baseline,
  className,
}: {
  x: number;
  y: number;
  /** y of the plot's bottom edge, where the drop line lands. */
  baseline: number;
  className?: string;
}) {
  const cx = round(x);
  const cy = round(y);
  return (
    <g className={className}>
      <line
        x1={cx}
        x2={cx}
        y1={cy}
        y2={round(baseline)}
        stroke={color('accent-dim')}
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <circle cx={cx} cy={cy} r={11} fill={colorMix('accent', 22)} />
      <circle cx={cx} cy={cy} r={4.5} fill={color('accent')} stroke={color('bg')} strokeWidth={2} />
    </g>
  );
}

/**
 * The x axis's band: what it measures, in the middle, and what its two ends MEAN, at the ends.
 *
 * It began as `UnitTag` — the unit, once, under the right-hand corner — and grew the two ends
 * because of a bug that was really a placement bug. The premium view had `today` and `expiry`
 * written INSIDE the plot at the two bottom corners, which put two words on top of the series they
 * were annotating: at 390px `expiry` sat in the shaded fill and its halo punched a rectangle of
 * page ground out of it, so the label read as a chip somebody had dropped on the chart. The two
 * words are not data. They are what the first and last tick MEAN, they belong in the axis band with
 * the rest of the axis's furniture, and there they collide with nothing.
 *
 * What that buys is bigger than the bug. A number line running `0d 2d 4d 6d 8d` is a measurement; a
 * line running `today ... expiry` is a story with a direction, and the direction is the whole
 * subject of both views that use it — the premium grows toward expiry, and a fill walks the reserve
 * point from `none sold` toward `all sold`. Naming the ends is the cheapest way to say which way
 * the plot runs, and it costs no pixels the axis was not already reserving.
 *
 * All three labels sit on one row in `--ink-3`, sans rather than mono: these are words, and the
 * mono column belongs to the ticks above them. A caller that has no ends passes none and gets the
 * original right-anchored unit tag back, which is what the payoff view still wants.
 */
export function AxisBand({
  geometry,
  start,
  end,
  children,
}: {
  geometry: ChartGeometry;
  /** What the left end of the axis means, in one or two words. */
  start?: string;
  /** What the right end means. */
  end?: string;
  /** What the axis measures, with its unit. Centred when there are ends, right-anchored without. */
  children: string;
}) {
  const { inner } = geometry;
  const y = inner.y + inner.height + 26;
  const bounded = start !== undefined || end !== undefined;

  return (
    <g aria-hidden="true" fontFamily={FONT_STACK.sans} fontSize={12} fill={color('ink-3')}>
      {start !== undefined ? (
        <text x={inner.x} y={y} dy="0.71em" textAnchor="start">
          {start}
        </text>
      ) : null}
      <text
        x={bounded ? inner.x + inner.width / 2 : inner.x + inner.width}
        y={y}
        dy="0.71em"
        textAnchor={bounded ? 'middle' : 'end'}
      >
        {children}
      </text>
      {end !== undefined ? (
        <text x={inner.x + inner.width} y={y} dy="0.71em" textAnchor="end">
          {end}
        </text>
      ) : null}
    </g>
  );
}
