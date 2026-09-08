/**
 * The model layer, pinned.
 *
 * Nothing here ships a number to the chain — `x` picks a point on a curve and the payoff overlay is
 * drawn, labelled "model", from Black-Scholes in double precision. But both are load-bearing for
 * what a maker believes they are writing, so the identities they rest on are asserted rather than
 * assumed: the replication identity `V = L*(S - C_BS) = L*(K - P_BS)`, the parity that makes one
 * instruction both a covered call and a cash-secured put, and the two limits at `tau -> 0`.
 */
import { describe, expect, it } from 'vitest';
import {
  MONEYNESS_CHIPS,
  d1d2,
  moneynessOf,
  phi,
  positionDelta,
  riskyFraction,
  riskyReserveWad,
  strikeFrom,
} from '../moneyness';
import {
  assignedBounds,
  bookValue,
  bookValueAtExpiry,
  callPrice,
  hodlValue,
  legValue,
  spotDomain,
  type PayoffLeg,
} from '../payoff';

const SPOT = 2480.53;
const SIGMA = 0.6;
const TAU = 7 / 365;

const CALL: PayoffLeg = {
  liquidity: 12,
  strike: 2600,
  sigma: SIGMA,
  tau: TAU,
  riskyReserve: 8.41,
  stableReserve: 8449,
  kind: 'call',
};

describe('phi', () => {
  it('agrees with the standard normal at the points everyone knows', () => {
    // Not exact at zero: A&S 7.1.26's coefficients sum to 0.999999999, so erf(0) lands at 1e-9.
    // The router carries the same residual, which is why this is the family to approximate with.
    expect(phi(0)).toBeCloseTo(0.5, 8);
    expect(phi(1)).toBeCloseTo(0.841_344_746, 6);
    expect(phi(-1)).toBeCloseTo(0.158_655_254, 6);
    expect(phi(1.96)).toBeCloseTo(0.975_002_105, 6);
  });

  it('is symmetric and saturates rather than drifting past the bounds', () => {
    for (const z of [0.3, 1.1, 2.7, 5.2]) {
      expect(phi(z) + phi(-z)).toBeCloseTo(1, 6);
    }
    expect(phi(40)).toBe(1);
    expect(phi(-40)).toBe(0);
  });

  it('stays inside the routers own documented Phi error', () => {
    // Gaussian.sol measures max |Phi~ - Phi| = 6.95e-8 against mpmath on [-8, 8]. This is the same
    // A&S 7.1.26 family in double precision, so it should sit in the same neighbourhood.
    expect(Math.abs(phi(0.5) - 0.691_462_461_274)).toBeLessThan(1e-7);
    expect(Math.abs(phi(-2.25) - 0.012_224_472_655)).toBeLessThan(1e-7);
  });
});

describe('moneyness', () => {
  it('puts a call out of the money mostly in risky and a put mostly in stable', () => {
    const call = riskyFraction({ spot: SPOT, strike: 2600, sigma: SIGMA, tau: TAU });
    const put = riskyFraction({ spot: SPOT, strike: 2300, sigma: SIGMA, tau: TAU });
    expect(call).toBeGreaterThan(0.6);
    expect(put).toBeLessThan(0.35);
    // Which side of the strike the reserves start on is the only thing that decides the kind.
    expect(call).toBeGreaterThan(put);
  });

  it('degenerates to a step at the strike once there is no time value', () => {
    expect(riskyFraction({ spot: 2600, strike: 2500, sigma: SIGMA, tau: 0 })).toBe(0);
    expect(riskyFraction({ spot: 2400, strike: 2500, sigma: SIGMA, tau: 0 })).toBe(1);
    expect(d1d2({ spot: 2400, strike: 2500, sigma: 0, tau: TAU }).d1).toBe(-Infinity);
  });

  it('reports the delta an arbitrageur hedges, Phi(-d1)', () => {
    const input = { spot: SPOT, strike: 2600, sigma: SIGMA, tau: TAU };
    expect(positionDelta(input)).toBeCloseTo(phi(-d1d2(input).d1), 12);
  });

  it('never picks a reserve outside the curve domain', () => {
    const L = BigInt('12000000000000000000');
    for (const strike of [1, 100, 2480, 5_000, 1_000_000]) {
      const x = riskyReserveWad(L, { spot: SPOT, strike, sigma: SIGMA, tau: TAU });
      expect(x).toBeGreaterThanOrEqual(BigInt(0));
      expect(x).toBeLessThanOrEqual(L);
    }
    // `stableOf` reverts RmmOutOfDomain above L, so the top of the range must clamp, not overflow.
    expect(riskyReserveWad(L, { spot: 1, strike: 1e9, sigma: SIGMA, tau: TAU })).toBe(L);
  });

  it('rounds a strike to something a person would quote', () => {
    expect(strikeFrom(2480.53, 0.05)).toBe(2600);
    expect(strikeFrom(2480.53, -0.1)).toBe(2200);
    expect(strikeFrom(90_120, 0.1)).toBe(99_000);
    expect(moneynessOf(2600, 2480.53)).toBeCloseTo(0.0482, 4);
  });

  it('offers calls above spot and the put below it', () => {
    for (const chip of MONEYNESS_CHIPS) {
      expect(chip.kind).toBe(chip.offset > 0 ? 'call' : 'put');
    }
  });
});

describe('the payoff model', () => {
  it('is long spot short a call: V = L*(S - C_BS)', () => {
    const value = legValue(CALL, SPOT);
    expect(value).toBeCloseTo(CALL.liquidity * (SPOT - callPrice(SPOT, 2600, SIGMA, TAU)), 9);
  });

  it('matches the put form by parity, which is why one instruction is both', () => {
    // C - P = S - K at r = 0, so L*(S - C) == L*(K - P).
    const call = callPrice(SPOT, 2600, SIGMA, TAU);
    const put = call - SPOT + 2600;
    expect(legValue(CALL, SPOT)).toBeCloseTo(CALL.liquidity * (2600 - put), 9);
  });

  it('collapses to L*min(S, K) at expiry', () => {
    const expired = { ...CALL, tau: 0 };
    expect(legValue(expired, 3000)).toBeCloseTo(12 * 2600, 9);
    expect(legValue(expired, 2000)).toBeCloseTo(12 * 2000, 9);
    expect(bookValueAtExpiry([CALL], 3000)).toBeCloseTo(12 * 2600, 9);
  });

  it('is capped above and steeper below than simply holding the reserves', () => {
    const legs = [CALL];
    const hi = 4000;
    const lo = 1400;
    expect(bookValue(legs, hi)).toBeLessThan(hodlValue(legs, hi));
    expect(bookValue(legs, lo)).toBeLessThan(hodlValue(legs, lo));
    // ... and the gap grows with distance, in both directions. Short vol, stated plainly.
    const nearHi = hodlValue(legs, 2800) - bookValue(legs, 2800);
    const farHi = hodlValue(legs, hi) - bookValue(legs, hi);
    expect(farHi).toBeGreaterThan(nearHi);
  });

  it('names the assigned region from the legs, not from a guess', () => {
    const put: PayoffLeg = { ...CALL, strike: 2300, kind: 'put' };
    expect(assignedBounds([CALL, { ...CALL, strike: 2800 }, put])).toEqual({ above: 2600, below: 2300 });
    expect(assignedBounds([put])).toEqual({ below: 2300 });
    expect(assignedBounds([])).toEqual({});
  });

  it('keeps every strike inside the plotted domain', () => {
    const legs = [CALL, { ...CALL, strike: 3000 }, { ...CALL, strike: 2300, kind: 'put' as const }];
    const [lo, hi] = spotDomain(legs, SPOT);
    expect(lo).toBeLessThan(2300);
    expect(hi).toBeGreaterThan(3000);
    expect(lo).toBeGreaterThanOrEqual(0);
  });
});
