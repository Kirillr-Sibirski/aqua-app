/**
 * The payoff arithmetic, pinned against the fork.
 *
 * The numbers below were measured on the pinned Base fork at block 50946000 with the router's own
 * `stableFor`: a 1 WETH covered call at K = 2,600, sigma = 60%, thirteen days out, drawn against
 * L = 1.449537403114125568. They are chain output, not chosen values, and the identities asserted
 * here — the cap is `K*L`, the two lines meet at `K + earned/x`, and below that they are the same
 * line — are the whole claim the payoff view makes.
 */
import { describe, expect, it } from 'vitest';
import {
  forgonePoints,
  holdPoints,
  holdValue,
  payoffAnchors,
  payoffDomain,
  positionPoints,
  positionValue,
  wadToNumber,
} from '../payoff';

const WAD = BigInt(10) ** BigInt(18);

/** Measured with `stableFor` on the fork. See the module header. */
const MEASURED = {
  strikeWad: BigInt(2600) * WAD,
  liquidityWad: BigInt('1449537403114125568'),
  xWad: WAD,
  yWad: BigInt('1022668477699384468093'),
  /** `stableFor(K, sigma, matured, L, 0)` */
  capWad: BigInt('3768797248096726476800'),
  /** `stableFor(K, sigma, matured, L, x)` */
  settlementWad: BigInt('1168797248096726476800'),
};

describe('payoffAnchors', () => {
  it('reads the cap as K*L, to the wei', () => {
    const expected = (MEASURED.strikeWad * MEASURED.liquidityWad) / WAD;
    expect(MEASURED.capWad).toBe(expected);
  });

  it('derives the premium and the point the two lines part', () => {
    const a = payoffAnchors(MEASURED);
    expect(a).not.toBeNull();
    if (!a) return;

    expect(a.x).toBe(1);
    expect(a.y).toBeCloseTo(1022.668477699384, 9);
    expect(a.cap).toBeCloseTo(3768.797248096726, 9);
    // settlement - y, the payment a taker makes on top of K to be assigned in full.
    expect(a.earned).toBeCloseTo(146.128770397342, 9);
    // K + earned/x.
    expect(a.capSpot).toBeCloseTo(2600 + 146.128770397342, 9);
  });

  it('refuses a leg with nothing on offer, and one whose cap is under its reserves', () => {
    expect(payoffAnchors({ ...MEASURED, xWad: BigInt(0) })).toBeNull();
    expect(payoffAnchors({ ...MEASURED, yWad: MEASURED.capWad })).toBeNull();
  });
});

describe('the two lines', () => {
  const a = payoffAnchors(MEASURED)!;

  it('agree below the cap and diverge above it', () => {
    expect(positionValue(2000, a)).toBeCloseTo(holdValue(2000, a), 9);
    expect(positionValue(a.capSpot, a)).toBeCloseTo(a.cap, 9);
    expect(positionValue(4000, a)).toBeCloseTo(a.cap, 9);
    expect(holdValue(4000, a)).toBeGreaterThan(a.cap);
  });

  it('never beats holding, which is what the shaded region says', () => {
    for (const spot of [500, 1500, 2442.43, 2600, 2746.13, 3200, 9000]) {
      expect(positionValue(spot, a)).toBeLessThanOrEqual(holdValue(spot, a) + 1e-9);
    }
  });

  it('kinks exactly once, inside the drawn domain', () => {
    const domain = payoffDomain(a, 2442.43);
    expect(domain[0]).toBeLessThan(a.capSpot);
    expect(domain[1]).toBeGreaterThan(a.capSpot);

    const points = positionPoints(a, domain);
    expect(points).toHaveLength(3);
    expect(points[1].x).toBeCloseTo(a.capSpot, 9);
    expect(points[1].y).toBeCloseTo(a.cap, 9);

    expect(holdPoints(a, domain)).toHaveLength(2);
  });

  it('shades nothing when the whole domain sits below the cap', () => {
    expect(forgonePoints(a, [1000, 2000])).toHaveLength(0);
    expect(forgonePoints(a, payoffDomain(a, 2442.43))).toHaveLength(3);
  });
});

describe('wadToNumber', () => {
  it('goes through the decimal string rather than dividing a float', () => {
    expect(wadToNumber(BigInt('1022668477699384468093'))).toBe(1022.6684776993844);
    expect(wadToNumber(BigInt(0))).toBe(0);
  });
});
