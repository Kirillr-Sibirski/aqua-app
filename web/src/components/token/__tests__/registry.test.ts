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
import { fallbackInitial, tokenFractionDigits, tokenMeta } from '../registry';

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
