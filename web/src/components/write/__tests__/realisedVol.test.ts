/**
 * The realised-vol estimator.
 *
 * This is the number the writer compares the maker's implied vol against, and the field turns red
 * on it. A wrong estimate is worse than none, because it would talk a maker out of a book that was
 * priced correctly — or into one that was not. So the arithmetic is pinned against series whose
 * answer is known in closed form rather than against whatever a chain happens to be doing.
 *
 * The property that matters most is the last one. The two sources feeding this estimator sample at
 * completely different rates: a Chainlink feed publishes when it deviates, while reading the price
 * back at past blocks samples on the block clock and returns the same answer many times over. If
 * the estimate moved with the sampling rate, the same market would show one vol from a real feed
 * and another from the fork, and the warning state would be noise.
 */
import { describe, expect, it } from 'vitest';
import { blockLadder, estimateRealisedVol, type PriceObservation } from '../useRealisedVol';

const YEAR = 365 * 24 * 60 * 60;
const HOUR = 3_600;

/**
 * A series with a known annualised vol: `n` steps of `dt` seconds, alternating up and down by a
 * log-return of exactly `r`. Realised variance is `r^2 / dt`, so sigma is `|r| * sqrt(YEAR / dt)`.
 */
function alternating(n: number, dt: number, r: number, start = 2_500): PriceObservation[] {
  const out: PriceObservation[] = [{ at: 1_000_000, price: start }];
  for (let i = 1; i <= n; i += 1) {
    const previous = out[i - 1];
    out.push({ at: previous.at + dt, price: previous.price * Math.exp(i % 2 === 1 ? r : -r) });
  }
  return out;
}

describe('estimateRealisedVol', () => {
  it('recovers the vol of a series whose vol is known', () => {
    const r = 0.01;
    const dt = HOUR;
    const { vol } = estimateRealisedVol(alternating(40, dt, r));
    expect(vol).toBeDefined();
    expect(vol!.sigma).toBeCloseTo(r * Math.sqrt(YEAR / dt), 6);
    expect(vol!.moves).toBe(40);
    expect(vol!.spanSeconds).toBe(40 * dt);
  });

  it('is invariant to the sampling rate, which is what lets two sources agree', () => {
    // The same market, read two ways: once at the four instants it moved, and once at forty blocks
    // that happen to fall between them. The zero returns the second reading adds contribute
    // nothing to sum(r^2) and do not change the span, so the annualised figure is identical.
    const T0 = 1_700_000_000;
    const moves: PriceObservation[] = [
      { at: T0, price: 2_500 },
      { at: T0 + 6 * HOUR, price: 2_560 },
      { at: T0 + 12 * HOUR, price: 2_505 },
      { at: T0 + 18 * HOUR, price: 2_590 },
      { at: T0 + 24 * HOUR, price: 2_530 },
      { at: T0 + 30 * HOUR, price: 2_612 },
      { at: T0 + 36 * HOUR, price: 2_544 },
    ];
    const priceAt = (t: number) => moves.filter((m) => m.at <= t).at(-1)!.price;
    const oversampled: PriceObservation[] = [];
    for (let t = T0; t <= T0 + 36 * HOUR; t += HOUR) oversampled.push({ at: t, price: priceAt(t) });

    const sparse = estimateRealisedVol(moves);
    const dense = estimateRealisedVol(oversampled);

    expect(sparse.vol).toBeDefined();
    expect(dense.vol).toBeDefined();
    expect(dense.vol!.sigma).toBeCloseTo(sparse.vol!.sigma, 10);
    // But the honesty of the readout survives: the dense series says how much it actually read.
    expect(dense.vol!.moves).toBe(sparse.vol!.moves);
    expect(dense.vol!.observations).toBeGreaterThan(sparse.vol!.observations);
  });

  it('counts changes, not readings, so a flat series never passes the gate', () => {
    const flat: PriceObservation[] = Array.from({ length: 60 }, (_, i) => ({
      at: 1_000_000 + i * HOUR,
      price: 2_480.53,
    }));
    const { vol, unavailable } = estimateRealisedVol(flat);
    expect(vol).toBeUndefined();
    expect(unavailable).toMatch(/too few to annualise/);
  });

  it('says so when the feed has published once', () => {
    const { vol, unavailable } = estimateRealisedVol([{ at: 1_000_000, price: 2_480.53 }]);
    expect(vol).toBeUndefined();
    expect(unavailable).toMatch(/only one price/);
  });

  it('sorts, drops junk, and keeps one reading per instant', () => {
    const shuffled = alternating(20, HOUR, 0.008);
    const noisy: PriceObservation[] = [
      ...[...shuffled].reverse(),
      { at: shuffled[3].at, price: 9_999 }, // a duplicate instant, discarded
      { at: 1_000_500, price: 0 }, // a zero price is not a price
      { at: 1_000_600, price: Number.NaN },
      { at: -1, price: 2_500 },
    ];
    const clean = estimateRealisedVol(shuffled);
    const dirty = estimateRealisedVol(noisy);
    expect(dirty.vol!.sigma).toBeCloseTo(clean.vol!.sigma, 12);
    expect(dirty.vol!.observations).toBe(clean.vol!.observations);
  });

  it('never returns a negative or non-finite sigma', () => {
    for (const series of [
      alternating(30, HOUR, 0.0001),
      alternating(30, 1, 0.2),
      alternating(30, YEAR, 0.5),
    ]) {
      const { vol } = estimateRealisedVol(series);
      expect(vol!.sigma).toBeGreaterThan(0);
      expect(Number.isFinite(vol!.sigma)).toBe(true);
    }
  });
});

describe('blockLadder', () => {
  it('ends at the head and spans the requested reach', () => {
    const head = BigInt(50_946_000);
    const ladder = blockLadder(head, 4_096, 40);
    expect(ladder.at(-1)).toBe(head);
    expect(ladder[0]).toBe(head - BigInt(4_096));
    expect(ladder.length).toBe(40);
    // Strictly increasing, so no block is read twice.
    for (let i = 1; i < ladder.length; i += 1) expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
  });

  it('never asks for a negative block on a young chain', () => {
    const ladder = blockLadder(BigInt(12), 4_096, 40);
    expect(ladder[0]).toBe(BigInt(0));
    expect(ladder.at(-1)).toBe(BigInt(12));
    // Twelve blocks cannot supply forty distinct samples, and it returns twelve rather than
    // repeating them: a duplicated block is a duplicated archive call for a reading already held.
    expect(new Set(ladder.map(String)).size).toBe(ladder.length);
  });

  it('degenerates safely at the genesis block', () => {
    expect(blockLadder(BigInt(0), 4_096, 40)).toEqual([BigInt(0)]);
  });
});
