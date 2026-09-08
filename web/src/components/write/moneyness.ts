/**
 * Where on the curve a leg starts.
 *
 * THIS IS THE ONE PLACE FLOATING POINT IS ALLOWED TO TOUCH A SHIPPED NUMBER, and it is allowed
 * because of what it produces. `x = L*(1 - Phi(d1))` is a *choice*: it says "start this leg at the
 * no-arbitrage reserve point for spot S", and any nearby x is a legitimate, differently-moneyed
 * leg. Getting it wrong by a millionth ships a leg a millionth further out of the money, which is
 * a preference, not a defect.
 *
 * `y` is the opposite kind of number. It is not a choice — the curve determines it exactly, and one
 * wei of disagreement with the router's own approximated `Phi` either bricks the strategy (every
 * quote reverts, and a docked hash can never be re-shipped) or hands the surplus to the first
 * taker. So `y` is never computed here. It comes from `StrikelineViews.stableFor(K, sigma, T, L, x)`,
 * asked with the exact `x` that will actually be shipped after decimal rounding.
 *
 * Nothing else in the app may import this module's `phi`.
 */

/**
 * Standard normal CDF in double precision, via Abramowitz & Stegun 7.1.26.
 *
 * Deliberately the same approximation family the router uses, so the moneyness this picks and the
 * moneyness the chain believes agree to about 1e-7 rather than to whatever a different rational
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
  /** Strike, same units. */
  strike: number;
  /** Annualised implied volatility as a ratio: `0.6` is 60%. */
  sigma: number;
  /** Time to maturity in years, as the chain floors it. */
  tau: number;
}

/**
 * `d1 = (ln(S/K) + sigma^2*tau/2) / (sigma*sqrt(tau))`, and `d2 = d1 - sigma*sqrt(tau)`.
 *
 * At `tau = 0` or `sigma = 0` the pair degenerates to a step at the strike, which is the right
 * limit: the leg is a constant-sum order at `K` and the reserves are entirely on one side of it.
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
 * The fraction of `L` the risky reserve should hold at spot: `1 - Phi(d1)`.
 *
 * Deep in the money this goes to zero and deep out of the money to one, which is what makes the
 * same instruction a covered call above spot and a cash-secured put below it — nothing but the
 * starting reserves decides which one a maker is holding.
 */
export function riskyFraction(input: MoneynessInput): number {
  const { d1 } = d1d2(input);
  if (d1 === Infinity) return 0;
  if (d1 === -Infinity) return 1;
  return 1 - phi(d1);
}

/** Delta of the position: `Phi(-d1)`, the hedge an arbitrageur runs against it. */
export function positionDelta(input: MoneynessInput): number {
  return riskyFraction(input);
}

/**
 * The risky reserve to ship, in normalised WAD, for a leg of size `L`.
 *
 * Clamped strictly inside `[0, L]`: `stableOf` reverts `RmmOutOfDomain` above `L`, and a float
 * step that lands one wei past the end would take the whole leg with it.
 */
export function riskyReserveWad(liquidityWad: bigint, input: MoneynessInput): bigint {
  const fraction = Math.min(1, Math.max(0, riskyFraction(input)));
  // 1e12 of resolution on the fraction is far finer than the curve's own 2e-6 guard band, and
  // keeps the multiplication inside Number's exact-integer range before it becomes a bigint.
  const scaled = BigInt(Math.round(fraction * 1e12));
  const x = (liquidityWad * scaled) / BigInt(1e12);
  return x > liquidityWad ? liquidityWad : x;
}

// ---------------------------------------------------------------------------
// Strike chips
// ---------------------------------------------------------------------------

/** A moneyness offset the writer offers as a chip. Negative is below spot. */
export interface MoneynessChip {
  /** `+0.1` for 10% above spot. */
  offset: number;
  label: string;
  /** Calls sit above spot, the put below it. */
  kind: 'call' | 'put';
}

/**
 * The ladder the writer offers: three calls above spot and one put below.
 *
 * Not a symmetric grid on purpose. The product is vol selling against inventory a maker already
 * holds, so the calls are the position and the put is the other half of the wheel — the leg that
 * accumulates below spot with stable collateral rather than competing for the same risky balance.
 */
export const MONEYNESS_CHIPS: readonly MoneynessChip[] = [
  { offset: -0.1, label: '-10%', kind: 'put' },
  { offset: -0.05, label: '-5%', kind: 'put' },
  { offset: 0.05, label: '+5%', kind: 'call' },
  { offset: 0.1, label: '+10%', kind: 'call' },
  { offset: 0.2, label: '+20%', kind: 'call' },
];

/**
 * A strike from spot and an offset, rounded to something a person would actually quote.
 *
 * Round numbers are banned for *demo inventory*, not for strikes: a strike is a term of the
 * contract, and `2,728.58` reads as a bug where `2,700` reads as a decision. The step scales with
 * the price so the same code gives sane strikes for a $2,500 ETH and a $90,000 BTC.
 */
export function strikeFrom(spot: number, offset: number): number {
  const target = spot * (1 + offset);
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(target, 1)));
  const step = magnitude / 10;
  return Math.round(target / step) * step;
}

/** How far a strike sits from spot, as a signed ratio. `+0.048` is 4.8% above. */
export function moneynessOf(strike: number, spot: number): number {
  if (!(spot > 0)) return 0;
  return strike / spot - 1;
}
