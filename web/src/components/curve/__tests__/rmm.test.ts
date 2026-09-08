/**
 * The encoder for our two custom instructions, pinned byte-for-byte against Solidity.
 *
 * The expected strings below were printed by `RmmSwap.build` and `Coverage.build` themselves, with
 * a throwaway forge test whose inputs are reproduced verbatim here:
 *
 * ```solidity
 * RmmSwap.Args({ flags: 0x07, sigmaWad: 0.6e18, maturity: 1_789_000_000, strikeWad: 2600e18,
 *                liquidityWad: 12e18, rateRisky: 1, rateStable: 1e12 });
 * ```
 *
 * A one-byte drift here does not fail loudly. It changes `keccak256(strategy)`, so `Aqua.ship`
 * succeeds and every subsequent quote reverts `SafeBalancesForTokenNotInActiveStrategy` — which
 * reads on screen as "no liquidity" rather than as an encoding bug. Hence the test.
 */
import { describe, expect, it } from 'vitest';
import {
  ASSIGNMENT_WINDOW_SECONDS,
  COVERAGE_OPCODE,
  EPS_WAD,
  FLAG_POST_EXPIRY_ONE_WAY,
  FLAG_POST_EXPIRY_OUT_IS_RISKY,
  FLAG_RISKY_IS_TOKEN_A,
  RMM_SWAP_OPCODE,
  WAD,
  buildLegProgram,
  decodeCoverageArgs,
  decodeRmmSwapArgs,
  encodeCoverage,
  encodeRmmSwap,
  expiryFlagsFor,
  legKindFor,
  rateFor,
  remainingSeconds,
  tauWad,
  toRawReserve,
  type RmmArgs,
} from '../rmm';
import { explainProgram } from '../program';

const CALL_LEG: RmmArgs = {
  flags: FLAG_RISKY_IS_TOKEN_A | FLAG_POST_EXPIRY_ONE_WAY | FLAG_POST_EXPIRY_OUT_IS_RISKY, // 0x07
  sigmaWad: BigInt('600000000000000000'),
  maturity: 1_789_000_000,
  strikeWad: BigInt('2600000000000000000000'),
  liquidityWad: BigInt('12000000000000000000'),
  rateRisky: BigInt(1),
  rateStable: BigInt('1000000000000'),
};

/** cbBTC-shaped risky (8 decimals) against USDC, a put, no one-way gate. */
const PUT_LEG: RmmArgs = {
  flags: FLAG_RISKY_IS_TOKEN_A,
  sigmaWad: BigInt('420000000000000000'),
  maturity: 1_800_000_123,
  strikeWad: BigInt('2300500000000000000000'),
  liquidityWad: BigInt('6750000000000000000'),
  rateRisky: BigInt('10000000000'),
  rateStable: BigInt('1000000000000'),
};

describe('RmmSwap encoding', () => {
  it('matches RmmSwap.build for an 18/6 covered call', () => {
    expect(encodeRmmSwap(CALL_LEG)).toBe(
      '0x553e070853a0d2313c0000006aa1f940000000000000008cf23f909c0fa000000000000000000000a688906bd8b000000000000000000001000000e8d4a51000',
    );
  });

  it('matches RmmSwap.build for an 8/6 pair with fractional strike and liquidity', () => {
    expect(encodeRmmSwap(PUT_LEG)).toBe(
      '0x553e0105d423c655aa0000006b49d27b000000000000007cb5d9d16dba22000000000000000000005dacd13ca9e3000000000002540be400000000e8d4a51000',
    );
  });

  it('is 64 program bytes: a 2-byte header and 62 arguments', () => {
    const encoded = encodeRmmSwap(CALL_LEG);
    expect((encoded.length - 2) / 2).toBe(64);
    expect(encoded.slice(2, 6)).toBe('553e');
    expect(RMM_SWAP_OPCODE).toBe(0x55);
  });

  it('round-trips through the decoder', () => {
    for (const leg of [CALL_LEG, PUT_LEG]) {
      const args = `0x${encodeRmmSwap(leg).slice(6)}` as const;
      expect(decodeRmmSwapArgs(args)).toEqual(leg);
    }
  });

  it('refuses a field that does not fit its width', () => {
    expect(() => encodeRmmSwap({ ...CALL_LEG, maturity: 2 ** 40 })).toThrow(/maturity/);
    expect(() => encodeRmmSwap({ ...CALL_LEG, sigmaWad: BigInt(2) ** BigInt(64) })).toThrow(/sigmaWad/);
  });
});

describe('Coverage encoding', () => {
  it('matches Coverage.build', () => {
    expect(encodeCoverage({ flags: 0, haircutBps: 0 })).toBe('0x9303000000');
    expect(encodeCoverage({ flags: 1, haircutBps: 250 })).toBe('0x93030100fa');
    expect(COVERAGE_OPCODE).toBe(0x93);
  });

  it('mirrors CoverageHaircutTooLarge', () => {
    expect(() => encodeCoverage({ flags: 0, haircutBps: 10_000 })).toThrow(/CoverageHaircutTooLarge/);
  });

  it('round-trips through the decoder', () => {
    expect(decodeCoverageArgs('0x0100fa')).toEqual({ flags: 1, haircutBps: 250 });
  });
});

describe('the leg program', () => {
  const program = buildLegProgram({
    rmm: CALL_LEG,
    deadline: CALL_LEG.maturity + ASSIGNMENT_WINDOW_SECONDS,
    salt: BigInt(7),
  });

  it('is Deadline . Coverage . RmmSwap . Salt, in that order', () => {
    expect(explainProgram(program).map((i) => i.name)).toEqual([
      'Deadline',
      'Coverage',
      'RmmSwap',
      'Salt',
    ]);
  });

  it('puts Coverage before the curve it wraps', () => {
    const opcodes = explainProgram(program).map((i) => i.opcode);
    expect(opcodes.indexOf(COVERAGE_OPCODE)).toBeLessThan(opcodes.indexOf(RMM_SWAP_OPCODE));
  });

  it('carries no fee instruction', () => {
    // A flat fee would push the reserves off the absolute curve and leak the accrued theta to the
    // next taker. The arbitrageur pays theta, not a fee.
    for (const instruction of explainProgram(program)) {
      expect(instruction.name).not.toMatch(/^Fee/);
    }
  });

  it('accounts for every byte', () => {
    const decoded = explainProgram(program);
    const total = decoded.reduce((sum, i) => sum + i.byteLength, 0);
    expect(total).toBe((program.length - 2) / 2);
    expect(decoded.at(-1)?.offset).toBe(total - (decoded.at(-1)?.byteLength ?? 0));
  });
});

describe('leg shape', () => {
  it('reads the kind off the strike, not off a flag the maker set', () => {
    const spot = BigInt('2480530000000000000000');
    expect(legKindFor(BigInt('2600000000000000000000'), spot)).toBe('call');
    expect(legKindFor(BigInt('2300000000000000000000'), spot)).toBe('put');
  });

  it('gates the assignment window one way, in the direction the kind implies', () => {
    expect(expiryFlagsFor('call')).toBe(FLAG_POST_EXPIRY_ONE_WAY | FLAG_POST_EXPIRY_OUT_IS_RISKY);
    expect(expiryFlagsFor('put')).toBe(FLAG_POST_EXPIRY_ONE_WAY);
  });
});

describe('tau', () => {
  const maturity = 1_789_000_000;

  it('is zero once matured, which is what switches the leg into settlement', () => {
    expect(tauWad(maturity, maturity)).toBe(BigInt(0));
    expect(tauWad(maturity, maturity + 1)).toBe(BigInt(0));
    expect(remainingSeconds(maturity, maturity)).toBe(0);
  });

  it('floors at one hour', () => {
    expect(remainingSeconds(maturity, maturity - 1)).toBe(3600);
    expect(remainingSeconds(maturity, maturity - 3600)).toBe(3600);
    expect(remainingSeconds(maturity, maturity - 3601)).toBe(3601);
  });

  it('matches RmmSwap.tauOf on a seven-day leg', () => {
    // forge: RmmSwap.tauOf(now + 7 days, now) == 19178082191780821
    expect(tauWad(maturity, maturity - 7 * 24 * 3600)).toBe(BigInt('19178082191780821'));
  });
});

describe('normalisation', () => {
  it('lifts a raw balance into WAD space with the same rates the instruction uses', () => {
    expect(rateFor(18)).toBe(BigInt(1));
    expect(rateFor(6)).toBe(BigInt('1000000000000'));
    expect(rateFor(8)).toBe(BigInt('10000000000'));
    expect(() => rateFor(19)).toThrow(RangeError);
  });

  it('rounds a shipped reserve down, so it lands inside the curve rather than outside', () => {
    const rate = rateFor(6);
    // 8,449.123456789 USDC of normalised reserve is only representable to the nearest 1e12.
    const wanted = BigInt('8449123456789000000000');
    const { raw, normalised } = toRawReserve(wanted, rate);
    expect(raw).toBe(BigInt('8449123456'));
    expect(normalised).toBeLessThanOrEqual(wanted);
    expect(wanted - normalised).toBeLessThan(rate);
  });

  it('leaves an 18-decimal reserve untouched', () => {
    const wanted = BigInt('8410000000000000001');
    expect(toRawReserve(wanted, rateFor(18))).toEqual({ raw: wanted, normalised: wanted });
  });

  it('is many orders of magnitude finer than the guard band it sits inside', () => {
    // EPS_OUT on the 12 WETH / 2600 strike leg is (L*K/WAD) * EPS / WAD = 0.0624e18 normalised,
    // against a USDC quantum of 1e12. The rounding above can never be the binding constraint.
    const lk = (CALL_LEG.liquidityWad * CALL_LEG.strikeWad) / WAD;
    const epsOut = (lk * EPS_WAD) / WAD;
    expect(epsOut).toBe(BigInt('62400000000000000'));
    expect(epsOut / rateFor(6)).toBeGreaterThan(BigInt(50_000));
  });
});
