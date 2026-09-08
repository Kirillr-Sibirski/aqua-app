/**
 * Dates.
 *
 * The maturity is an argument to the curve, so it is part of the strategy hash. If it moved between
 * the render that priced the offer and the click that signed it, the person would sign something
 * other than what they read — and the sizing query would re-key on every block. Hence a fixed hour,
 * hence UTC everywhere, and hence these assertions.
 */
import { describe, expect, it } from 'vitest';
import {
  EXPIRY_PRESETS,
  MIN_TENOR_SECONDS,
  dateStringFor,
  daysUntil,
  formatByWhen,
  formatExpiry,
  maturityAt,
  maturityForDateString,
  nextFridayAfter,
} from '../expiry';

const DAY = 86_400;
/** 2026-09-08 11:04:00 UTC, a Tuesday. */
const NOW = Math.floor(Date.parse('2026-09-08T11:04:00Z') / 1000);

describe('maturityAt', () => {
  it('lands on 08:00 UTC', () => {
    for (const { days } of EXPIRY_PRESETS) {
      expect(new Date(maturityAt(NOW, days) * 1000).toISOString()).toMatch(/T08:00:00\.000Z$/);
    }
  });

  it('is stable for a whole day, so the strategy hash does not move under the maker', () => {
    const base = maturityAt(NOW, 7);
    for (const drift of [1, 60, 3_600, 12 * 3_600]) {
      if (Math.floor((NOW + drift + 7 * DAY) / DAY) !== Math.floor((NOW + 7 * DAY) / DAY)) continue;
      expect(maturityAt(NOW + drift, 7)).toBe(base);
    }
  });

  it('is always strictly in the future, including on the shortest tenor', () => {
    for (const hour of [0, 7, 8, 9, 23]) {
      const at = Math.floor(Date.parse(`2026-09-08T${String(hour).padStart(2, '0')}:30:00Z`) / 1000);
      for (const { days } of EXPIRY_PRESETS) expect(maturityAt(at, days)).toBeGreaterThan(at);
    }
  });
});

describe('nextFridayAfter', () => {
  it('is the card default, and it is always a Friday at 08:00 UTC', () => {
    // Every hour of a fortnight, which crosses two Fridays and both sides of the two-day floor.
    for (let t = NOW; t < NOW + 14 * DAY; t += 3_600) {
      const m = nextFridayAfter(t);
      const d = new Date(m * 1000);
      expect(d.getUTCDay()).toBe(5);
      expect(d.toISOString()).toMatch(/T08:00:00\.000Z$/);
      expect(m).toBeGreaterThanOrEqual(t + MIN_TENOR_SECONDS);
    }
  });

  it('skips a Friday that is too close rather than offering one that expires first', () => {
    // Thursday evening: this Friday is 13 hours out, so the default is the one after.
    const thursdayNight = Math.floor(Date.parse('2026-09-10T19:00:00Z') / 1000);
    expect(new Date(nextFridayAfter(thursdayNight) * 1000).toISOString()).toBe('2026-09-18T08:00:00.000Z');
  });

  it('takes this week when there is room for it', () => {
    // Tuesday: Friday is three days out and comfortably past the floor.
    expect(new Date(nextFridayAfter(NOW) * 1000).toISOString()).toBe('2026-09-11T08:00:00.000Z');
    // Sunday, which is where the demo fork's clock sits.
    const sunday = Math.floor(Date.parse('2026-09-06T07:56:34Z') / 1000);
    expect(new Date(nextFridayAfter(sunday) * 1000).toISOString()).toBe('2026-09-11T08:00:00.000Z');
  });

  it('never returns a Friday in the past, even at one second before one', () => {
    const justBefore = Math.floor(Date.parse('2026-09-11T07:59:59Z') / 1000);
    expect(nextFridayAfter(justBefore)).toBeGreaterThan(justBefore);
  });
});

describe('the date picker bridge', () => {
  it('round-trips a maturity through the calendar day it falls on', () => {
    for (let t = NOW; t < NOW + 40 * DAY; t += 7 * 3_600) {
      const m = nextFridayAfter(t);
      expect(maturityForDateString(dateStringFor(m))).toBe(m);
    }
  });

  it('stays in UTC, so the day someone clicks is the day the offer expires', () => {
    expect(dateStringFor(Date.parse('2026-09-11T08:00:00Z') / 1000)).toBe('2026-09-11');
    expect(maturityForDateString('2026-09-11')).toBe(Math.floor(Date.parse('2026-09-11T08:00:00Z') / 1000));
  });

  it('returns nothing rather than a guess for anything that is not a calendar day', () => {
    for (const bad of [null, undefined, '', 'tomorrow', '2026-9-11', '2026-13-40', '2026-09-11T08:00:00Z']) {
      expect(maturityForDateString(bad)).toBeUndefined();
    }
  });
});

describe('how a date reads', () => {
  it('is the last word of the card sentence, in UTC and without a locale', () => {
    expect(formatByWhen(maturityForDateString('2026-09-11')!)).toBe('Fri 11 Sep');
    expect(formatByWhen(maturityForDateString('2026-12-04')!)).toBe('Fri 4 Dec');
  });

  it('spells the whole thing out under Details', () => {
    expect(formatExpiry(maturityAt(NOW, 7))).toBe('Tue 15 Sep, 08:00 UTC');
    expect(formatExpiry(maturityAt(NOW, 1))).toBe('Wed 9 Sep, 08:00 UTC');
  });

  it('counts whole days, and never a negative one', () => {
    expect(daysUntil(NOW + 5 * DAY + 3_600, NOW)).toBe(5);
    expect(daysUntil(NOW, NOW + DAY)).toBe(0);
  });
});
