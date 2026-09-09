/**
 * The two claims a moving figure makes, asserted rather than watched.
 *
 * 1. Every frame is a real quantity in the token's own integer units, between the two readings.
 * 2. The last frame is the reading the chain returned, exactly — not a rounding of it.
 *
 * The second is the one that matters: a ticker that lands on 59.07 when `stableFor` said 59.08 has
 * put a number on a trading screen that no contract ever produced.
 */
import { describe, expect, it } from 'vitest';
import { easeOutQuart, lerpBigInt, lerpNumber, parseDuration } from '../tween';

describe('easeOutQuart', () => {
  it('is pinned at both ends and clamps outside them', () => {
    expect(easeOutQuart(0)).toBe(0);
    expect(easeOutQuart(1)).toBe(1);
    expect(easeOutQuart(-1)).toBe(0);
    expect(easeOutQuart(2)).toBe(1);
  });

  it('is front-loaded: half the time has covered most of the distance', () => {
    expect(easeOutQuart(0.5)).toBeCloseTo(0.9375, 6);
    expect(easeOutQuart(0.25)).toBeGreaterThan(0.68);
  });
});

describe('lerpBigInt', () => {
  const from = BigInt('59080000000000000000'); // 59.08, in WAD
  const to = BigInt('122950000000000000000'); // 122.95

  it('lands on the target exactly, never near it', () => {
    expect(lerpBigInt(from, to, 1)).toBe(to);
    expect(lerpBigInt(from, to, 1.5)).toBe(to);
    expect(lerpBigInt(from, to, 0)).toBe(from);
  });

  it('stays between the two readings at every step', () => {
    for (let i = 0; i <= 20; i += 1) {
      const v = lerpBigInt(from, to, i / 20);
      expect(v >= from).toBe(true);
      expect(v <= to).toBe(true);
    }
  });

  it('runs downhill as well, and still lands', () => {
    expect(lerpBigInt(to, from, 1)).toBe(from);
    const mid = lerpBigInt(to, from, 0.5);
    expect(mid < to).toBe(true);
    expect(mid > from).toBe(true);
  });

  it('moves off the starting value on the very first frame of a real transition', () => {
    // A 16ms frame of a 170ms tween: ~9% of the time, ~32% of the distance under this curve.
    expect(lerpBigInt(from, to, 16 / 170)).toBeGreaterThan(from);
  });

  it('is a no-op when the reading did not change', () => {
    expect(lerpBigInt(from, from, 0.4)).toBe(from);
  });
});

describe('lerpNumber', () => {
  it('lands on the target and stays inside the interval', () => {
    expect(lerpNumber(1, 0.62, 1)).toBe(0.62);
    expect(lerpNumber(1, 0.62, 0)).toBe(1);
    const mid = lerpNumber(1, 0.62, 0.5);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(0.62);
  });
});

describe('parseDuration', () => {
  it('reads the three shapes a duration token can hold', () => {
    expect(parseDuration('170ms')).toBe(170);
    expect(parseDuration(' 1ms ')).toBe(1); // what the reduced-motion block sets
    expect(parseDuration('0.2s')).toBeCloseTo(200, 6);
  });

  it('declines anything that is not a duration, so the caller falls back to the token default', () => {
    expect(parseDuration('')).toBeUndefined();
    expect(parseDuration('fast')).toBeUndefined();
    expect(parseDuration('170')).toBeUndefined();
  });
});
