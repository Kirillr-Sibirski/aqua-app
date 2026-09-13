import { describe, expect, it } from 'vitest';
import { sellLadder } from '../PriceView';

describe('sellLadder', () => {
  it('prices a constant-sum curve at its slope on every slice', () => {
    const K = 2600;
    const L = 10;
    const samples = Array.from({ length: 11 }, (_, i) => ({ x: i, y: K * (L - i) }));
    const ladder = sellLadder(samples, { x: 7.5, y: K * (L - 7.5) });
    expect(ladder.length).toBe(8);
    for (const step of ladder) expect(step.price).toBeCloseTo(K, 9);
    expect(ladder[0].sold).toBeCloseTo(0.25, 9);
    expect(ladder.at(-1)!.sold).toBeCloseTo(7, 9);
  });

  it('only walks toward less unsold, so a buyer never sees the other side of the curve', () => {
    const samples = [0, 1, 2, 3, 4].map((x) => ({ x, y: (4 - x) * (100 + x) }));
    const ladder = sellLadder(samples, { x: 2, y: 2 * 102 });
    expect(ladder.map((s) => s.sold)).toEqual([0.5, 1.5]);
  });
});
