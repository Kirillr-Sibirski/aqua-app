import { describe, expect, it } from 'vitest';
import { buyLadder, ladderRegions, sellLadder } from '../PriceView';

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

describe('buyLadder', () => {
  it('walks toward more risky held, measuring from the reserve', () => {
    const K = 2300;
    const L = 10;
    const samples = Array.from({ length: 11 }, (_, i) => ({ x: i, y: K * (L - i) }));
    const ladder = buyLadder(samples, { x: 2.5, y: K * (L - 2.5) });
    expect(ladder.length).toBe(8);
    for (const step of ladder) expect(step.price).toBeCloseTo(K, 9);
    expect(ladder[0].sold).toBeCloseTo(0.25, 9);
    expect(ladder.at(-1)!.sold).toBeCloseTo(7, 9);
  });

  it('prices falling as a put fills, on a convex curve', () => {
    const samples = [0, 1, 2, 3, 4].map((x) => ({ x, y: 1000 / (x + 1) }));
    const ladder = buyLadder(samples, samples[0]);
    for (let i = 1; i < ladder.length; i += 1) expect(ladder[i].price).toBeLessThan(ladder[i - 1].price);
  });
});

describe('ladderRegions', () => {
  const ladder = [
    { sold: 0, price: 2400 },
    { sold: 1, price: 2600 },
    { sold: 2, price: 2800 },
  ];

  it('calls the part above the strike better when selling', () => {
    const { better, worse } = ladderRegions(ladder, 2600, 'sell');
    expect(better.slice(0, 3).map((p) => p.y)).toEqual([2600, 2600, 2800]);
    expect(worse.slice(0, 3).map((p) => p.y)).toEqual([2400, 2600, 2600]);
  });

  it('mirrors it when buying: below the strike is better', () => {
    const { better, worse } = ladderRegions(ladder, 2600, 'buy');
    expect(better.slice(0, 3).map((p) => p.y)).toEqual([2400, 2600, 2600]);
    expect(worse.slice(0, 3).map((p) => p.y)).toEqual([2600, 2600, 2800]);
  });

  it('closes each region back along the strike', () => {
    const { better } = ladderRegions(ladder, 2600, 'sell');
    expect(better.slice(-2)).toEqual([
      { x: 2, y: 2600 },
      { x: 0, y: 2600 },
    ]);
  });
});
