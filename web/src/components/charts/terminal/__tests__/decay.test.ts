/**
 * The decay grid.
 *
 * The two properties that matter are the ones a previous rendering got wrong: the series must stop
 * at the tau floor rather than run into it, and a leg already inside the floor must produce no grid
 * at all so the view shows its empty state instead of drawing a flat line at zero.
 */
import { describe, expect, it } from 'vitest';
import { TAU_FLOOR_SECONDS } from '@/components/curve/rmm';
import { ANCHOR_SNAP_SECONDS, decayGrid, snapAnchor, SECONDS_PER_DAY } from '../decay';

const NOW = 1_788_964_265;

describe('decayGrid', () => {
  it('runs from now to the tau floor, oldest first', () => {
    const maturity = NOW + 13 * SECONDS_PER_DAY;
    const grid = decayGrid(maturity, NOW, 25);

    expect(grid).toHaveLength(25);
    expect(grid[0].after).toBe(0);
    expect(grid[0].maturity).toBe(maturity);
    expect(grid[0].days).toBe(0);

    const last = grid[grid.length - 1];
    // The floor, to the minute the grid snaps to.
    expect(maturity - last.maturity).toBeLessThanOrEqual(13 * SECONDS_PER_DAY - TAU_FLOOR_SECONDS);
    expect(last.maturity).toBeGreaterThanOrEqual(NOW + TAU_FLOOR_SECONDS - 60);
    expect(last.days).toBeCloseTo(13 - TAU_FLOOR_SECONDS / SECONDS_PER_DAY, 2);

    for (let i = 1; i < grid.length; i += 1) {
      expect(grid[i].after).toBeGreaterThan(grid[i - 1].after);
      expect(grid[i].maturity).toBeLessThan(grid[i - 1].maturity);
    }
  });

  it('draws nothing for a leg already inside its own tau floor', () => {
    expect(decayGrid(NOW + TAU_FLOOR_SECONDS, NOW, 25)).toHaveLength(0);
    expect(decayGrid(NOW - 1, NOW, 25)).toHaveLength(0);
  });

  it('never asks the router the same question twice inside one multicall', () => {
    // A short-dated leg whose span rounds several neighbouring points onto the same minute.
    const grid = decayGrid(NOW + TAU_FLOOR_SECONDS + 600, NOW, 48);
    const seen = new Set(grid.map((point) => point.maturity));
    expect(seen.size).toBe(grid.length);
  });

  it('clamps the sample count to something a multicall can carry', () => {
    const maturity = NOW + 30 * SECONDS_PER_DAY;
    expect(decayGrid(maturity, NOW, 1)).toHaveLength(2);
    expect(decayGrid(maturity, NOW, 400)).toHaveLength(48);
  });
});

describe('snapAnchor', () => {
  it('quantises the chain clock so the query key survives a block', () => {
    expect(snapAnchor(NOW) % ANCHOR_SNAP_SECONDS).toBe(0);
    expect(snapAnchor(NOW)).toBeLessThanOrEqual(NOW);
    expect(snapAnchor(NOW + 1)).toBe(snapAnchor(NOW));
  });
});
