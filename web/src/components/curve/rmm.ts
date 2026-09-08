/**
 * A Strikeline leg, in TypeScript: the four instructions it compiles to, and the router views that
 * size it.
 *
 * The contract is `contracts/src/instructions/RmmSwap.sol` (opcode `0x55`) and
 * `contracts/src/instructions/Coverage.sol` (`0x93`). Both are encoded here by hand rather than
 * through `@/lib/swapvm/instructions`, because that module mirrors the upstream 1inch instruction
 * set and these two are ours; `customInstruction` is the seam it exposes for exactly this. Every
 * byte layout below is copied from the Solidity `build()` and pinned by
 * `__tests__/rmm.test.ts` against vectors printed by `forge`.
 *
 * WHAT IS NOT HERE, ON PURPOSE: the curve. There is no `Phi`, no `Phi^-1` and no `stableOf` in this
 * file or anywhere else in the app. A wei-exact TypeScript port of the A&S erf plus a bisected
 * inverse is the single most likely way to make the screen disagree with the chain, and disagreeing
 * by one wei at ship time is not a rounding error — it is a bricked strategy, because `Aqua.ship`
 * requires `tokensCount == 0` and a docked hash can never be re-shipped. So the chain is asked:
 * `stableFor()` returns the reserve to ship, and `quote()`/`stableFor()` draw every curve pixel.
 *
 * Float maths appears in exactly two places in this feature, both labelled: `moneyness.ts` picks
 * *where* on the curve a leg starts (a choice, not a value), and `payoff.ts` draws the illustrative
 * payoff overlay, which the UI marks "model".
 */
import type { Hex } from 'viem';
import { concat, customInstruction, ix, uintN } from '@/lib/swapvm';

// ---------------------------------------------------------------------------
// Constants, mirrored from Solidity
// ---------------------------------------------------------------------------

/** `RmmSwap.opcode` — `Opcode._55`, in the curve bank `0x50-0x6f`. */
export const RMM_SWAP_OPCODE = 0x55;
/** `Coverage.opcode` — `Opcode._93`, in the balances-tuning bank `0x90-0xaf`. */
export const COVERAGE_OPCODE = 0x93;

export const WAD = BigInt(10) ** BigInt(18);
export const YEAR_SECONDS = 365 * 24 * 60 * 60;
/** `RmmSwap.TAU_FLOOR`: keeps gamma finite in the last hour before maturity. */
export const TAU_FLOOR_SECONDS = 60 * 60;
/** `RmmSwap.EPS` = `2e-6 * 1e18`. The maker-favouring guard band, absolute in normalised units. */
export const EPS_WAD = BigInt(2_000_000_000_000);

/** `RmmSwap.FLAG_RISKY_IS_TOKEN_A` — the risky asset is the token with the lower address. */
export const FLAG_RISKY_IS_TOKEN_A = 1 << 0;
/** `RmmSwap.FLAG_POST_EXPIRY_ONE_WAY` — after maturity the leg only trades in one direction. */
export const FLAG_POST_EXPIRY_ONE_WAY = 1 << 1;
/** `RmmSwap.FLAG_POST_EXPIRY_OUT_IS_RISKY` — which direction that is. */
export const FLAG_POST_EXPIRY_OUT_IS_RISKY = 1 << 2;

/** `Coverage.FLAG_CHECK_TOKEN_IN` — also require the input leg to be receivable. */
export const COVERAGE_FLAG_CHECK_TOKEN_IN = 1 << 0;

/** `Coverage.BPS` — the haircut denominator. */
export const COVERAGE_BPS = 10_000;

/** How long past maturity the assignment window stays open. Minutes, not days. */
export const ASSIGNMENT_WINDOW_SECONDS = 30 * 60;

// ---------------------------------------------------------------------------
// RmmSwap
// ---------------------------------------------------------------------------

/**
 * `RmmSwap.Args` — 62 bytes.
 *
 * ```
 * [uint8 flags][uint64 sigmaWad][uint40 maturity][uint128 strikeWad]
 * [uint128 liquidityWad][uint64 rateRisky][uint64 rateStable]
 * ```
 */
export interface RmmArgs {
  flags: number;
  /** Annualised implied volatility, WAD. `0.6e18` is 60%. */
  sigmaWad: bigint;
  /** Unix seconds. */
  maturity: number;
  /** `K`, WAD, normalised stable per risky. */
  strikeWad: bigint;
  /** `L`, WAD, in risky units. Fixed for the life of the leg. */
  liquidityWad: bigint;
  /** Raw-to-normalised multiplier for the risky token: `10 ** (18 - decimals)`. */
  rateRisky: bigint;
  /** The same for the stable token. */
  rateStable: bigint;
}

export const RMM_ARGS_BYTES = 62;

/** `10 ** (18 - decimals)`, the multiplier that lifts a raw balance into normalised WAD space. */
export function rateFor(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new RangeError(`token decimals must be 0..18, got ${decimals}`);
  }
  return BigInt(10) ** BigInt(18 - decimals);
}

/** The 62 argument bytes, without the `[opcode][len]` header. */
export function encodeRmmSwapArgs(a: RmmArgs): Hex {
  return concat(
    uintN(a.flags, 1, 'flags'),
    uintN(a.sigmaWad, 8, 'sigmaWad'),
    uintN(a.maturity, 5, 'maturity'),
    uintN(a.strikeWad, 16, 'strikeWad'),
    uintN(a.liquidityWad, 16, 'liquidityWad'),
    uintN(a.rateRisky, 8, 'rateRisky'),
    uintN(a.rateStable, 8, 'rateStable'),
  );
}

/** The whole instruction: `55 3e` then the 62 argument bytes. */
export function encodeRmmSwap(a: RmmArgs): Hex {
  return customInstruction(RMM_SWAP_OPCODE, encodeRmmSwapArgs(a));
}

function readUint(args: Hex, offset: number, bytes: number): bigint {
  const start = 2 + offset * 2;
  const slice = args.slice(start, start + bytes * 2);
  if (slice.length !== bytes * 2) throw new RangeError('RmmSwap args are truncated');
  return BigInt(`0x${slice}`);
}

/** Inverse of {@link encodeRmmSwapArgs}. Takes the args only, not the instruction. */
export function decodeRmmSwapArgs(args: Hex): RmmArgs {
  return {
    flags: Number(readUint(args, 0, 1)),
    sigmaWad: readUint(args, 1, 8),
    maturity: Number(readUint(args, 9, 5)),
    strikeWad: readUint(args, 14, 16),
    liquidityWad: readUint(args, 30, 16),
    rateRisky: readUint(args, 46, 8),
    rateStable: readUint(args, 54, 8),
  };
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

export interface CoverageArgs {
  flags: number;
  /** Fraction of the wallet withheld from the deliverable figure, in 1e4 bps. `< 10000`. */
  haircutBps: number;
}

export const COVERAGE_ARGS_BYTES = 3;

export function encodeCoverageArgs(a: CoverageArgs): Hex {
  if (a.haircutBps >= COVERAGE_BPS) {
    throw new RangeError(`CoverageHaircutTooLarge(${a.haircutBps})`);
  }
  return concat(uintN(a.flags, 1, 'flags'), uintN(a.haircutBps, 2, 'haircutBps'));
}

/** The whole instruction: `93 03` then three argument bytes. */
export function encodeCoverage(a: CoverageArgs): Hex {
  return customInstruction(COVERAGE_OPCODE, encodeCoverageArgs(a));
}

export function decodeCoverageArgs(args: Hex): CoverageArgs {
  return { flags: Number(readUint(args, 0, 1)), haircutBps: Number(readUint(args, 1, 2)) };
}

// ---------------------------------------------------------------------------
// The program
// ---------------------------------------------------------------------------

export interface LegProgramArgs {
  rmm: RmmArgs;
  coverage?: CoverageArgs;
  /**
   * Hard end of the assignment window: `maturity + 30 minutes`, not days. Past it the leg quotes
   * nothing at all, so an expired position is not a free constant-sum order left on the books.
   */
  deadline: number;
  /**
   * A maker-owned strictly monotonic nonce. `Aqua.ship` requires `tokensCount == 0` and `dock`
   * writes `0xff` permanently, so a docked strategy hash can never be re-shipped — every roll to
   * the same economic parameters has to bump this or the second ship reverts.
   */
  salt: bigint;
}

/**
 * `Deadline . Coverage . RmmSwap . Salt`.
 *
 * `Coverage` precedes the curve because it *wraps* it: its `exec` calls `ctx.runLoop()` to price on
 * the true shipped reserves and only then checks that the priced output is deliverable. Clamping
 * `balanceOut` before the curve ran would move the reserve point and therefore change the price,
 * which quotes a different option than the maker wrote.
 */
export function buildLegProgram({ rmm, coverage, deadline, salt }: LegProgramArgs): Hex {
  return concat(
    ix.deadline(deadline),
    encodeCoverage(coverage ?? { flags: 0, haircutBps: 0 }),
    encodeRmmSwap(rmm),
    ix.salt(salt),
  );
}

// ---------------------------------------------------------------------------
// Router views
// ---------------------------------------------------------------------------

/**
 * `StrikelineViews`, the read-only surface on the router.
 *
 * `stableFor` is the important one and the reason this ABI exists: it is the trading function
 * evaluated with the router's own approximated `Phi`, rounded up. Every leg is sized through it,
 * and every curve pixel that is not a `quote()` is sampled from it.
 */
export const strikelineViewsAbi = [
  {
    type: 'function',
    name: 'stableFor',
    stateMutability: 'view',
    inputs: [
      { name: 'strikeWad', type: 'uint128' },
      { name: 'sigmaWad', type: 'uint64' },
      { name: 'maturity', type: 'uint40' },
      { name: 'liquidityWad', type: 'uint128' },
      { name: 'xWad', type: 'uint256' },
    ],
    outputs: [{ name: 'yWad', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'riskyFor',
    stateMutability: 'view',
    inputs: [
      { name: 'strikeWad', type: 'uint128' },
      { name: 'sigmaWad', type: 'uint64' },
      { name: 'maturity', type: 'uint40' },
      { name: 'liquidityWad', type: 'uint128' },
      { name: 'yWad', type: 'uint256' },
    ],
    outputs: [{ name: 'xWad', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'tauNow',
    stateMutability: 'view',
    inputs: [{ name: 'maturity', type: 'uint40' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'coverage',
    stateMutability: 'view',
    inputs: [
      { name: 'maker', type: 'address' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'bandFor',
    stateMutability: 'view',
    inputs: [
      { name: 'strikeWad', type: 'uint128' },
      { name: 'sigmaWad', type: 'uint64' },
      { name: 'maturity', type: 'uint40' },
      { name: 'liquidityWad', type: 'uint128' },
      { name: 'xWad', type: 'uint256' },
      { name: 'yWad', type: 'uint256' },
    ],
    outputs: [
      { name: 'minRiskyIn', type: 'uint256' },
      { name: 'minStableIn', type: 'uint256' },
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// Leg shape
// ---------------------------------------------------------------------------

/**
 * Which side of spot the leg was written on.
 *
 * By put-call parity the same 62 bytes are both: `V(S) = L*(S - C_BS) = L*(K - P_BS)`. What decides
 * which one a maker is holding is only whether the reserves start risky-heavy (`K` above spot: a
 * covered call) or stable-heavy (`K` below spot: a cash-secured put).
 */
export type LegKind = 'call' | 'put';

export function legKindFor(strikeWad: bigint, spotWad: bigint): LegKind {
  return strikeWad >= spotWad ? 'call' : 'put';
}

/**
 * Post-expiry flags for a leg of this kind.
 *
 * At `tau == 0` the curve degenerates to `Y = K*(L - X)`, a constant-sum order at exactly `K`. That
 * window is gated one-way, otherwise an expired leg would be a free at-the-money straddle written
 * to the world: a call is assigned by a taker *buying* the risky, a put by a taker *selling* it.
 */
export function expiryFlagsFor(kind: LegKind): number {
  return FLAG_POST_EXPIRY_ONE_WAY | (kind === 'call' ? FLAG_POST_EXPIRY_OUT_IS_RISKY : 0);
}

/** Seconds of time value left, floored at one hour and zero once matured, as `tauOf` sees it. */
export function remainingSeconds(maturity: number, nowSeconds: number): number {
  if (nowSeconds >= maturity) return 0;
  return Math.max(maturity - nowSeconds, TAU_FLOOR_SECONDS);
}

/** `tau` in years, WAD — the same arithmetic as `RmmSwap.tauOf`, integer for integer. */
export function tauWad(maturity: number, nowSeconds: number): bigint {
  const remaining = remainingSeconds(maturity, nowSeconds);
  if (remaining === 0) return BigInt(0);
  return (BigInt(remaining) * WAD) / BigInt(YEAR_SECONDS);
}

// ---------------------------------------------------------------------------
// Normalised <-> raw
// ---------------------------------------------------------------------------

/**
 * The raw token amount to ship for a normalised reserve, and the normalised reserve that amount
 * actually represents.
 *
 * The two differ whenever the token has fewer than 18 decimals: USDC's rate is `1e12`, so a
 * normalised reserve is only representable to the nearest `1e12`. Rounding *down* leaves the
 * reserves a hair inside the curve, which widens the theta band by less than one millionth of a
 * cent and favours the maker; rounding up would hand that hair to the first taker.
 *
 * The caller must re-derive the curve from `normalised`, never from the number it asked for.
 */
export function toRawReserve(normalisedWad: bigint, rate: bigint): { raw: bigint; normalised: bigint } {
  const raw = normalisedWad / rate;
  return { raw, normalised: raw * rate };
}
