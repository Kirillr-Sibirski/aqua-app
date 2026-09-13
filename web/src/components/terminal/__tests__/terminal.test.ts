import { describe, expect, it } from 'vitest';
import { backingIsShort, backingRatio } from '../backing';
import { formatPercent } from '@/lib/ui';
import { formatSpan } from '../useSpotWindow';

const ZERO = BigInt(0);
const WAD = BigInt(10) ** BigInt(18);

describe('backingRatio', () => {
  it('is 1 when the offer can deliver everything it advertises', () => {
    expect(backingRatio(WAD * BigInt(9), WAD * BigInt(9))).toBe(1);
  });

  it('is 1, not 0, for an offer with nothing written', () => {
    // A fully-taken or withdrawn leg has a zero reserve. An empty meter there would read as a
    // shortfall on a row where there is nothing left to be short of.
    expect(backingRatio(ZERO, ZERO)).toBe(1);
  });

  it('is 0 when the wallet can deliver none of it', () => {
    expect(backingRatio(ZERO, WAD * BigInt(9))).toBe(0);
  });

  it('is the ratio in between, to four places', () => {
    expect(backingRatio(WAD * BigInt(3), WAD * BigInt(4))).toBeCloseTo(0.75, 10);
    expect(backingRatio((WAD * BigInt(1)) / BigInt(3), WAD)).toBeCloseTo(0.3333, 4);
  });

  it('never exceeds 1, even when the guard reports more than was written', () => {
    // `probe.bound` comes from a revert argument and is not required to be <= the reserve.
    expect(backingRatio(WAD * BigInt(12), WAD * BigInt(9))).toBe(1);
  });

  it('does not lose precision on reserves past Number.MAX_SAFE_INTEGER', () => {
    // 1e6 WETH at 18 decimals is 1e24 — a float numerator would round before dividing.
    const written = WAD * BigInt(1_000_000);
    expect(backingRatio(written / BigInt(2), written)).toBe(0.5);
  });
});

describe('backingIsShort', () => {
  // The one thing that matters: the meter and the figure beside it can never disagree, because the
  // meter's threshold IS the figure's rounding. Asserted against the formatter the row calls.
  const reads100 = (value: number) => formatPercent(value, { fractionDigits: 0 }) === '100%';

  it('agrees with the printed percentage at every boundary around full', () => {
    for (const value of [1, 0.99999, 0.9995, 0.99949, 0.995, 0.9949, 0.99, 0.5, 0]) {
      expect(backingIsShort(value)).toBe(!reads100(value));
    }
  });

  it('was the bug: a figure reading 100% used to sit beside an amber meter', () => {
    // 0.997 prints `100%` and the old `< 0.999` threshold painted the bar amber.
    expect(formatPercent(0.997, { fractionDigits: 0 })).toBe('100%');
    expect(backingIsShort(0.997)).toBe(false);
  });

  it('follows the figure when the figure is printed at more places', () => {
    expect(backingIsShort(0.9994, 0)).toBe(false);
    expect(backingIsShort(0.9994, 2)).toBe(true);
  });

  it('treats a value it cannot read as short, never as full', () => {
    expect(backingIsShort(Number.NaN)).toBe(true);
  });
});

describe('formatSpan', () => {
  it('names the window it actually measured, never a rounded-up 24h', () => {
    expect(formatSpan(45)).toBe('45s');
    expect(formatSpan(240)).toBe('4m');
    expect(formatSpan(7_200)).toBe('2h');
    expect(formatSpan(259_200)).toBe('3d');
  });

  it('never prints a zero span', () => {
    expect(formatSpan(0)).toBe('1s');
  });
});

import { defaultStrike, strikeRefusal } from '../useTicketDraft';

describe('ticket side', () => {
  it('opens a sell above spot and a buy below it', () => {
    expect(defaultStrike(2442.43, 'sell')).toBeGreaterThan(2442.43);
    expect(defaultStrike(2442.43, 'buy')).toBeLessThan(2442.43);
    expect(defaultStrike(2442.43, 'buy')).toBe(2300);
  });

  it('refuses a sell at or under spot and a buy at or over it', () => {
    expect(strikeRefusal(2400, 2442, 'sell')).toBe('Strike below spot');
    expect(strikeRefusal(2442, 2442, 'sell')).toBe('Strike below spot');
    expect(strikeRefusal(2600, 2442, 'sell')).toBeUndefined();
    expect(strikeRefusal(2500, 2442, 'buy')).toBe('Strike above spot');
    expect(strikeRefusal(2442, 2442, 'buy')).toBe('Strike above spot');
    expect(strikeRefusal(2300, 2442, 'buy')).toBeUndefined();
  });

  it('says nothing before the feed answers or while the field is blank', () => {
    expect(strikeRefusal(2300, undefined, 'buy')).toBeUndefined();
    expect(strikeRefusal(Number(''), 2442, 'sell')).toBeUndefined();
  });
});
