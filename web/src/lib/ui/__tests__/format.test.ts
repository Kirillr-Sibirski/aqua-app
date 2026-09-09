/**
 * The formatters are the last thing between a bigint and a maker's eyes, so they are pinned hard:
 * exactness, rounding direction, the dust bound, and the absence of any locale dependence.
 *
 * Fixture values are chain-shaped on purpose (irregular amounts, real token decimals), because a
 * suite full of round numbers hides exactly the bugs this module can have.
 */
import { describe, expect, it } from 'vitest';
import {
  bpsToRatio,
  formatBps,
  formatCompact,
  formatCount,
  formatPercent,
  formatRelativeTime,
  formatTokenAmount,
  formatUnits,
  formatUsd,
  parseDecimalInput,
  toDecimalString,
  truncateAddress,
  truncateHash,
} from '../format';

/**
 * tsconfig targets ES2017, where `123n` is a syntax error. This keeps the digit grouping that
 * makes a chain-shaped fixture readable.
 */
const bn = (digits: string): bigint => BigInt(digits.replace(/_/g, ''));

const USDC = 6;
const WETH = 18;

describe('toDecimalString', () => {
  it('keeps every digit, including the last wei', () => {
    expect(toDecimalString(bn('1_000_000_000_000_000_001'), WETH)).toBe('1.000000000000000001');
    expect(toDecimalString(bn('1'), WETH)).toBe('0.000000000000000001');
    expect(toDecimalString(bn('-4_827_193_004'), USDC)).toBe('-4827.193004');
  });

  it('renders zero and whole values without a stray point', () => {
    expect(toDecimalString(bn('0'), WETH)).toBe('0');
    expect(toDecimalString(bn('12_000_000'), USDC)).toBe('12');
  });
});

describe('formatUnits', () => {
  it('spends its significant-digit budget on the leading digits', () => {
    expect(formatUnits(bn('1_234_567_891_234_567_891'), WETH)).toBe('1.23457');
    expect(formatUnits(bn('1_234_567_891_234_567_891'), WETH, { significantDigits: 9 })).toBe(
      '1.23456789',
    );
    expect(formatUnits(bn('4_827_193_004'), USDC)).toBe('4,827.19');
  });

  it('keeps digits past the leading zeros of a sub-unit value', () => {
    // Leading zeros do not spend the significant-digit budget; the fraction ceiling clips the tail.
    expect(formatUnits(bn('123_456_780_000_000'), WETH)).toBe('0.00012346');
    expect(
      formatUnits(bn('123_456_780_000_000'), WETH, { significantDigits: 8, maxFractionDigits: 12 }),
    ).toBe('0.00012345678');
  });

  it('rounds half away from zero and carries into the integer part', () => {
    // 9.9999995 at 7 significant digits carries all the way to 10.
    expect(formatUnits(bn('9_999_999_500_000_000_000'), WETH, { significantDigits: 7 })).toBe('10');
    expect(formatUnits(bn('-1_500_000'), USDC, { maxFractionDigits: 0 })).toBe('-2');
  });

  it('bounds a non-zero value instead of rounding it to nothing', () => {
    expect(formatUnits(bn('4823'), WETH)).toBe('<0.00000001');
    expect(formatUnits(bn('-4823'), WETH)).toBe('>-0.00000001');
    expect(formatUnits(bn('4823'), WETH, { dust: 'zero' })).toBe('0');
    expect(formatUnits(bn('0'), WETH)).toBe('0');
  });

  it('never emits a raw 18-decimal string', () => {
    const raw = toDecimalString(bn('918_273_645_546_372_819'), WETH);
    expect(raw).toHaveLength(20);
    expect(formatUnits(bn('918_273_645_546_372_819'), WETH)).toBe('0.918274');
  });

  it('groups thousands and honours the fraction floor', () => {
    expect(formatUnits(bn('28_419_573_882_004'), USDC, { significantDigits: 18 })).toBe(
      '28,419,573.882004',
    );
    expect(
      formatUnits(bn('28_419_573_882_004'), USDC, { group: false, significantDigits: 18 }),
    ).toBe('28419573.882004');
    expect(formatUnits(bn('7_000_000'), USDC, { minFractionDigits: 2 })).toBe('7.00');
  });

  it('applies the sign policy without printing "-0"', () => {
    expect(formatUnits(bn('4_827_193_004'), USDC, { sign: 'always' })).toBe('+4,827.19');
    expect(formatUnits(bn('-4_827_193_004'), USDC, { sign: 'never' })).toBe('4,827.19');
    expect(formatUnits(bn('-49'), USDC, { maxFractionDigits: 2, dust: 'zero' })).toBe('0');
  });

  it('rejects an impossible scale', () => {
    expect(() => formatUnits(bn('1'), -1)).toThrow(RangeError);
    expect(() => formatUnits(bn('1'), 1.5)).toThrow(RangeError);
  });
});

describe('formatCount', () => {
  it('groups a whole number without truncating it to a significant-digit budget', () => {
    // The bug this guards: the default budget is 6 digits, which would render a Base block height
    // as 50,946,400 — grouped, plausible, and off by 352.
    expect(formatCount(50_946_352)).toBe('50,946,352');
    expect(formatCount(BigInt('50946352'))).toBe('50,946,352');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1_000)).toBe('1,000');
    expect(formatCount(0)).toBe('0');
  });

  it('survives a height past Number.MAX_SAFE_INTEGER when it arrives as a bigint', () => {
    expect(formatCount(BigInt('9007199254740993'))).toBe('9,007,199,254,740,993');
  });
});

describe('formatCompact', () => {
  it('picks the magnitude suffix and keeps three significant digits', () => {
    expect(formatCompact(bn('1_234_567_890_000'), USDC)).toBe('1.23M');
    expect(formatCompact(bn('847_291_004'), USDC)).toBe('847');
    expect(formatCompact(bn('12_408_913_774_221'), USDC)).toBe('12.4M');
    expect(formatCompact(bn('4_182_907_331_559_002'), USDC)).toBe('4.18B');
    expect(formatCompact(bn('9_931_204_887_002_411_336'), USDC)).toBe('9.93T');
  });

  it('drops through to the plain formatter below a thousand', () => {
    expect(formatCompact(bn('38_472_910_000_000_000'), WETH)).toBe('0.0385');
  });

  it('carries the sign', () => {
    expect(formatCompact(bn('-1_234_567_890_000'), USDC)).toBe('-1.23M');
  });
});

describe('formatTokenAmount', () => {
  it('appends the symbol after the figure', () => {
    expect(formatTokenAmount(bn('1_204_384_219'), USDC, { symbol: 'USDC' })).toBe('1,204.38 USDC');
    expect(
      formatTokenAmount(bn('-38_472_910_000_000_000'), WETH, { symbol: 'WETH', sign: 'always' }),
    ).toBe('-0.0384729 WETH');
  });

  it('shows a bound rather than claiming a balance is empty', () => {
    expect(formatTokenAmount(bn('931'), WETH, { symbol: 'WETH' })).toBe('<0.00000001 WETH');
  });

  it('compacts on request', () => {
    expect(
      formatTokenAmount(bn('4_182_907_331_559_002'), USDC, { compact: true, symbol: 'USDC' }),
    ).toBe('4.18B USDC');
  });
});

describe('formatUsd', () => {
  it('always shows cents at or above a dollar so a column aligns', () => {
    expect(formatUsd(bn('120_438'), 2)).toBe('$1,204.38');
    expect(formatUsd(bn('2_841_957_388'), USDC)).toBe('$2,841.96');
    expect(formatUsd(bn('0'), USDC)).toBe('$0.00');
  });

  it('keeps significant digits below a dollar rather than printing $0.00', () => {
    expect(formatUsd(bn('4_271_900_000_000_000'), WETH)).toBe('$0.00427');
    expect(formatUsd(bn('9_120'), USDC)).toBe('$0.00912');
  });

  it('puts the sign outside the currency symbol', () => {
    expect(formatUsd(bn('-2_841_957_388'), USDC)).toBe('-$2,841.96');
    expect(formatUsd(bn('2_841_957_388'), USDC, { sign: 'always' })).toBe('+$2,841.96');
  });

  it('compacts on request', () => {
    expect(formatUsd(bn('1_234_567_890_000'), USDC, { compact: true })).toBe('$1.23M');
    expect(formatUsd(bn('-4_182_907_331_559_002'), USDC, { compact: true })).toBe('-$4.18B');
  });
});

describe('formatPercent and formatBps', () => {
  it('renders a ratio as a percentage', () => {
    expect(formatPercent(0.0512)).toBe('5.12%');
    expect(formatPercent(0.0512, { fractionDigits: 3 })).toBe('5.120%');
    expect(formatPercent(-0.0034, { sign: 'always' })).toBe('-0.34%');
    expect(formatPercent(0.1837, { sign: 'always' })).toBe('+18.37%');
  });

  it('does not print NaN', () => {
    expect(formatPercent(Number.NaN)).toBe('-');
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('-');
  });

  it('treats basis points as their own unit', () => {
    expect(formatBps(30)).toBe('30 bps');
    expect(formatBps(bn('2500'))).toBe('2,500 bps');
    expect(bpsToRatio(30)).toBeCloseTo(0.003, 12);
    expect(formatPercent(bpsToRatio(30))).toBe('0.30%');
  });
});

describe('parseDecimalInput', () => {
  it('round-trips through the exact renderer', () => {
    const parsed = parseDecimalInput('4827.193004', USDC);
    expect(parsed).toBe(bn('4_827_193_004'));
    expect(toDecimalString(parsed!, USDC)).toBe('4827.193004');
  });

  it('truncates rather than rounding past the token scale', () => {
    expect(parseDecimalInput('0.1234567', USDC)).toBe(bn('123_456'));
  });

  it('accepts partial input a person is still typing', () => {
    expect(parseDecimalInput('.5', WETH)).toBe(bn('500_000_000_000_000_000'));
    expect(parseDecimalInput('12.', USDC)).toBe(bn('12_000_000'));
    expect(parseDecimalInput(' 1,204.38 ', USDC)).toBe(bn('1_204_380_000'));
    expect(parseDecimalInput('-0.5', USDC)).toBe(bn('-500_000'));
  });

  it('returns null for anything that is not a decimal number', () => {
    expect(parseDecimalInput('', USDC)).toBeNull();
    expect(parseDecimalInput('-', USDC)).toBeNull();
    expect(parseDecimalInput('.', USDC)).toBeNull();
    expect(parseDecimalInput('1e18', USDC)).toBeNull();
    expect(parseDecimalInput('0x1f', USDC)).toBeNull();
  });
});

describe('truncateAddress and truncateHash', () => {
  const address = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984';
  const hash = '0x8f2c41ab9d7e0431c6a5f0b2d93884e17c0a94ff2b6d38e5c1a70943bd6e2f18';

  it('cuts the middle out, keeping the ends a person compares', () => {
    expect(truncateAddress(address)).toBe('0x1f98…F984');
    expect(truncateHash(hash)).toBe('0x8f2c41ab…bd6e2f18');
  });

  it('honours custom widths', () => {
    expect(truncateAddress(address, { lead: 10, tail: 6 })).toBe('0x1f9840a8…01F984');
  });

  it('leaves a string that is already short enough alone', () => {
    expect(truncateAddress('0x1f9840')).toBe('0x1f9840');
  });

  it('does not change case, so a checksummed address stays checksummed', () => {
    expect(truncateAddress(address)).toContain('F984');
  });
});

describe('formatRelativeTime', () => {
  // 2026-09-05T14:22:09Z, a fixed reference so the suite never depends on the clock.
  const now = Date.UTC(2026, 8, 5, 14, 22, 9);

  it('reads chain timestamps as seconds and Date/number as milliseconds', () => {
    const chainSeconds = BigInt(Math.floor(now / 1000) - 47);
    expect(formatRelativeTime(chainSeconds, { now })).toBe('47s ago');
    expect(formatRelativeTime(now - 47_000, { now })).toBe('47s ago');
    expect(formatRelativeTime(new Date(now - 47_000), { now })).toBe('47s ago');
  });

  it('steps through the units', () => {
    expect(formatRelativeTime(now - 2_000, { now })).toBe('just now');
    expect(formatRelativeTime(now - 8 * 60_000 - 4_000, { now })).toBe('8m ago');
    expect(formatRelativeTime(now - 3 * 3_600_000, { now })).toBe('3h ago');
    expect(formatRelativeTime(now - 2 * 86_400_000, { now })).toBe('2d ago');
  });

  it('switches to an absolute date once relative stops helping', () => {
    expect(formatRelativeTime(now - 19 * 86_400_000, { now })).toBe('17 Aug');
    expect(formatRelativeTime(Date.UTC(2025, 2, 14, 9, 0, 0), { now })).toBe('14 Mar 2025');
  });

  it('phrases future instants as a countdown', () => {
    expect(formatRelativeTime(now + 4 * 60_000, { now })).toBe('in 4m');
    expect(formatRelativeTime(now + 1_500, { now })).toBe('in a moment');
  });
});
