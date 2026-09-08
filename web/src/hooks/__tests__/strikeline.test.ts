/**
 * The book's decoder is the only thing standing between Aqua's `Shipped` bytes and a strike printed
 * on screen, so it is pinned hard: exact byte offsets, exact widths, and the flag bits that decide
 * whether a leg is a covered call or a cash-secured put.
 *
 * The fixtures are the demo book's real parameters (K = 2,600 / sigma = 60% / L = 12, and the
 * 2,300 put), encoded through the same `instruction()` helper the shipping path uses, so a change
 * to either side of the encoding shows up here rather than as a wrong number in the video.
 */
import { describe, expect, it } from 'vitest';
import { concat, instruction, uintN } from '../../lib/swapvm/bytes';
import type { Address, Hex } from 'viem';
import {
  COVERAGE_OPCODE,
  RMM_SWAP_OPCODE,
  boundFromRevert,
  ceilDiv,
  decodeLegProgram,
  decodeRevert,
  disassemble,
  formatCountdown,
  fromWad,
  minBig,
  moneyness,
  parseCoverageArgs,
  parseRmmArgs,
  rateForDecimals,
  ratio,
  replayReserves,
  reserveAt,
  secondsToExpiry,
  sigmaRatio,
  tauSecondsAt,
  toWad,
  type ReserveDelta,
} from '../strikeline';

const WAD = BigInt(10) ** BigInt(18);
const MATURITY = 1_760_000_000;

/** `RmmSwap.build` — 62 argument bytes, in the order `RmmSwap.parse` reads them. */
function rmmSwap(args: {
  flags: number;
  sigmaWad: bigint;
  maturity: number;
  strikeWad: bigint;
  liquidityWad: bigint;
  rateRisky: bigint;
  rateStable: bigint;
}): Hex {
  return instruction(
    RMM_SWAP_OPCODE,
    concat(
      uintN(args.flags, 1),
      uintN(args.sigmaWad, 8),
      uintN(args.maturity, 5),
      uintN(args.strikeWad, 16),
      uintN(args.liquidityWad, 16),
      uintN(args.rateRisky, 8),
      uintN(args.rateStable, 8),
    ),
  );
}

/** `Coverage.build` — `[uint8 flags][uint16 haircutBps]`. */
function coverage(flags: number, haircutBps: number): Hex {
  return instruction(COVERAGE_OPCODE, concat(uintN(flags, 1), uintN(haircutBps, 2)));
}

/** Leg 1 of the demo book: covered call, K = 2,600, sigma 60%, L = 12, WETH/USDC. */
const CALL_2600 = {
  flags: 0b111, // risky is tokenA, one-way after expiry, and that way pays out the risky token
  sigmaWad: (WAD * BigInt(6)) / BigInt(10),
  maturity: MATURITY,
  strikeWad: BigInt(2600) * WAD,
  liquidityWad: BigInt(12) * WAD,
  rateRisky: BigInt(1),
  rateStable: BigInt(10) ** BigInt(12),
} as const;

/** Leg 4: the cash-secured put. Same instruction, stable-heavy, and it delivers stable on assignment. */
const PUT_2300 = { ...CALL_2600, flags: 0b011, strikeWad: BigInt(2300) * WAD, liquidityWad: BigInt(6) * WAD } as const;

describe('disassemble', () => {
  it('walks the [opcode][length][args] stream', () => {
    const program = concat(instruction(0x20, uintN(BigInt(7), 8)), coverage(0, 0), rmmSwap(CALL_2600), instruction(0x02));
    const { instructions, malformed } = disassemble(program);

    expect(malformed).toBe(false);
    expect(instructions.map((i) => i.opcode)).toEqual([0x20, COVERAGE_OPCODE, RMM_SWAP_OPCODE, 0x02]);
    // Salt is 2 + 8 bytes, Coverage 2 + 3, so RmmSwap starts at byte 15 and runs to 79.
    expect(instructions.map((i) => i.offset)).toEqual([0, 10, 15, 79]);
    expect(instructions[3].args).toBe('0x');
  });

  it('reports a truncated stream instead of guessing', () => {
    const truncated = '0x5504aabb' as Hex; // opcode 0x55 claims 4 arg bytes, only 2 follow
    const { instructions, malformed } = disassemble(truncated);
    expect(malformed).toBe(true);
    expect(instructions).toEqual([]);
  });

  it('treats an empty program as empty, not as malformed', () => {
    expect(disassemble('0x')).toEqual({ instructions: [], malformed: false });
  });
});

describe('parseRmmArgs', () => {
  it('reads every field back at its own offset', () => {
    const { instructions } = disassemble(rmmSwap(CALL_2600));
    const args = parseRmmArgs(instructions[0].args);

    expect(args).toMatchObject({
      sigmaWad: (WAD * BigInt(6)) / BigInt(10),
      maturity: MATURITY,
      strikeWad: BigInt(2600) * WAD,
      liquidityWad: BigInt(12) * WAD,
      rateRisky: BigInt(1),
      rateStable: BigInt(10) ** BigInt(12),
      riskyIsTokenA: true,
      postExpiryOneWay: true,
      postExpiryOutIsRisky: true,
    });
  });

  it('distinguishes a put from a call by the settlement-direction flag alone', () => {
    const { instructions } = disassemble(rmmSwap(PUT_2300));
    const args = parseRmmArgs(instructions[0].args);
    expect(args?.postExpiryOneWay).toBe(true);
    expect(args?.postExpiryOutIsRisky).toBe(false);
    expect(args?.strikeWad).toBe(BigInt(2300) * WAD);
  });

  it('refuses arguments that are not 62 bytes', () => {
    expect(parseRmmArgs('0x')).toBeUndefined();
    expect(parseRmmArgs(`0x${'00'.repeat(61)}` as Hex)).toBeUndefined();
    expect(parseRmmArgs(`0x${'00'.repeat(63)}` as Hex)).toBeUndefined();
  });
});

describe('parseCoverageArgs', () => {
  it('reads the flags byte and the haircut', () => {
    expect(parseCoverageArgs('0x010064')).toEqual({ flags: 1, haircutBps: 100 });
  });

  it('refuses anything but three bytes', () => {
    expect(parseCoverageArgs('0x0100')).toBeUndefined();
  });
});

describe('decodeLegProgram', () => {
  it('finds the curve and the guard wrapped around it', () => {
    const decoded = decodeLegProgram(concat(coverage(0, 0), rmmSwap(CALL_2600)));
    expect(decoded.guarded).toBe(true);
    expect(decoded.haircutBps).toBe(0);
    expect(decoded.rmm?.strikeWad).toBe(BigInt(2600) * WAD);
  });

  it('marks a leg shipped without Coverage as unguarded', () => {
    const decoded = decodeLegProgram(rmmSwap(CALL_2600));
    expect(decoded.guarded).toBe(false);
    expect(decoded.rmm).toBeDefined();
  });

  it('returns no leg for a strategy that is not one', () => {
    // FeeFlatIn + XYCSwap: a perfectly good Aqua strategy, but not an option.
    const decoded = decodeLegProgram(concat(instruction(0x60, uintN(BigInt(30_000), 3)), instruction(0x50)));
    expect(decoded.rmm).toBeUndefined();
    expect(decoded.guarded).toBe(false);
    expect(decoded.malformed).toBe(false);
  });
});

describe('unit conversion', () => {
  it('normalises a 6-decimal balance into WAD and back', () => {
    const rate = rateForDecimals(6);
    expect(rate).toBe(BigInt(10) ** BigInt(12));
    expect(toWad(BigInt(24_850_000_000), rate)).toBe(BigInt(24_850) * WAD);
    expect(fromWad(BigInt(24_850) * WAD, rate)).toBe(BigInt(24_850_000_000));
  });

  it('leaves an 18-decimal balance alone', () => {
    expect(rateForDecimals(18)).toBe(BigInt(1));
    expect(toWad(BigInt(10_400_000_000_000_000_000), BigInt(1))).toBe(BigInt(10_400_000_000_000_000_000));
  });

  it('rounds down out of WAD, so a bound is never overstated', () => {
    expect(fromWad(BigInt(1_999_999_999_999), BigInt(10) ** BigInt(12))).toBe(BigInt(1));
  });
});

describe('the chain clock', () => {
  it('floors tau at an hour in the last hour', () => {
    expect(tauSecondsAt(MATURITY, BigInt(MATURITY - 7 * 86_400))).toBe(7 * 86_400);
    expect(tauSecondsAt(MATURITY, BigInt(MATURITY - 60))).toBe(3600);
  });

  it('is zero once matured, which is what switches the leg into settlement', () => {
    expect(tauSecondsAt(MATURITY, BigInt(MATURITY))).toBe(0);
    expect(tauSecondsAt(MATURITY, BigInt(MATURITY + 1))).toBe(0);
  });

  it('reports the real distance to expiry even inside the tau floor', () => {
    expect(secondsToExpiry(MATURITY, BigInt(MATURITY - 60))).toBe(60);
    expect(secondsToExpiry(MATURITY, BigInt(MATURITY + 120))).toBe(-120);
  });

  it('shows two units, largest first', () => {
    expect(formatCountdown(7 * 86_400)).toBe('7d 00h');
    expect(formatCountdown(2 * 86_400 + 5 * 3600)).toBe('2d 05h');
    expect(formatCountdown(4 * 3600 + 9 * 60)).toBe('4h 09m');
    expect(formatCountdown(125)).toBe('2m 05s');
    expect(formatCountdown(58)).toBe('58s');
    expect(formatCountdown(0)).toBe('expired');
    expect(formatCountdown(-1)).toBe('expired');
  });
});

describe('derived display quantities', () => {
  it('reads sigma as a ratio', () => {
    expect(sigmaRatio((WAD * BigInt(6)) / BigInt(10))).toBeCloseTo(0.6, 12);
  });

  it('signs moneyness against the strike', () => {
    // Base fork spot 2,480.53 against the 2,600 call: 4.6% below the strike.
    const spot = BigInt(248_053) * BigInt(10) ** BigInt(16);
    expect(moneyness(spot, BigInt(2600) * WAD)).toBeCloseTo(-0.04595, 8);
    expect(moneyness(spot, BigInt(2300) * WAD)).toBeCloseTo(0.0784913, 7);
    expect(Number.isNaN(moneyness(spot, BigInt(0)))).toBe(true);
  });

  it('never divides by zero for a bar width', () => {
    expect(ratio(BigInt(3), BigInt(0))).toBe(0);
    // Truncating at 1e-6 keeps a bar from ever rendering wider than the value it stands for.
    expect(ratio(BigInt(54) * WAD, BigInt(104) * WAD)).toBe(0.51923);
  });

  it('picks bounds and rounds like the curve', () => {
    expect(minBig(BigInt(5), BigInt(9))).toBe(BigInt(5));
    expect(ceilDiv(BigInt(7), BigInt(2))).toBe(BigInt(4));
    expect(ceilDiv(BigInt(8), BigInt(2))).toBe(BigInt(4));
    expect(ceilDiv(BigInt(1), BigInt(0))).toBe(BigInt(0));
  });
});

describe('decodeRevert', () => {
  const notCovered = {
    name: 'ContractFunctionExecutionError',
    cause: {
      name: 'ContractFunctionRevertedError',
      data: { errorName: 'NotCovered', args: [BigInt(12) * WAD, BigInt(31) * WAD / BigInt(10)] },
    },
  };

  it('walks the cause chain to the contract error', () => {
    expect(decodeRevert(notCovered)).toEqual({ name: 'NotCovered', args: [BigInt(12) * WAD, BigInt(3_100_000_000_000_000_000)] });
  });

  it('reads the guard bound out of the refusal', () => {
    expect(boundFromRevert(notCovered)).toEqual({ bound: BigInt(3_100_000_000_000_000_000), reason: 'wallet', name: 'NotCovered' });
  });

  it('reads the curve bound out of RmmExceedsReserve', () => {
    const exceeds = { cause: { data: { errorName: 'RmmExceedsReserve', args: [BigInt(9), BigInt(4)] } } };
    expect(boundFromRevert(exceeds)).toEqual({ bound: BigInt(4), reason: 'curve', name: 'RmmExceedsReserve' });
  });

  it('has no bound to offer for a one-argument refusal', () => {
    const inside = { cause: { data: { errorName: 'RmmInsideSpread', args: [BigInt(41_200_000)] } } };
    expect(decodeRevert(inside)?.name).toBe('RmmInsideSpread');
    expect(boundFromRevert(inside)).toBeUndefined();
  });

  it('survives a plain error and a self-referential chain', () => {
    expect(decodeRevert(new Error('boom'))).toBeUndefined();
    const loop: { cause?: unknown } = {};
    loop.cause = loop;
    expect(decodeRevert(loop)).toBeUndefined();
  });
});

describe('replayReserves', () => {
  const WETH = '0x4200000000000000000000000000000000000006' as Address;
  const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;
  const HASH = '0xabc0000000000000000000000000000000000000000000000000000000000001' as Hex;
  const SHIP = '0x11'.padEnd(66, '0') as Hex;
  const FILL = '0x22'.padEnd(66, '0') as Hex;

  const delta = (token: Address, amount: bigint, blockNumber: number, logIndex: number, transactionHash: Hex): ReserveDelta => ({
    strategyHash: HASH,
    token,
    amount,
    blockNumber: BigInt(blockNumber),
    logIndex,
    transactionHash,
  });

  it('snapshots the reserves as they stood before the fill, not after it', () => {
    // Ship 8.41 WETH / 8,449 USDC, then a taker pays 2,000 USDC for 0.78 WETH.
    const deltas = [
      delta(WETH, BigInt(8_410_000_000_000_000_000), 100, 1, SHIP),
      delta(USDC, BigInt(8_449_000_000), 100, 2, SHIP),
      delta(USDC, BigInt(2_000_000_000), 140, 5, FILL),
      delta(WETH, -BigInt(780_000_000_000_000_000), 140, 6, FILL),
    ];

    const snapshots = replayReserves(deltas, new Set([FILL.toLowerCase()]));
    const before = snapshots.get(FILL.toLowerCase());

    expect(reserveAt(before, WETH)).toBe(BigInt(8_410_000_000_000_000_000));
    expect(reserveAt(before, USDC)).toBe(BigInt(8_449_000_000));
    expect(snapshots.has(SHIP.toLowerCase())).toBe(false);
  });

  it('replays in chain order regardless of the order the logs arrived in', () => {
    const deltas = [
      delta(WETH, -BigInt(1), 140, 6, FILL),
      delta(WETH, BigInt(10), 100, 1, SHIP),
      delta(WETH, -BigInt(3), 120, 0, '0x33'.padEnd(66, '0') as Hex),
    ];
    const snapshots = replayReserves(deltas, new Set([FILL.toLowerCase()]));
    expect(reserveAt(snapshots.get(FILL.toLowerCase()), WETH)).toBe(BigInt(7));
  });

  it('returns zero for a token the strategy never held', () => {
    expect(reserveAt(undefined, WETH)).toBe(BigInt(0));
  });
});
