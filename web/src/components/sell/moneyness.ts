/**
 * Where on the curve an offer starts, and how big it has to be to put a given amount on offer.
 *
 * THIS IS THE ONE PLACE FLOATING POINT IS ALLOWED TO TOUCH A SHIPPED NUMBER, and it is allowed
 * because of what it produces. `x = L*(1 - Phi(d1))` is a *choice*: it says "start this offer at
 * the no-arbitrage reserve point for spot S", and any nearby x is a legitimate, slightly
 * differently-priced offer. Getting it wrong by a millionth ships an offer a millionth further out
 * of the money, which is a preference, not a defect.
 *
 * The card inverts that relation, which changes nothing about the argument. A person types the
 * amount they want to sell, so `x` is exact — the raw token amount they typed — and `L` is the
 * number derived in floating point. `L` is a choice for exactly the same reason `x` was: it selects
 * which offer, among a continuum of legitimate ones, puts that amount on the curve.
 *
 * `y` is the opposite kind of number. It is not a choice — the curve determines it exactly, and one
 * wei of disagreement with the router's own approximated `Phi` either bricks the strategy (every
 * quote reverts, and a docked hash can never be re-shipped) or hands the surplus to the first
 * taker. So `y` is never computed here. It comes from `StrikelineViews.stableFor(K, sigma, T, L, x)`,
 * asked with the exact `x` and the exact `L` that will be shipped.
 *
 * Nothing else in the app may import this module's `phi`.
 */

/**
 * Standard normal CDF in double precision, via Abramowitz & Stegun 7.1.26.
 *
 * Deliberately the same approximation family the router uses, so the point this picks and the
 * point the chain believes agree to about 1e-7 rather than to whatever a different rational
 * approximation would give. It is still not the chain's answer and is never treated as one.
 */
export function phi(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  if (ax > 6) return sign;
  const t = 1 / (1 + 0.3275911 * ax);
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign * (1 - poly * Math.exp(-ax * ax));
}

export interface MoneynessInput {
  /** Spot, in stable per risky. */
  spot: number;
  /** The price the offer sells at, same units. */
  strike: number;
  /** Annualised volatility as a ratio: `0.6` is 60%. */
  sigma: number;
  /** Time to maturity in years, as the chain floors it. */
  tau: number;
}

/**
 * `d1 = (ln(S/K) + sigma^2*tau/2) / (sigma*sqrt(tau))`, and `d2 = d1 - sigma*sqrt(tau)`.
 *
 * At `tau = 0` or `sigma = 0` the pair degenerates to a step at the strike, which is the right
 * limit: the offer is a constant-sum order at `K` and the reserves are entirely on one side of it.
 */
export function d1d2({ spot, strike, sigma, tau }: MoneynessInput): { d1: number; d2: number } {
  const s = sigma * Math.sqrt(tau);
  if (!(s > 0) || !(spot > 0) || !(strike > 0)) {
    const step = spot >= strike ? Infinity : -Infinity;
    return { d1: step, d2: step };
  }
  const d1 = (Math.log(spot / strike) + (sigma * sigma * tau) / 2) / s;
  return { d1, d2: d1 - s };
}

/**
 * The fraction of `L` the risky reserve holds at spot: `1 - Phi(d1)`.
 *
 * Deep in the money this goes to zero and deep out of the money to one, which is what makes the
 * same instruction a covered call above spot and a cash-secured put below it — nothing but the
 * starting reserves decides which one a maker is holding.
 */
export function riskyFraction(input: MoneynessInput): number {
  const { d1 } = d1d2(input);
  if (d1 === Infinity) return 0;
  if (d1 === -Infinity) return 1;
  const f = 1 - phi(d1);
  return Number.isFinite(f) ? f : 1;
}

// ---------------------------------------------------------------------------
// Sizing from the amount a person typed
// ---------------------------------------------------------------------------

/** Resolution of the fraction. Far finer than the curve's own 2e-6 guard band. */
const SCALE = BigInt(1e12);

/**
 * Bounds on the fraction, and why they are not the obvious `[0, 1]`.
 *
 * At the top, `L` must stay strictly greater than `x`: `RmmSwap.stableOf` computes
 * `r = ceilDiv(x*WAD, L)` and reverts `RmmOutOfDomain` when `r > WAD`, so an `L` rounded down onto
 * `x` is a permanently reverting offer. The ceiling buys one part in a million of headroom, which
 * on a 10 WETH offer is 10 microether of extra notional.
 *
 * At the bottom, `L = x / fraction` runs away as the fraction goes to zero — the regime where the
 * price named is far below spot and the offer is a cash-secured put rather than a sale. The card
 * refuses that case before it gets here; the floor is what stops a half-typed price from
 * overflowing `uint128 liquidityWad` on the way.
 */
const MAX_FRACTION = 0.999999;
const MIN_FRACTION = 1e-6;

/**
 * The notional `L` that puts exactly `riskyWad` of the risky asset on offer at spot.
 *
 * The inverse of `x = L*(1 - Phi(d1))`, in the only direction a person thinks in: they say how much
 * they will sell, and this says how large the curve underneath it has to be. `L` is always strictly
 * greater than the amount, because the curve also holds stable value at the same reserve point —
 * that difference is what the offer is paid.
 */
export function liquidityForRisky(riskyWad: bigint, input: MoneynessInput): bigint {
  if (riskyWad <= BigInt(0)) return BigInt(0);
  const raw = riskyFraction(input);
  const fraction = Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, Number.isFinite(raw) ? raw : MAX_FRACTION));
  const scaled = BigInt(Math.round(fraction * Number(SCALE)));
  // Ceiling division: rounding down could land L on x, which is outside the curve's domain.
  const liquidity = (riskyWad * SCALE + scaled - BigInt(1)) / scaled;
  return liquidity > riskyWad ? liquidity : riskyWad + BigInt(1);
}

// ---------------------------------------------------------------------------
// Prices a person would actually name
// ---------------------------------------------------------------------------

/**
 * A price from spot and an offset, rounded to something a person would actually say.
 *
 * Round numbers are banned for *demo inventory*, not for prices: the price is a term of the offer,
 * and `2,728.58` reads as a bug where `2,700` reads as a decision. The step scales with the price
 * so the same code gives sane numbers for a $2,500 ETH and a $90,000 BTC.
 */
export function strikeFrom(spot: number, offset: number): number {
  const target = spot * (1 + offset);
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(target, 1)));
  const step = magnitude / 10;
  return Math.round(target / step) * step;
}

/** How far a price sits from spot, as a signed ratio. `+0.048` is 4.8% above. */
export function moneynessOf(strike: number, spot: number): number {
  if (!(spot > 0)) return 0;
  return strike / spot - 1;
}
