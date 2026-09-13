/**
 * Sizing a buy offer from the stable a person will spend.
 *
 * The identity is the closed form at spot: `y = L*K*Phi(d2)`, so an `L` chosen from a typed `y` must
 * give that `y` back (a hair under it, by the haircut), and `x` must sit strictly inside `(0, L)`,
 * where `stableFor` will not revert.
 */
import { describe, expect, it } from 'vitest';
import { d1d2, liquidityForStable, phi } from '../moneyness';

const WAD = BigInt(10) ** BigInt(18);
const input = { spot: 2442, strike: 2300, sigma: 0.6, tau: 7 / 365 };

describe('liquidityForStable', () => {
  it('puts the typed stable back on the curve at spot, just under it', () => {
    const typed = BigInt(10_000) * WAD;
    const sized = liquidityForStable(typed, input)!;
    const L = Number(sized.liquidityWad) / 1e18;
    const { d2 } = d1d2(input);
    const y = L * input.strike * phi(d2);
    expect(y).toBeLessThan(10_000);
    expect(y).toBeGreaterThan(9_990);
  });

  it('keeps the risky reserve strictly inside (0, L), stable-heavy below spot', () => {
    const sized = liquidityForStable(BigInt(10_000) * WAD, input)!;
    expect(sized.riskyWad > BigInt(0)).toBe(true);
    expect(sized.riskyWad < sized.liquidityWad).toBe(true);
    // A put below spot holds under half its notional in the risky asset.
    expect(Number(sized.riskyWad) / Number(sized.liquidityWad)).toBeLessThan(0.5);
  });

  it('refuses nothing to spend and a strike of zero', () => {
    expect(liquidityForStable(BigInt(0), input)).toBeUndefined();
    expect(liquidityForStable(WAD, { ...input, strike: 0 })).toBeUndefined();
  });
});
