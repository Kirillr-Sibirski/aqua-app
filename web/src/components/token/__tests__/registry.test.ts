/**
 * What the registry promises, pinned.
 *
 * The claim under test is not "USDC maps to two" — it is that a *column* of one token cannot go
 * ragged: whatever the magnitude, the same symbol yields the same number of fraction digits, so
 * the decimal points line up. That is the whole reason the display precision is a property of the
 * token rather than of the value.
 */
import { describe, expect, it } from 'vitest';
import { formatUnits } from '@/lib/ui';
import { fallbackInitial, floorToTokenDigits, tokenFractionDigits, tokenMeta } from '../registry';

/** What `TokenAmount` renders, without the React. */
function render(value: bigint, decimals: number, symbol: string): string {
  const places = tokenFractionDigits(symbol);
  return formatUnits(value, decimals, { minFractionDigits: places, maxFractionDigits: places });
}

const WAD = BigInt('1000000000000000000');

describe('tokenMeta', () => {
  it('is case-insensitive and prints the symbol the brand uses', () => {
    expect(tokenMeta('weth').symbol).toBe('WETH');
    expect(tokenMeta('CBBTC').symbol).toBe('cbBTC');
    expect(tokenMeta('usdc').mark).toBe('usdc');
  });

  it('gives an unknown symbol the neutral mark rather than throwing', () => {
    expect(tokenMeta('AERO').mark).toBe('unknown');
    expect(tokenMeta(undefined).mark).toBe('unknown');
    expect(tokenMeta('  ').symbol).toBe('');
  });
});

describe('display precision', () => {
  it('holds the fraction digits fixed across three orders of magnitude', () => {
    const sizes = [BigInt(4823), WAD / BigInt(10), WAD * BigInt(10), WAD * BigInt(12345)];
    const places = sizes.map((v) => render(v, 18, 'WETH').split('.')[1]?.length);
    expect(places).toEqual([4, 4, 4, 4]);
  });

  it('lines the two figures the positions view used to disagree on', () => {
    // 10.4 WETH in the wallet, 9.92515 WETH promised: one column, one shape.
    expect(render(BigInt('10400000000000000000'), 18, 'WETH')).toBe('10.4000');
    expect(render(BigInt('9925150000000000000'), 18, 'WETH')).toBe('9.9252');
  });

  it('gives a price two places and a bitcoin six', () => {
    expect(render(BigInt(2442430000), 6, 'USDC')).toBe('2,442.43');
    expect(render(BigInt(24850000000), 6, 'USDC')).toBe('24,850.00');
    expect(tokenFractionDigits('cbBTC')).toBe(6);
  });

  it('groups thousands and never lets an 18-decimal string through', () => {
    expect(render(WAD * BigInt(27099), 18, 'WETH')).toBe('27,099.0000');
    expect(render(BigInt('1234567891234567891'), 18, 'WETH')).toBe('1.2346');
  });

  it('marks dust rather than rounding a real balance to zero', () => {
    expect(render(BigInt(4823), 18, 'WETH')).toBe('<0.0001');
    expect(render(BigInt(0), 18, 'WETH')).toBe('0.0000');
  });
});

describe('fallbackInitial', () => {
  it('takes the asset, not the wrapper prefix', () => {
    expect(fallbackInitial('cbBTC')).toBe('B');
    expect(fallbackInitial('stETH')).toBe('E');
    expect(fallbackInitial('aUSDC')).toBe('U');
  });

  it('leaves an ordinary symbol alone', () => {
    expect(fallbackInitial('AERO')).toBe('A');
    expect(fallbackInitial('degen')).toBe('D');
    expect(fallbackInitial(undefined)).toBe('');
  });
});

describe('floorToTokenDigits', () => {
  /**
   * The balance that caught it: 10.330261849452817572 WETH, held by anvil account #1 on the fork.
   *
   * Rounded to four places it is 10.3303; cut to four it is 10.3302. The screen was doing one in
   * the ticket's MAX and the other in the positions strip's promised-over-held ratio, so the same
   * wallet's balance disagreed with itself in the fourth decimal, two hundred pixels apart.
   */
  const BALANCE = BigInt('10330261849452817572');

  it('cuts rather than rounds, so a balance is never printed larger than it is', () => {
    expect(render(BALANCE, 18, 'WETH')).toBe('10.3303');
    expect(render(floorToTokenDigits(BALANCE, 18, 'WETH'), 18, 'WETH')).toBe('10.3302');
  });

  it('agrees with itself wherever the same quantity is printed', () => {
    const cut = floorToTokenDigits(BALANCE, 18, 'WETH');
    // The ticket's field (ungrouped) and the strip's ratio (grouped) are one string of digits.
    expect(formatUnits(cut, 18, { significantDigits: 18, minFractionDigits: 4, maxFractionDigits: 4, group: false })).toBe(
      '10.3302',
    );
    expect(render(cut, 18, 'WETH')).toBe('10.3302');
  });

  it('takes the token its own precision, and is a no-op when there is nothing to cut', () => {
    // USDC is two places at six decimals: 2,442.4399... becomes 2,442.43.
    expect(render(floorToTokenDigits(BigInt(2442439999), 6, 'USDC'), 6, 'USDC')).toBe('2,442.43');
    expect(floorToTokenDigits(WAD, 18, 'WETH')).toBe(WAD);
    // Two decimals asked for two places has no digits past them to cut.
    expect(floorToTokenDigits(BigInt(12345), 2, 'USDC')).toBe(BigInt(12345));
  });

  it('cuts toward zero on both signs, so a magnitude never grows', () => {
    expect(floorToTokenDigits(-BALANCE, 18, 'WETH')).toBe(-floorToTokenDigits(BALANCE, 18, 'WETH'));
  });
});
