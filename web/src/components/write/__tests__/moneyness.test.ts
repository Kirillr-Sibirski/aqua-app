/**
 * Where on the curve a leg starts.
 *
 * `moneyness.ts` is the only floating-point arithmetic in the writer that reaches a shipped number,
 * and it is allowed to be because of what it produces: `x` is a *choice*, and a nearby value is a
 * legitimate, differently-moneyed leg. What is not negotiable is the domain. `stableFor` reverts
 * `RmmOutOfDomain` above `L`, and one float step past the end takes the whole leg with it — a leg
 * that reverts on every quote for the rest of its life, under a strategy hash that `Aqua.dock` has
 * already made unshippable forever. So the clamp is tested at both ends and in every degenerate
 * case that could reach it.
 *
 * `y` is not tested here, because `y` is not computed here. It comes from the router
 * (`sizing.fork.test.ts` ships one and proves it trades).
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

const WAD = BigInt(10) ** BigInt(18);
const L = WAD * BigInt(12); // the demo book's near leg

describe('phi', () => {
  it('stays inside the A&S 7.1.26 error bound at the values everyone knows', () => {
    // 7.1.26's stated maximum absolute error on erf is 1.5e-7, which is the whole reason this is
    // allowed to pick a moneyness and forbidden to price a reserve: the router's guard band is
    // 2e-6, more than an order of magnitude above the disagreement this can introduce.
    const BOUND = 1.5e-7;
    for (const [z, exact] of [
      [0, 0.5],
      [1, 0.8413447460685429],
      [-1, 0.15865525393145705],
      [1.959963985, 0.975],
      [-2.5, 0.006209665325776132],
      [3, 0.9986501019683699],
    ] as const) {
      expect(Math.abs(phi(z) - exact)).toBeLessThan(BOUND);
    }
  });

  it('is symmetric and monotone', () => {
    for (const z of [-4, -2.5, -1, -0.25, 0.25, 1, 2.5, 4]) {
      expect(phi(z) + phi(-z)).toBeCloseTo(1, 7);
    }
    let previous = 0;
    for (let z = -6; z <= 6; z += 0.25) {
      const p = phi(z);
      expect(p).toBeGreaterThanOrEqual(previous);
      previous = p;
    }
  });

  it('saturates rather than drifting past the ends', () => {
    expect(phi(40)).toBe(1);
    expect(phi(-40)).toBe(0);
  });
});

describe('d1d2', () => {
  it('separates by exactly sigma*sqrt(tau)', () => {
    const input = { spot: 2_480.53, strike: 2_800, sigma: 0.6, tau: 7 / 365 };
    const { d1, d2 } = d1d2(input);
    expect(d1 - d2).toBeCloseTo(input.sigma * Math.sqrt(input.tau), 12);
  });

  it('degenerates to a step at the strike when there is no time or no vol', () => {
    for (const degenerate of [{ tau: 0 }, { sigma: 0 }]) {
      const base = { spot: 2_480.53, strike: 2_800, sigma: 0.6, tau: 7 / 365 };
      const above = d1d2({ ...base, ...degenerate, spot: 3_000 });
      const below = d1d2({ ...base, ...degenerate, spot: 2_000 });
      expect(above.d1).toBe(Infinity);
      expect(below.d1).toBe(-Infinity);
    }
  });
});

describe('riskyFraction', () => {
  it('is the delta an arbitrageur hedges with, and runs the full range', () => {
    const base = { strike: 2_800, sigma: 0.6, tau: 7 / 365 };
    const deep = riskyFraction({ ...base, spot: 200 });
    const atm = riskyFraction({ ...base, spot: 2_800 });
    const far = riskyFraction({ ...base, spot: 40_000 });
    expect(deep).toBeGreaterThan(0.99);
    expect(far).toBeLessThan(0.01);
    // At the money with r = 0 the reserve sits just under half of L: d1 = sigma*sqrt(tau)/2 > 0.
    expect(atm).toBeGreaterThan(0.4);
    expect(atm).toBeLessThan(0.5);
    expect(positionDelta({ ...base, spot: 2_480.53 })).toBe(
      riskyFraction({ ...base, spot: 2_480.53 }),
    );
  });

  it('falls as spot rises: the call is being assigned', () => {
    const base = { strike: 2_800, sigma: 0.6, tau: 7 / 365 };
    let previous = Number.POSITIVE_INFINITY;
    for (let spot = 1_000; spot <= 6_000; spot += 250) {
      const f = riskyFraction({ ...base, spot });
      // Non-increasing everywhere; the tails saturate at 1 and 0 rather than overshooting, which
      // is the clamp doing its job and not a plateau in the curve.
      expect(f).toBeLessThanOrEqual(previous);
      // Strictly falling wherever the leg is actually live, which is the region a maker writes in.
      if (spot >= 2_000 && spot <= 4_000) expect(f).toBeLessThan(previous);
      previous = f;
    }
  });
});

describe('riskyReserveWad', () => {
  it('never leaves the domain stableFor accepts, at either end', () => {
    const base = { strike: 2_800, sigma: 0.6, tau: 7 / 365 };
    for (const spot of [1e-9, 1, 100, 2_480.53, 2_800, 1e5, 1e12]) {
      const x = riskyReserveWad(L, { ...base, spot });
      expect(x).toBeGreaterThanOrEqual(BigInt(0));
      expect(x).toBeLessThanOrEqual(L);
    }
  });

  it('holds the clamp through every degenerate input a half-typed form can produce', () => {
    for (const input of [
      { spot: 0, strike: 2_800, sigma: 0.6, tau: 7 / 365 },
      { spot: 2_480, strike: 0, sigma: 0.6, tau: 7 / 365 },
      { spot: 2_480, strike: 2_800, sigma: 0, tau: 7 / 365 },
      { spot: 2_480, strike: 2_800, sigma: 0.6, tau: 0 },
      { spot: Number.NaN, strike: 2_800, sigma: 0.6, tau: 7 / 365 },
      { spot: Infinity, strike: 2_800, sigma: 0.6, tau: 7 / 365 },
    ]) {
      const x = riskyReserveWad(L, input);
      expect(x).toBeGreaterThanOrEqual(BigInt(0));
      expect(x).toBeLessThanOrEqual(L);
    }
  });

  it('is zero for a zero-size leg rather than a rounding artefact', () => {
    expect(riskyReserveWad(BigInt(0), { spot: 2_480, strike: 2_800, sigma: 0.6, tau: 0.02 })).toBe(
      BigInt(0),
    );
  });

  it('puts a deeply out-of-the-money call almost entirely in the risky asset', () => {
    const x = riskyReserveWad(L, { spot: 2_480.53, strike: 40_000, sigma: 0.6, tau: 7 / 365 });
    expect(x).toBe(L);
  });
});

describe('strikeFrom', () => {
  it('gives a strike a person would quote, at both ETH and BTC scale', () => {
    expect(strikeFrom(2_480.53, 0.05)).toBe(2_600);
    expect(strikeFrom(2_480.53, 0.1)).toBe(2_700);
    expect(strikeFrom(2_480.53, 0.2)).toBe(3_000);
    expect(strikeFrom(2_480.53, -0.05)).toBe(2_400);
    expect(strikeFrom(91_240, 0.1)).toBe(100_000);
  });

  it('keeps the ordering of the offsets it was given', () => {
    const spot = 2_480.53;
    const strikes = MONEYNESS_CHIPS.map((c) => strikeFrom(spot, c.offset));
    for (let i = 1; i < strikes.length; i += 1) {
      expect(strikes[i]).toBeGreaterThan(strikes[i - 1]);
    }
  });
});

describe('MONEYNESS_CHIPS', () => {
  it('offers the same three steps on each side of spot', () => {
    expect(MONEYNESS_CHIPS.map((c) => c.offset)).toEqual([-0.2, -0.1, -0.05, 0.05, 0.1, 0.2]);
  });

  it('calls sit above spot and puts below, with no chip at the money', () => {
    for (const chip of MONEYNESS_CHIPS) {
      expect(chip.offset).not.toBe(0);
      expect(chip.kind).toBe(chip.offset > 0 ? 'call' : 'put');
      expect(chip.label).toBe(`${chip.offset > 0 ? '+' : '-'}${Math.round(Math.abs(chip.offset) * 100)}%`);
    }
  });
});

describe('moneynessOf', () => {
  it('inverts strikeFrom closely enough to label a row', () => {
    const spot = 2_480.53;
    for (const chip of MONEYNESS_CHIPS) {
      const strike = strikeFrom(spot, chip.offset);
      // The strike was rounded to something quotable, so the label is near the chip, not equal.
      expect(moneynessOf(strike, spot)).toBeCloseTo(chip.offset, 1);
    }
  });

  it('is zero rather than infinite when there is no spot yet', () => {
    expect(moneynessOf(2_800, 0)).toBe(0);
    expect(moneynessOf(2_800, Number.NaN)).toBe(0);
  });
});
