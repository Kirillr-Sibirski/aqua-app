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
  /**
   * `sell`: assigned by takers buying the risky, above `capSpot`, which leaves the maker `K*L` stable.
   * `buy`: assigned by takers selling the risky, below `capSpot`, which leaves the maker `L` risky.
   */
  side: 'sell' | 'buy';
  /** `L`, the leg's notional in risky units. */
  liquidity: number;
  /** Risky reserve on offer. */
  x: number;
  /** Stable reserve the curve required there. */
  y: number;
  /** The position's value at the kink. Sell: `K*L`, flat above it. Buy: `L*capSpot`, falling below it. */
  cap: number;
  /** Spot at which holding and the position stop agreeing. Sell `K + earned/x`; buy `K - earned/(L - x)`. */
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
  /** `L`, WAD. Needed on the buy side, where assignment leaves the maker holding it. */
  liquidityWad?: bigint;
  side?: 'sell' | 'buy';
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
  const { xWad, yWad, capWad, settlementWad, strikeWad, side = 'sell' } = input;
  if (xWad <= BigInt(0) || capWad <= yWad) return null;

  const earnedWad = settlementWad > yWad ? settlementWad - yWad : BigInt(0);
  const liquidityWad = input.liquidityWad ?? (strikeWad > BigInt(0) ? (capWad * WAD) / strikeWad : BigInt(0));

  if (side === 'buy') {
    /* Assignment sells the offer the `L - x` risky it is short of for all `y` it holds, so the two
       lines meet where `y + x*S = L*S`, i.e. `S = y/(L - x)`, which is `K - earned/(L - x)`. */
    if (liquidityWad <= xWad) return null;
    const capSpotWad = (yWad * WAD) / (liquidityWad - xWad);
    const liquidity = wadToNumber(liquidityWad);
    const capSpot = wadToNumber(capSpotWad);
    return {
      side,
      liquidity,
      x: wadToNumber(xWad),
      y: wadToNumber(yWad),
      cap: liquidity * capSpot,
      capSpot,
      strike: wadToNumber(strikeWad),
      earned: wadToNumber(earnedWad),
    };
  }

  const capSpotWad = ((capWad - yWad) * WAD) / xWad;
  return {
    side,
    liquidity: wadToNumber(liquidityWad),
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
  if (a.side === 'buy') return Math.min(holdValue(spot, a), a.liquidity * spot);
  return Math.min(holdValue(spot, a), a.cap);
}

/**
 * The spot range the picture is drawn over.
 *
 * Padded by a multiple of the span between the anchors rather than by a percentage of the price,
 * which is what it used to be. A flat -20%/+16% of the level is four standard deviations for an
 * eight-day leg: two thirds of the axis went to prices that cannot happen before expiry, and
 * everything worth looking at — the strike, the cap, the wedge, the premium — was squeezed into the
 * middle third. Scaling the pad to the distance between the marks instead keeps the same three
 * marks framed at any tenor and any volatility, and gives a short-dated leg a readable axis.
 *
 * The floor matters for the at-the-money case: when spot, strike and cap almost coincide the span
 * collapses, and a domain of a few dollars either side would be a picture of nothing.
 */
export function payoffDomain(a: PayoffAnchors, spot?: number): [number, number] {
  const points = [a.capSpot, a.strike, ...(spot !== undefined && spot > 0 ? [spot] : [])];
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const pad = 1.2 * Math.max(hi - lo, 0.05 * hi);
  return [Math.max(0, lo - pad), hi + pad];
}

/** A polyline, in domain units, for the value of the position across `domain`. */
export function positionPoints(
  a: PayoffAnchors,
  domain: readonly [number, number],
): { x: number; y: number }[] {
  const [lo, hi] = domain;
  const kink = Math.min(Math.max(a.capSpot, lo), hi);
  const points = [{ x: lo, y: positionValue(lo, a) }];
  if (kink > lo && kink < hi) points.push({ x: kink, y: positionValue(kink, a) });
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
  if (a.side === 'buy') {
    // Below the kink: the maker bought risky that kept falling, under what holding would be worth.
    const kinkBuy = Math.min(a.capSpot, hi);
    if (kinkBuy <= lo) return [];
    return [
      { x: kinkBuy, y: holdValue(kinkBuy, a) },
      { x: lo, y: holdValue(lo, a) },
      { x: lo, y: a.liquidity * lo },
    ];
  }
  const kink = Math.max(a.capSpot, lo);
  if (kink >= hi) return [];
  return [
    { x: kink, y: a.cap },
    { x: hi, y: holdValue(hi, a) },
    { x: hi, y: a.cap },
  ];
}

/**
 * The premium, as a region — the other half of the picture, and the reason to write the offer.
 *
 * There was a real complaint about the payoff view: it drew a large red wedge and nothing else, so
 * a vol-selling terminal's headline chart sold only the downside. `Premium +146.13 USDC` sat in the
 * ticket while `vs hold +0.00` sat in the chart's own readout, three hundred pixels apart, and both
 * were right.
 *
 * They were right because this instrument pays no premium up front. The maker posts `x` risky; the
 * reserve point moves, and the money arrives, only when somebody trades against the curve. So at
 * expiry, with nothing having traded, the position IS the hold below the assignment point — and
 * shifting the line up to draw a premium that has not been paid would be a lie about the one number
 * the whole product is judged on.
 *
 * The premium is nonetheless on this chart, exactly, and it is a triangle:
 *
 *     (K,        hold(K))     the hold line at the strike
 *     (K,        cap)         the ceiling, above it by `cap - y - K*x = settlement - y = earned`
 *     (capSpot,  cap)         where the hold line reaches the ceiling and the two close
 *
 * Its left edge is `earned` tall — the same wei `stableFor` returned and the same figure the ticket
 * prints — and its width is `earned/x`, which is how far above the strike a taker actually has to
 * pay to be assigned. Nothing is modelled and nothing is shifted: the triangle is bounded below by
 * the hold line that was already drawn and above by the cap that was already drawn.
 */
export function premiumPoints(
  a: PayoffAnchors,
  domain: readonly [number, number],
): { x: number; y: number }[] {
  const [lo, hi] = domain;
  if (a.side === 'buy') {
    // Mirror of the sell triangle: `earned` tall at the strike, closing at the kink below it.
    const right = Math.min(a.strike, hi);
    const left = Math.max(a.capSpot, lo);
    if (!(right > left)) return [];
    return [
      { x: right, y: holdValue(right, a) },
      { x: right, y: a.liquidity * right },
      { x: left, y: a.liquidity * left },
    ];
  }
  const left = Math.max(a.strike, lo);
  const right = Math.min(a.capSpot, hi);
  if (!(right > left)) return [];
  return [
    { x: left, y: holdValue(left, a) },
    { x: left, y: a.cap },
    { x: right, y: a.cap },
  ];
}
