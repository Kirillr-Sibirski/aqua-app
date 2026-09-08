/**
 * Maturities.
 *
 * The maturity is an argument to `RmmSwap`, so it is part of the strategy hash. If it moved between
 * the render that priced the book and the click that signed it, the maker would sign a different
 * position than the one they reviewed — and the sizing query would re-key on every block. Hence a
 * fixed hour, and hence these assertions.
 */
import { describe, expect, it } from 'vitest';
import { EXPIRY_PRESETS, formatExpiry, maturityAt } from '../expiry';

/** 2026-09-08 11:04:00 UTC, the block timestamp the local fork was bootstrapped at. */
const NOW = Math.floor(Date.parse('2026-09-08T11:04:00Z') / 1000);

describe('maturityAt', () => {
  it('lands on 08:00 UTC', () => {
    for (const { days } of EXPIRY_PRESETS) {
      const m = maturityAt(NOW, days);
      expect(new Date(m * 1000).toISOString()).toMatch(/T08:00:00\.000Z$/);
    }
  });

  it('is stable for a whole day, so the strategy hash does not move under the maker', () => {
    const base = maturityAt(NOW, 7);
    for (const drift of [1, 60, 3_600, 12 * 3_600, 20 * 3_600]) {
      // Anything that keeps the target inside the same UTC day gives the same maturity.
      if (Math.floor((NOW + drift + 7 * 86_400) / 86_400) !== Math.floor((NOW + 7 * 86_400) / 86_400)) {
        continue;
      }
      expect(maturityAt(NOW + drift, 7)).toBe(base);
    }
  });

  it('is always strictly in the future, including on the shortest tenor', () => {
    // 09:00 UTC + 1 day rounds down to a 08:00 that is only 23 hours out, not one that has passed.
    for (const hour of [0, 7, 8, 9, 23]) {
      const at = Math.floor(Date.parse(`2026-09-08T${String(hour).padStart(2, '0')}:30:00Z`) / 1000);
      for (const { days } of EXPIRY_PRESETS) {
        expect(maturityAt(at, days)).toBeGreaterThan(at);
      }
    }
  });

  it('grows with the tenor', () => {
    const maturities = EXPIRY_PRESETS.map((p) => maturityAt(NOW, p.days));
    for (let i = 1; i < maturities.length; i += 1) {
      expect(maturities[i]).toBeGreaterThan(maturities[i - 1]);
    }
  });
});

describe('formatExpiry', () => {
  it('reads the way a maker says it out loud, in UTC and without a locale', () => {
    expect(formatExpiry(maturityAt(NOW, 7))).toBe('Tue 15 Sep, 08:00 UTC');
    expect(formatExpiry(maturityAt(NOW, 1))).toBe('Wed 9 Sep, 08:00 UTC');
  });
});
