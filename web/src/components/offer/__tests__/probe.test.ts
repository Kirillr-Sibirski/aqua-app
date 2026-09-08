/**
 * The two pieces of arithmetic the offer screen owns, and one of them exists because the chain and
 * the published figure once disagreed.
 *
 * `fillProbeAmounts` builds the ladder that turns "the router says the minimum is X" into "the
 * router filled X". Two properties matter and both are checked here: the first rung is one raw unit
 * BELOW the published figure, which is what proves the bound is tight rather than merely reachable;
 * and the rungs above it are strictly increasing, so "the smallest one that cleared" is the first
 * success in the list rather than a minimum over it.
 *
 * `pricePerUnit` is the price column, and it is integer arithmetic on two numbers the router
 * returned so that a rounded price can never drift from the quote it was derived from.
 */
import { describe, expect, it } from 'vitest';
import { fillProbeAmounts } from '../useTakeQuotes';
import { pricePerUnit } from '../TakePanel';

describe('fillProbeAmounts', () => {
  it('opens one raw unit below the published figure, so the bound can be shown to be tight', () => {
    const published = BigInt(226_538_927); // the 2,600 leg's band after three days, in USDC units
    const rungs = fillProbeAmounts(published);
    expect(rungs[0]).toBe(published - BigInt(1));
    expect(rungs[1]).toBe(published);
  });

  it('is strictly increasing, so the first success is the smallest amount that cleared', () => {
    const rungs = fillProbeAmounts(BigInt(226_538_927));
    for (let i = 1; i < rungs.length; i += 1) expect(rungs[i]).toBeGreaterThan(rungs[i - 1]);
  });

  it('steps far enough above the published figure to cross the guard band', () => {
    // `RmmSwap.EPS` is 2e-6 of the leg, which on a band of this size is a few hundred ppm. The
    // ladder has to clear that or a genuine EPS mismatch would come back as "nothing cleared".
    const published = BigInt(226_538_927);
    const rungs = fillProbeAmounts(published);
    const top = rungs[rungs.length - 1];
    expect(Number(top - published) / Number(published)).toBeGreaterThan(0.5);
  });

  it('never probes below one unit, and refuses a published figure of nothing', () => {
    expect(fillProbeAmounts(BigInt(0))).toEqual([]);
    expect(fillProbeAmounts(BigInt(1))[0]).toBe(BigInt(1));
  });
});

describe('pricePerUnit', () => {
  it('divides the two integers the router returned, in the paying token’s units', () => {
    // 2,644.77 USDC in for 1.063611 WETH out -> 2,486.59… USDC each.
    const amountIn = BigInt(2_644_770_000); // 6 decimals
    const amountOut = BigInt('1063611000000000000'); // 18 decimals
    const price = pricePerUnit(amountIn, amountOut, 18);
    expect(price).toBe((amountIn * BigInt(10) ** BigInt(18)) / amountOut);
    expect(Number(price) / 1e6).toBeCloseTo(2486.59, 1);
  });

  it('returns zero rather than dividing by nothing when a quote bought nothing', () => {
    expect(pricePerUnit(BigInt(1), BigInt(0), 18)).toBe(BigInt(0));
  });
});
