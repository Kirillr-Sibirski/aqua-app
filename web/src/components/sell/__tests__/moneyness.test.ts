/**
 * Where on the curve an offer starts.
 *
 * `moneyness.ts` is the only floating-point arithmetic on the card that reaches a shipped number,
 * and it is allowed to be because of what it produces: the point on the curve is a *choice*, and a
 * nearby value is a legitimate, slightly differently-priced offer. What is not negotiable is the
 * domain. `stableFor` computes `r = ceilDiv(x*WAD, L)` and reverts `RmmOutOfDomain` when `r > WAD`,
 * so an `L` that lands on or under the amount is an offer that reverts on every quote for the rest
 * of its life — under a strategy hash `Aqua.dock` has already made unshippable forever. There is no
 * recovery, so the bound is tested at both ends and in every degenerate case that can reach it.
 *
 * `y` is not tested here, because `y` is not computed here. It comes from the router
 * (`offer.fork.test.ts` ships one and proves it trades).
 */
import { describe, expect, it } from 'vitest';
import { d1d2, liquidityForRisky, moneynessOf, phi, riskyFraction, strikeFrom } from '../moneyness';

const WAD = BigInt(10) ** BigInt(18);
/** 10.4 WETH: the balance the demo maker actually holds, not a round number. */
const AMOUNT = (WAD * BigInt(104)) / BigInt(10);
const LIVE = { spot: 2_442.43, strike: 2_600, sigma: 0.6, tau: 5 / 365 };

describe('phi', () => {
  it('stays inside the A&S 7.1.26 error bound at the values everyone knows', () => {
    // 7.1.26's stated maximum absolute error on erf is 1.5e-7, which is the whole reason this is
    // allowed to pick a point on the curve and forbidden to price a reserve: the router's guard
    // band is 2e-6, more than an order of magnitude above the disagreement this can introduce.
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
    const { d1, d2 } = d1d2(LIVE);
    expect(d1 - d2).toBeCloseTo(LIVE.sigma * Math.sqrt(LIVE.tau), 12);
  });

  it('degenerates to a step at the price when there is no time or no movement', () => {
    for (const degenerate of [{ tau: 0 }, { sigma: 0 }]) {
      const above = d1d2({ ...LIVE, ...degenerate, spot: 3_000 });
      const below = d1d2({ ...LIVE, ...degenerate, spot: 2_000 });
      expect(above.d1).toBe(Infinity);
      expect(below.d1).toBe(-Infinity);
    }
  });
});

describe('riskyFraction', () => {
  it('runs the full range and never leaves it', () => {
    const base = { strike: 2_800, sigma: 0.6, tau: 7 / 365 };
    expect(riskyFraction({ ...base, spot: 200 })).toBeGreaterThan(0.99);
    expect(riskyFraction({ ...base, spot: 40_000 })).toBeLessThan(0.01);
    // At the money with r = 0 the reserve sits just under half: d1 = sigma*sqrt(tau)/2 > 0.
    const atm = riskyFraction({ ...base, spot: 2_800 });
    expect(atm).toBeGreaterThan(0.4);
    expect(atm).toBeLessThan(0.5);
  });

  it('falls as spot rises: the offer is being assigned', () => {
    const base = { strike: 2_800, sigma: 0.6, tau: 7 / 365 };
    let previous = Number.POSITIVE_INFINITY;
    for (let spot = 1_000; spot <= 6_000; spot += 250) {
      const f = riskyFraction({ ...base, spot });
      expect(f).toBeLessThanOrEqual(previous);
      if (spot >= 2_000 && spot <= 4_000) expect(f).toBeLessThan(previous);
      previous = f;
    }
  });
});

describe('liquidityForRisky', () => {
  it('is strictly greater than the amount, which is the whole domain requirement', () => {
    for (const spot of [1e-9, 1, 100, 2_442.43, 2_600, 1e5, 1e12]) {
      const l = liquidityForRisky(AMOUNT, { ...LIVE, spot });
      expect(l).toBeGreaterThan(AMOUNT);
    }
  });

  it('holds that bound through every degenerate input a half-typed card can produce', () => {
    for (const input of [
      { ...LIVE, spot: 0 },
      { ...LIVE, strike: 0 },
      { ...LIVE, sigma: 0 },
      { ...LIVE, tau: 0 },
      { ...LIVE, spot: Number.NaN },
      { ...LIVE, spot: Infinity },
      { ...LIVE, strike: Infinity },
      { ...LIVE, sigma: Number.NaN },
      { ...LIVE, tau: -1 },
    ]) {
      const l = liquidityForRisky(AMOUNT, input);
      expect(l).toBeGreaterThan(AMOUNT);
      // uint128, and the encoder would throw rather than truncate — but a card that could reach
      // the throw is a card that can be made to fail on a keystroke.
      expect(l).toBeLessThan(BigInt(2) ** BigInt(128));
    }
  });

  it('inverts the fraction it was derived from, to a part in a million', () => {
    const l = liquidityForRisky(AMOUNT, LIVE);
    const back = (Number(l) / 1e18) * riskyFraction(LIVE);
    expect(back).toBeCloseTo(Number(AMOUNT) / 1e18, 4);
  });

  it('needs more notional the further out of the money the price is', () => {
    // Far above spot, almost all of the curve is already the asset, so L is barely over the
    // amount. Near spot, half of it has been sold into stable and L is roughly double.
    const near = liquidityForRisky(AMOUNT, { ...LIVE, strike: 2_500 });
    const far = liquidityForRisky(AMOUNT, { ...LIVE, strike: 6_000 });
    expect(near).toBeGreaterThan(far);
    expect(far).toBeLessThan((AMOUNT * BigInt(101)) / BigInt(100));
  });

  it('is nothing for nothing', () => {
    expect(liquidityForRisky(BigInt(0), LIVE)).toBe(BigInt(0));
    expect(liquidityForRisky(BigInt(-1), LIVE)).toBe(BigInt(0));
  });
});

describe('strikeFrom', () => {
  it('gives a price a person would name, at both ETH and BTC scale', () => {
    expect(strikeFrom(2_480.53, 0.05)).toBe(2_600);
    expect(strikeFrom(2_442.43, 0.05)).toBe(2_600);
    expect(strikeFrom(2_480.53, 0.1)).toBe(2_700);
    expect(strikeFrom(2_480.53, 0.2)).toBe(3_000);
    expect(strikeFrom(91_240, 0.1)).toBe(100_000);
  });

  it('is above spot for a positive offset, which is what the card requires of it', () => {
    for (const spot of [412.7, 2_442.43, 3_919.01, 68_412.5]) {
      expect(strikeFrom(spot, 0.05)).toBeGreaterThan(spot);
    }
  });
});

describe('moneynessOf', () => {
  it('labels the distance from today the way the card states it', () => {
    expect(moneynessOf(2_600, 2_442.43)).toBeCloseTo(0.0645, 4);
  });

  it('is zero rather than infinite when there is no price yet', () => {
    expect(moneynessOf(2_800, 0)).toBe(0);
    expect(moneynessOf(2_800, Number.NaN)).toBe(0);
  });
});
