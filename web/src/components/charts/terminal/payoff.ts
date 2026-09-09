/**
 * The payoff at expiry, and why it is not a model.
 *
 * At `tau = 0` the leg's trading function degenerates, in closed form, to the constant-sum line
 * `Y = K*(L - X)`. `RmmSwap` takes that branch itself, with no Gaussian in it at all, and
 * `StrikelineViews.stableFor(K, sigma, 0, L, x)` is how the chain publishes it. So the two numbers
 * this file is built from are chain reads at a matured maturity:
 *
 *   cap        = stableFor(K, sigma, matured, L, 0)   = K*L, the whole leg at settlement
 *   settlement = stableFor(K, sigma, matured, L, x)   = K*(L - x)
 *
 * From those and the live reserve point `(x, y)`, everything the picture needs is arithmetic:
 *
 *   earned   = settlement - y            what a taker pays on top of K to be assigned in full
 *   capSpot  = (cap - y) / x = K + earned/x     the spot the two lines meet at
 *   hold(S)  = y + x*S                   the same reserves, never offered
 *   value(S) = min(hold(S), cap)         assigned above capSpot, kept below it
 *
 * `value` is capped at `cap` because assignment walks the settlement line from `(x, y)` to
 * `(0, K*L)`: the taker hands over `K*L - y = K*x + earned` stable and takes the whole risky
 * reserve, which leaves the maker holding exactly `K*L`. There is no Black-Scholes here, no `Phi`,
 * no volatility term — sigma has already done its work inside the two reads above.
 *
 * The floats appear only at the display boundary. Every anchor arrives as a WAD bigint and is
 * converted once, by the same decimal-exact formatter the tables use; a line between two anchors is
 * then a line.
 */
import { formatUnits } from 'viem';

/** Where the two lines are pinned. All in the tokens' own units, converted from WAD once. */
export interface PayoffAnchors {
  /** Risky reserve on offer. */
  x: number;
  /** Stable reserve the curve required there. */
  y: number;
  /** `K*L` — the position's value once assigned, whatever spot does after. */
  cap: number;
  /** Spot at which holding and the position stop agreeing: `K + earned/x`. */
  capSpot: number;
  /** The price named. */
  strike: number;
  /** `settlement - y`: what the wait is worth if the leg is assigned in full. */
  earned: number;
}

/** WAD, as a bigint, without a literal (the build targets ES2017). */
const WAD = BigInt(10) ** BigInt(18);

/** A WAD bigint as a double, through the decimal string, so no digit is invented. */
export function wadToNumber(value: bigint): number {
  return Number(formatUnits(value, 18));
}

export interface PayoffInputs {
  /** `x`, the risky reserve, WAD. */
  xWad: bigint;
  /** `y`, the stable reserve, WAD. */
  yWad: bigint;
  /** `stableFor(K, sigma, matured, L, 0)` — the leg's settlement value, WAD. */
  capWad: bigint;
  /** `stableFor(K, sigma, matured, L, x)` — the settlement line at the reserve point, WAD. */
  settlementWad: bigint;
  /** `K`, WAD. */
  strikeWad: bigint;
}

/**
 * Resolve the anchors, or `null` when the leg cannot produce a payoff picture.
 *
 * The two refusals are real cases rather than defensive noise: `x = 0` is a leg with nothing on
 * offer (the whole reserve is stable, so there is nothing to be assigned), and `cap <= y` means the
 * settlement line sits at or below the reserves, which is the boundary the curve is never on for a
 * live offer. Drawing either would be a picture of a position that does not exist.
 */
export function payoffAnchors(input: PayoffInputs): PayoffAnchors | null {
  const { xWad, yWad, capWad, settlementWad, strikeWad } = input;
  if (xWad <= BigInt(0) || capWad <= yWad) return null;

  const capSpotWad = ((capWad - yWad) * WAD) / xWad;
  const earnedWad = settlementWad > yWad ? settlementWad - yWad : BigInt(0);

  return {
    x: wadToNumber(xWad),
    y: wadToNumber(yWad),
    cap: wadToNumber(capWad),
    capSpot: wadToNumber(capSpotWad),
    strike: wadToNumber(strikeWad),
    earned: wadToNumber(earnedWad),
  };
}

/** What the same reserves are worth at expiry if the leg was never written: `y + x*S`. */
export function holdValue(spot: number, a: PayoffAnchors): number {
  return a.y + a.x * spot;
}

/** What the leg is worth at expiry: the hold line, capped where assignment takes over. */
export function positionValue(spot: number, a: PayoffAnchors): number {
  return Math.min(holdValue(spot, a), a.cap);
}

/**
 * The spot range the picture is drawn over.
 *
 * Wide enough that the kink is not on the frame and both markers have air around them, narrow
 * enough that the two lines separate visibly. The lower bound is pulled further than the upper
 * because the interesting half of a covered call is above the strike.
 */
export function payoffDomain(a: PayoffAnchors, spot?: number): [number, number] {
  const points = [a.capSpot, a.strike, ...(spot !== undefined && spot > 0 ? [spot] : [])];
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  return [Math.max(0, lo * 0.8), hi * 1.16];
}

/** A polyline, in domain units, for the value of the position across `domain`. */
export function positionPoints(
  a: PayoffAnchors,
  domain: readonly [number, number],
): { x: number; y: number }[] {
  const [lo, hi] = domain;
  const kink = Math.min(Math.max(a.capSpot, lo), hi);
  const points = [{ x: lo, y: positionValue(lo, a) }];
  if (kink > lo && kink < hi) points.push({ x: kink, y: a.cap });
  points.push({ x: hi, y: positionValue(hi, a) });
  return points;
}

/** The same for buy-and-hold, which needs no kink. */
export function holdPoints(
  a: PayoffAnchors,
  domain: readonly [number, number],
): { x: number; y: number }[] {
  const [lo, hi] = domain;
  return [
    { x: lo, y: holdValue(lo, a) },
    { x: hi, y: holdValue(hi, a) },
  ];
}

/**
 * The region between the two lines: what a maker hands to whoever assigns them.
 *
 * Empty below the kink, because there the position and the hold are the same line — the payment
 * for that giving-up accrues inside the quote and is only realised when somebody crosses it. That
 * is the disclosed risk, and the picture states it by having nothing to shade on the left.
 */
export function forgonePoints(
  a: PayoffAnchors,
  domain: readonly [number, number],
): { x: number; y: number }[] {
  const [lo, hi] = domain;
  const kink = Math.max(a.capSpot, lo);
  if (kink >= hi) return [];
  return [
    { x: kink, y: a.cap },
    { x: hi, y: holdValue(hi, a) },
    { x: hi, y: a.cap },
  ];
}
