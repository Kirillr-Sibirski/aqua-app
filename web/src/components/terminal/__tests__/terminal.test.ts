import { describe, expect, it } from 'vitest';
import { backingRatio } from '../backing';
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
