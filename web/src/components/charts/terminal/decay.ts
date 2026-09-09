/**
 * The time grid the decay view is sampled on.
 *
 * Each point is one synthetic maturity: "the same leg, with that much less time left". Asking
 * `bandFor` at `maturity - after` is asking the router what this exact position becomes if nobody
 * trades for `after` seconds, with the reserves held where they are now. Nothing is extrapolated —
 * every point is its own `eth_call`, and the whole grid is one multicall.
 *
 * Two details carried over from the offer screen's own series, both of which matter:
 *
 *  - **The last point is the tau floor, not the maturity.** `RmmSwap.tauOf` stops shortening tau in
 *    the final hour, so every point past the floor returns the same number and the line would end
 *    in a flat tail that is an artefact of the guard rather than of the decay.
 *  - **The anchor is snapped.** `bandFor` reads `block.timestamp`, so a grid keyed on the raw chain
 *    clock re-keys its multicall every block and re-fetches a dozen calls for a line whose shape has
 *    not visibly moved. Ten minutes on a two-week span is a quarter of a pixel.
 */
import { TAU_FLOOR_SECONDS } from '@/components/curve/rmm';

/** How coarsely the anchor is snapped before it becomes part of a query key. */
export const ANCHOR_SNAP_SECONDS = 600;

export const SECONDS_PER_DAY = 86_400;

export interface DecayGridPoint {
  /** Seconds of waiting this point stands for. 0 is now. */
  after: number;
  /** Days of waiting, for the axis. */
  days: number;
  /** The synthetic maturity the router is asked about. */
  maturity: number;
}

/**
 * Points across the leg's remaining life, oldest first.
 *
 * Returns an empty grid when the leg is inside its own tau floor: there is no decay left to draw,
 * and the view says so rather than drawing a flat line at zero.
 */
export function decayGrid(
  maturity: number,
  anchorSeconds: number,
  samples: number,
): DecayGridPoint[] {
  const span = maturity - anchorSeconds - TAU_FLOOR_SECONDS;
  if (!Number.isFinite(span) || span <= 0) return [];

  const n = Math.max(2, Math.min(48, Math.floor(samples)));
  const out: DecayGridPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    // Snapped to the minute so two neighbouring points cannot differ by a second and produce two
    // indistinguishable calls inside one multicall.
    const after = Math.floor((span * i) / (n - 1) / 60) * 60;
    const synthetic = maturity - after;
    if (out.at(-1)?.maturity !== synthetic) {
      out.push({ after, days: after / SECONDS_PER_DAY, maturity: synthetic });
    }
  }
  return out;
}

/** Snap a chain clock to the grid's anchor resolution. */
export function snapAnchor(nowSeconds: number): number {
  return Math.floor(nowSeconds / ANCHOR_SNAP_SECONDS) * ANCHOR_SNAP_SECONDS;
}
