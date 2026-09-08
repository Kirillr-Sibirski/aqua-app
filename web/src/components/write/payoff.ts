/**
 * The payoff overlay. A MODEL, and labelled as one everywhere it is shown.
 *
 * Every other number in this app is a chain read. This one cannot be: it asks what the book would
 * be worth at prices that have not happened, which no `eth_call` can answer. So it is Black-Scholes
 * in double precision, and the chart says "model" on it.
 *
 * The identity it draws is the reason the position is what it claims to be. At the no-arbitrage
 * reserve point, `X = L*(1 - Phi(d1))` and `Y = L*K*Phi(d2)`, so
 *
 *     V(S) = S*X + Y = L*( S - C_BS(S, K, sigma, tau) ) = L*( K - P_BS(S, K, sigma, tau) )
 *
 * long spot, short a call struck at `K` — and by put-call parity the same expression is a
 * cash-secured put. One formula covers both legs of the ladder; nothing branches on the kind.
 *
 * The baseline is the same tokens held rather than "the wallet in USD", because that is the
 * comparison a maker is actually making: they already own this inventory, and the question is
 * whether writing the curve beats sitting on it. It touches the book at the spot the legs were
 * written at, caps above the strikes, and falls faster below them. That last part is the honest
 * half and the chart does not hide it.
 */
import { d1d2, phi } from './moneyness';

export interface PayoffLeg {
  /** `L`, in risky units. */
  liquidity: number;
  strike: number;
  /** Annualised vol as a ratio. */
  sigma: number;
  /** Years to maturity. Zero draws the expiry payoff. */
  tau: number;
  /** Risky reserve as shipped, in risky units. */
  riskyReserve: number;
  /** Stable reserve as shipped. */
  stableReserve: number;
  kind: 'call' | 'put';
}

/** Black-Scholes call, `r = 0`, which is the rate the curve assumes. */
export function callPrice(spot: number, strike: number, sigma: number, tau: number): number {
  if (!(tau > 0) || !(sigma > 0)) return Math.max(0, spot - strike);
  const { d1, d2 } = d1d2({ spot, strike, sigma, tau });
  return spot * phi(d1) - strike * phi(d2);
}

/** One leg's value at spot: `L*(S - C_BS)`. */
export function legValue(leg: PayoffLeg, spot: number): number {
  return leg.liquidity * (spot - callPrice(spot, leg.strike, leg.sigma, leg.tau));
}

/** The whole book's value at spot, at each leg's own `tau`. */
export function bookValue(legs: readonly PayoffLeg[], spot: number): number {
  return legs.reduce((sum, leg) => sum + legValue(leg, spot), 0);
}

/** The book at expiry: every leg collapses to `L*min(S, K)`, the hockey stick. */
export function bookValueAtExpiry(legs: readonly PayoffLeg[], spot: number): number {
  return legs.reduce((sum, leg) => sum + leg.liquidity * Math.min(spot, leg.strike), 0);
}

/**
 * The baseline: the reserves as shipped, simply held. Linear in spot, and equal to the book at the
 * price the legs were written at.
 */
export function hodlValue(legs: readonly PayoffLeg[], spot: number): number {
  return legs.reduce((sum, leg) => sum + spot * leg.riskyReserve + leg.stableReserve, 0);
}

/**
 * The price band over which the book is being assigned.
 *
 * Above the lowest call strike the calls start converting risky into stable — that is the cap. The
 * put mirrors it below its own strike. Returned as a pair of open bounds so the chart can shade
 * "assigned" without inventing a region for a book that has no leg on that side.
 */
export function assignedBounds(legs: readonly PayoffLeg[]): { above?: number; below?: number } {
  const calls = legs.filter((l) => l.kind === 'call').map((l) => l.strike);
  const puts = legs.filter((l) => l.kind === 'put').map((l) => l.strike);
  return {
    ...(calls.length > 0 ? { above: Math.min(...calls) } : {}),
    ...(puts.length > 0 ? { below: Math.max(...puts) } : {}),
  };
}

/**
 * A spot domain wide enough to show both the cap and the downside, centred on the current price.
 *
 * Anchored to the strikes rather than to a fixed percentage, so a book written 20% out of the money
 * still has its cap on screen.
 */
export function spotDomain(legs: readonly PayoffLeg[], spot: number): [number, number] {
  const strikes = legs.map((l) => l.strike);
  const lo = Math.min(spot, ...strikes) * 0.72;
  const hi = Math.max(spot, ...strikes) * 1.22;
  return [Math.max(0, lo), hi];
}

/**
 * What the book gives up, and what it is paid, at a given spot.
 *
 * `premium` is the model's answer to "how much theta is in this book", which is the number the
 * maker is choosing to sell. It is a modelled figure and the UI never presents it as realised —
 * realised theta is read from fills on the leg screen, not from here.
 */
export function bookSummary(legs: readonly PayoffLeg[], spot: number) {
  const value = bookValue(legs, spot);
  const hodl = hodlValue(legs, spot);
  const premium = legs.reduce(
    (sum, leg) => sum + leg.liquidity * callPrice(spot, leg.strike, leg.sigma, leg.tau),
    0,
  );
  return { value, hodl, premium, difference: value - hodl };
}
