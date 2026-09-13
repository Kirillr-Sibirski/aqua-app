/**
 * Pure geometry: margins, curve sampling, label dodging.
 *
 * Nothing in here touches the DOM or reads `window`, so it renders identically on the server and in
 * the browser and can be unit-tested without a jsdom environment.
 */
import { type ChartGeometry, type ChartMargin, type ChartPoint, type ChartRect } from './types';

/**
 * Enough room on the left for a six-digit grouped tick (`31,204`) at 12px mono, and on the bottom
 * for one line of tick labels plus the tick marks. Charts with a longer axis label pass their own.
 */
export const DEFAULT_MARGIN: ChartMargin = { top: 12, right: 16, bottom: 28, left: 56 };

export function resolveMargin(margin?: Partial<ChartMargin>): ChartMargin {
  return { ...DEFAULT_MARGIN, ...margin };
}

/** Clamp `value` into `[lo, hi]`. `lo` wins if the interval is inverted. */
export function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

/**
 * Build the geometry for a measured SVG box. `width`/`height` are the whole box; the plot rect is
 * whatever the margins leave, floored at zero so a very narrow container degrades to an empty plot
 * rather than to negative dimensions and NaN paths.
 */
export function makeGeometry(
  width: number,
  height: number,
  margin: ChartMargin,
  clipId: string,
): ChartGeometry {
  const inner: ChartRect = {
    x: margin.left,
    y: margin.top,
    width: Math.max(0, width - margin.left - margin.right),
    height: Math.max(0, height - margin.top - margin.bottom),
  };
  return { width, height, margin, inner, clipId };
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/**
 * Evaluate `fn` at `samples` evenly spaced points across `domain`.
 *
 * A pricing curve is a function, not a table, so this is how one becomes drawable. Non-finite
 * results (an asymptote at a zero reserve, a `NaN` from a bad root) are kept as-is; `CurveLine`
 * and `AreaFill` treat them as gaps rather than pretending they are zero.
 *
 * @param samples clamped to 2..2000. 160 is enough for a smooth constant-product hyperbola at
 *   any width a terminal will use, and cheap enough to recompute on every resize.
 */
export function sampleCurve(
  fn: (x: number) => number,
  domain: readonly [number, number],
  samples = 160,
): ChartPoint[] {
  const n = Math.max(2, Math.min(2000, Math.floor(samples)));
  const [a, b] = domain;
  const step = (b - a) / (n - 1);
  const points: ChartPoint[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    // Recompute from `a` rather than accumulating, so float drift cannot walk off the domain end.
    const x = i === n - 1 ? b : a + step * i;
    points[i] = { x, y: fn(x) };
  }
  return points;
}

/** Grow a domain by `fraction` of its span on both ends, so a curve never touches the frame. */
export function padDomain(
  domain: readonly [number, number],
  fraction = 0.06,
): [number, number] {
  const [lo, hi] = domain;
  const span = hi - lo;
  // A flat series has no span to pad, so fall back to a unit either side of the value.
  const pad = span === 0 ? Math.max(1, Math.abs(lo) * 0.05) : span * fraction;
  return [lo - pad, hi + pad];
}

// ---------------------------------------------------------------------------
// Text metrics
// ---------------------------------------------------------------------------

/**
 * Advance width of a monospace run, in px.
 *
 * Every label this library places is a number, an address or a ticker, and all of them are set in
 * Geist Mono, whose advance is 0.6em. That makes the width computable without a `<canvas>` or a
 * DOM measurement, which is what keeps label collision handling identical on the server and the
 * client. Proportional text is not laid out here; it is never used for a mark label.
 */
export const MONO_ADVANCE_EM = 0.6;

export function estimateMonoTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * MONO_ADVANCE_EM;
}

// ---------------------------------------------------------------------------
// Label dodging
// ---------------------------------------------------------------------------

/**
 * Push overlapping labels apart along one axis, keeping them inside `extent`.
 *
 * Two sweeps: left to right placing each label no further left than its predecessor allows, then
 * right to left pulling anything that ran past the far edge back in. The result is the minimum
 * displacement that separates every pair by `gap`, in the original input order.
 *
 * When the labels genuinely do not fit (their total width exceeds the extent) they are packed from
 * the right edge and will overlap on the left. The caller should drop labels rather than rely on
 * this, but a readable-ish overlap beats a crash or a stack of clipped text.
 *
 * @param centers desired centre of each label, in px
 * @param sizes   width (or height) of each label, in px, same order as `centers`
 * @param extent  `[min, max]` px the labels must stay inside
 */
export function dodge1d(
  centers: readonly number[],
  sizes: readonly number[],
  extent: readonly [number, number],
  gap = 6,
): number[] {
  const n = centers.length;
  const out = new Array<number>(n);
  if (n === 0) return out;

  const order = centers.map((_, i) => i).sort((a, b) => centers[a] - centers[b] || a - b);

  let cursor = extent[0];
  for (const i of order) {
    const half = sizes[i] / 2;
    out[i] = Math.max(centers[i], cursor + half);
    cursor = out[i] + half + gap;
  }

  let limit = extent[1];
  for (let k = order.length - 1; k >= 0; k -= 1) {
    const i = order[k];
    const half = sizes[i] / 2;
    out[i] = Math.min(out[i], limit - half);
    limit = out[i] - half - gap;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Bar paths
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cursor snapping
// ---------------------------------------------------------------------------

/**
 * Index of the value in `positions` nearest to `target`.
 *
 * `positions` must be ascending; a binary search keeps a 2000-sample curve responsive under a
 * `pointermove` at 120Hz. Returns `-1` for an empty list.
 */
export function nearestIndex(positions: readonly number[], target: number): number {
  const n = positions.length;
  if (n === 0) return -1;
  if (target <= positions[0]) return 0;
  if (target >= positions[n - 1]) return n - 1;

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (positions[mid] <= target) lo = mid;
    else hi = mid;
  }
  return target - positions[lo] <= positions[hi] - target ? lo : hi;
}
