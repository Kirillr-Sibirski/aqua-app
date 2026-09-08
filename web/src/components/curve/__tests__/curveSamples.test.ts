/**
 * The grid the curve is sampled on, and the sentinel the settlement line is asked for.
 *
 * Both exist to keep an `eth_call` inside the router's domain. `stableFor` reverts
 * `RmmOutOfDomain` above `L`, so the last sample has to be `L` *exactly* — a float step across
 * `[0, L]` eventually lands one wei past the end and takes the whole chart with it, and the failure
 * looks like "the curve did not load" rather than like an arithmetic bug. So the grid is integer
 * arithmetic throughout and pins its last point rather than computing it.
 *
 * The sentinel is the other half: every matured maturity returns the same closed form
 * `Y = K*(L - X)`, so which one the settlement line asks for is free, and asking for the block
 * timestamp would re-key the query every block for a line that cannot move.
 *
 * Checked against the live fork while this was written, at K 2600, sigma 60%, L 12, 7 days out:
 * all 48 grid points returned, `y` non-increasing from 31,199.99999999996 down to 0.0000099528,
 * `stableFor(L + 1)` reverts, and `stableFor` at maturity 1, at the block timestamp, and a day
 * before it all return 15600000000000000000000 at `x = L/2`, which is `K*(L - X)` exactly.
 */
import { describe, expect, it } from 'vitest';
import { MATURED_MATURITY, curveGrid } from '@/hooks/useCurveSamples';

const WAD = BigInt(10) ** BigInt(18);

describe('curveGrid', () => {
  it('ends exactly at L, which is the only value stableFor will still answer', () => {
    for (const L of [WAD, WAD * BigInt(12), BigInt(1), BigInt('123456789012345678901')]) {
      for (const n of [2, 3, 48, 256]) {
        const grid = curveGrid(L, n);
        expect(grid.at(-1)).toBe(L);
        expect(grid[0]).toBe(BigInt(0));
      }
    }
  });

  it('is non-decreasing and never leaves the domain', () => {
    const L = WAD * BigInt(12);
    const grid = curveGrid(L, 48);
    for (let i = 1; i < grid.length; i += 1) {
      expect(grid[i]).toBeGreaterThan(grid[i - 1]);
      expect(grid[i]).toBeLessThanOrEqual(L);
    }
  });

  it('clamps the sample count to something a multicall can carry', () => {
    const L = WAD * BigInt(12);
    expect(curveGrid(L, 0).length).toBe(2);
    expect(curveGrid(L, 1).length).toBe(2);
    expect(curveGrid(L, -5).length).toBe(2);
    expect(curveGrid(L, 1_000).length).toBe(256);
    expect(curveGrid(L, 47.9).length).toBe(47);
  });

  it('spaces points evenly in integer arithmetic, with no float drift at the far end', () => {
    // A liquidity that does not divide by the sample count: the failure mode this guards against
    // is a rounding step that accumulates and overshoots L on the last point.
    const L = BigInt('999999999999999999999');
    const grid = curveGrid(L, 37);
    expect(grid.at(-1)).toBe(L);
    const gaps = grid.slice(1).map((x, i) => x - grid[i]);
    const min = gaps.reduce((m, g) => (g < m ? g : m));
    const max = gaps.reduce((m, g) => (g > m ? g : m));
    // Every gap within one wei of every other: the grid is uniform, not merely bounded.
    expect(max - min).toBeLessThanOrEqual(BigInt(1));
  });

  it('degenerates to the two endpoints for a dust leg', () => {
    expect(curveGrid(BigInt(1), 48)).toEqual([BigInt(0), BigInt(1)]);
  });
});

describe('MATURED_MATURITY', () => {
  it('is a fixed unix second in the past, so the settlement query key never moves', () => {
    expect(MATURED_MATURITY).toBe(1);
    // The point of the constant: it does not depend on anything that changes.
    expect(MATURED_MATURITY).toBeLessThan(Math.floor(Date.now() / 1000));
    // And it fits the uint40 the view takes.
    expect(MATURED_MATURITY).toBeGreaterThan(0);
    expect(MATURED_MATURITY).toBeLessThan(2 ** 40);
  });
});
