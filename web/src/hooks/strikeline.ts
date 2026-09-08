/**
 * Strikeline's own on-chain surface, read from TypeScript.
 *
 * Two things live here, both framework-free so they can be unit-tested without React:
 *
 *  1. **The program decoder.** A leg is a SwapVM program shipped to Aqua, and the only record of
 *     its economics is the 62 argument bytes of the `RmmSwap` instruction inside it. Strike,
 *     implied vol, maturity and liquidity are not stored anywhere else — no registry, no subgraph,
 *     no JSON beside the app. So the book reads them back out of the bytes Aqua emitted in
 *     `Shipped`, exactly as the router will parse them at fill time (`RmmSwap.parse`).
 *
 *  2. **The view + error ABIs.** `StrikelineViews` is what lets the UI ask the chain where the
 *     curve is instead of reimplementing `Phi` in floating point, and the custom errors are how a
 *     refused quote reports the two numbers it compared. `NotCovered(needed, free)` is not a
 *     failure to be swallowed: `free` is the answer to "how much can this leg actually deliver",
 *     straight from the guard that enforces it.
 *
 * It sits in `src/hooks/` rather than `src/lib/` only because of this build's file ownership; it
 * has no React dependency and nothing here renders.
 */
import { hexToBigInt, hexToNumber, size, slice, type Address, type Hex } from 'viem';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** ES2017 target: bigint literals are a syntax error, so they are constructed. */
const ZERO = BigInt(0);
const ONE = BigInt(1);

export const WAD = BigInt(10) ** BigInt(18);
export const SECONDS_PER_DAY = 86_400;

/** `RmmSwap.opcode` — `Opcode._55`. */
export const RMM_SWAP_OPCODE = 0x55;
/** `Coverage.opcode` — `Opcode._93`. */
export const COVERAGE_OPCODE = 0x93;

/** `RmmSwap.TAU_FLOOR`: tau never falls below an hour, which bounds gamma in the last hour. */
export const TAU_FLOOR_SECONDS = 3600;

/** `Coverage.BPS` — haircuts are a fraction of 1e4. */
export const COVERAGE_BPS = 10_000;

const FLAG_RISKY_IS_TOKEN_A = 1 << 0;
const FLAG_POST_EXPIRY_ONE_WAY = 1 << 1;
const FLAG_POST_EXPIRY_OUT_IS_RISKY = 1 << 2;

// ---------------------------------------------------------------------------
// ABIs
// ---------------------------------------------------------------------------

/**
 * `StrikelineViews`, the read-only mixin on our router.
 *
 * `bandFor` is the one the book leans on hardest: with reserves pinned to the curve, decay moves
 * the curve away from them in both directions, and this publishes that gap. It is the accrued
 * theta, in normalised WAD units, and it is what the next taker has to clear before they can trade.
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

/**
 * The custom errors both instructions revert with. They are attached to the quote ABI so viem
 * decodes them instead of handing back an undecoded `0x…` blob — the arguments are the answer.
 */
export const strikelineErrorsAbi = [
  {
    type: 'error',
    name: 'NotCovered',
    inputs: [
      { name: 'needed', type: 'uint256' },
      { name: 'free', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'CoverageHaircutTooLarge', inputs: [{ name: 'haircutBps', type: 'uint256' }] },
  { type: 'error', name: 'RmmInsideSpread', inputs: [{ name: 'shortfall', type: 'uint256' }] },
  {
    type: 'error',
    name: 'RmmExceedsReserve',
    inputs: [
      { name: 'requested', type: 'uint256' },
      { name: 'available', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'RmmSettlementOneWay', inputs: [] },
  { type: 'error', name: 'RmmOutOfDomain', inputs: [] },
] as const;

// ---------------------------------------------------------------------------
// Program decoding
// ---------------------------------------------------------------------------

/** One `[opcode:u8][argsLength:u8][args…]` instruction, with its byte offset in the program. */
export interface VmInstruction {
  opcode: number;
  args: Hex;
  offset: number;
}

export interface Disassembly {
  instructions: VmInstruction[];
  /** True when the byte stream ran out mid-instruction; whatever parsed cleanly is still returned. */
  malformed: boolean;
}

/**
 * Walk a program's instruction stream. The encoding is the whole grammar: an opcode byte, a length
 * byte, then that many argument bytes.
 *
 * @example disassemble('0x9303000000550201') // Coverage(3 args) then a truncated RmmSwap
 */
export function disassemble(program: Hex): Disassembly {
  const instructions: VmInstruction[] = [];
  const total = size(program);
  let offset = 0;

  while (offset < total) {
    if (offset + 2 > total) return { instructions, malformed: true };
    const opcode = hexToNumber(slice(program, offset, offset + 1));
    const argsLength = hexToNumber(slice(program, offset + 1, offset + 2));
    const end = offset + 2 + argsLength;
    if (end > total) return { instructions, malformed: true };
    instructions.push({
      opcode,
      args: argsLength === 0 ? '0x' : slice(program, offset + 2, end),
      offset,
    });
    offset = end;
  }

  return { instructions, malformed: false };
}

/** `RmmSwap.Args` — the leg's entire economic description, in 62 bytes. */
export interface RmmArgs {
  flags: number;
  /** Implied vol, 1e18-scaled: 0.6e18 is 60%. */
  sigmaWad: bigint;
  /** Expiry, unix seconds (uint40). */
  maturity: number;
  /** Strike in normalised stable per normalised risky, 1e18-scaled. */
  strikeWad: bigint;
  /** Liquidity `L`, in normalised risky units. */
  liquidityWad: bigint;
  /** Multiplier taking the risky token's own units to WAD (1e12 for a 6-decimal token). */
  rateRisky: bigint;
  rateStable: bigint;
  /** The risky token is `tokenA`, i.e. the lower of the two addresses. */
  riskyIsTokenA: boolean;
  /** After maturity the leg trades in one direction only. */
  postExpiryOneWay: boolean;
  /** That direction pays out the risky token — the maker is assigned on a call. */
  postExpiryOutIsRisky: boolean;
}

/**
 * `RmmSwap.parse`, byte for byte:
 * `[uint8 flags][uint64 sigmaWad][uint40 maturity][uint128 strikeWad][uint128 liquidityWad][uint64 rateRisky][uint64 rateStable]`
 */
export function parseRmmArgs(args: Hex): RmmArgs | undefined {
  if (size(args) !== 62) return undefined;
  const flags = hexToNumber(slice(args, 0, 1));
  return {
    flags,
    sigmaWad: hexToBigInt(slice(args, 1, 9)),
    maturity: hexToNumber(slice(args, 9, 14)),
    strikeWad: hexToBigInt(slice(args, 14, 30)),
    liquidityWad: hexToBigInt(slice(args, 30, 46)),
    rateRisky: hexToBigInt(slice(args, 46, 54)),
    rateStable: hexToBigInt(slice(args, 54, 62)),
    riskyIsTokenA: (flags & FLAG_RISKY_IS_TOKEN_A) !== 0,
    postExpiryOneWay: (flags & FLAG_POST_EXPIRY_ONE_WAY) !== 0,
    postExpiryOutIsRisky: (flags & FLAG_POST_EXPIRY_OUT_IS_RISKY) !== 0,
  };
}

/** `Coverage.parse` — `[uint8 flags][uint16 haircutBps]`. */
export function parseCoverageArgs(args: Hex): { flags: number; haircutBps: number } | undefined {
  if (size(args) !== 3) return undefined;
  return { flags: hexToNumber(slice(args, 0, 1)), haircutBps: hexToNumber(slice(args, 1, 3)) };
}

export interface DecodedLegProgram {
  instructions: VmInstruction[];
  malformed: boolean;
  rmm?: RmmArgs;
  /** True when a `Coverage` instruction wraps the curve, so quotes are solvency-checked. */
  guarded: boolean;
  haircutBps: number;
}

/**
 * Pull the leg out of a shipped program.
 *
 * A program with no `RmmSwap` is not a Strikeline leg — it is some other strategy shipped to the
 * same router, and the book says so rather than inventing a strike for it.
 */
export function decodeLegProgram(program: Hex): DecodedLegProgram {
  const { instructions, malformed } = disassemble(program);
  const rmmIx = instructions.find((i) => i.opcode === RMM_SWAP_OPCODE);
  const coverageIx = instructions.find((i) => i.opcode === COVERAGE_OPCODE);
  const coverage = coverageIx ? parseCoverageArgs(coverageIx.args) : undefined;
  return {
    instructions,
    malformed,
    rmm: rmmIx ? parseRmmArgs(rmmIx.args) : undefined,
    guarded: Boolean(coverage),
    haircutBps: coverage?.haircutBps ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Unit conversion
// ---------------------------------------------------------------------------

/** Token units to the normalised WAD units the curve trades in. */
export function toWad(amount: bigint, rate: bigint): bigint {
  return amount * rate;
}

/** Normalised WAD units back to the token's own units, rounded down (never overstates a balance). */
export function fromWad(wad: bigint, rate: bigint): bigint {
  return rate === ZERO ? ZERO : wad / rate;
}

/** The normalisation multiplier a token's decimals imply, for cross-checking a leg's shipped rate. */
export function rateForDecimals(decimals: number): bigint {
  return BigInt(10) ** BigInt(Math.max(0, 18 - decimals));
}

// ---------------------------------------------------------------------------
// Derived quantities (arithmetic on chain-read numbers only)
// ---------------------------------------------------------------------------

/**
 * `RmmSwap.tauOf` in seconds rather than years: what the curve has left, floored at an hour and
 * zero once matured. The clock is the chain's, never the browser's — a fork that has been warped
 * three days forward is three days closer to expiry no matter what the laptop thinks.
 */
export function tauSecondsAt(maturity: number, blockTimestamp: bigint): number {
  const now = Number(blockTimestamp);
  if (!Number.isFinite(now) || now >= maturity) return 0;
  return Math.max(maturity - now, TAU_FLOOR_SECONDS);
}

/** Seconds until expiry, negative once past it. Display-only; `tauSecondsAt` is what the curve sees. */
export function secondsToExpiry(maturity: number, blockTimestamp: bigint): number {
  return maturity - Number(blockTimestamp);
}

/**
 * `6d 22h`, `4h 09m`, `58s`, `expired`. Two units, largest first, because a countdown that shows
 * seconds next to days is unreadable at a glance and this one is read from across a room.
 */
export function formatCountdown(seconds: number): string {
  if (!Number.isFinite(seconds)) return '-';
  if (seconds <= 0) return 'expired';
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${String(h).padStart(2, '0')}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/**
 * Implied vol as a ratio: `0.6e18` -> `0.6`. A `number` is right here because sigma is a display
 * quantity, never an amount — no balance is ever derived from it on this side.
 */
export function sigmaRatio(sigmaWad: bigint): number {
  return Number(sigmaWad) / Number(WAD);
}

/**
 * Where spot sits against the strike, as a signed ratio: `+0.048` means spot is 4.8% above `K`.
 * Both inputs are WAD, both come from a chain read (the strike from the program, spot from the feed).
 */
export function moneyness(spotWad: bigint, strikeWad: bigint): number {
  if (strikeWad === ZERO) return Number.NaN;
  return Number(spotWad - strikeWad) / Number(strikeWad);
}

/** Smaller of two bigints — the shape of nearly every bound on this screen. */
export function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export function maxBig(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

/**
 * `a / b` as a float, for a bar width or a percentage. Returns 0 when the denominator is zero
 * rather than `Infinity`, so a fresh book cannot render a bar of undefined length.
 */
export function ratio(a: bigint, b: bigint): number {
  if (b === ZERO) return 0;
  return Number((a * BigInt(1_000_000)) / b) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Revert decoding
// ---------------------------------------------------------------------------

export interface DecodedRevert {
  name: string;
  /** Decoded arguments, kept as bigints: `NotCovered.free` is a balance the UI renders as one. */
  args: bigint[];
}

interface RevertLike {
  name?: unknown;
  cause?: unknown;
  data?: { errorName?: unknown; args?: unknown };
}

function isRecord(value: unknown): value is RevertLike {
  return typeof value === 'object' && value !== null;
}

/**
 * Find the decoded custom error inside whatever viem threw.
 *
 * viem nests the revert several `cause` levels down and the depth depends on which action wrapped
 * it, so this walks the chain and takes the deepest decoded link — that one is the contract's own
 * error rather than an action's restatement of it. Non-bigint arguments are dropped: every
 * argument these two instructions carry is a `uint256`.
 */
export function decodeRevert(error: unknown): DecodedRevert | undefined {
  let current: unknown = error;
  let found: DecodedRevert | undefined;
  for (let i = 0; i < 8 && isRecord(current); i += 1) {
    const name = current.data?.errorName;
    if (typeof name === 'string') {
      const raw = Array.isArray(current.data?.args) ? current.data.args : [];
      found = { name, args: raw.filter((a): a is bigint => typeof a === 'bigint') };
    }
    current = current.cause;
  }
  return found;
}

/**
 * The deliverable bound a refused quote reports.
 *
 * `NotCovered(needed, free)` — the wallet is short, and `free` is exactly what `Coverage` would let
 * through right now. `RmmExceedsReserve(requested, available)` — the curve itself has run out of
 * that reserve. Either way the second argument is the honest maximum, so a refusal answers the
 * question the row was asking instead of just failing.
 */
export function boundFromRevert(error: unknown): { bound: bigint; reason: 'wallet' | 'curve'; name: string } | undefined {
  const decoded = decodeRevert(error);
  if (!decoded || decoded.args.length < 2) return undefined;
  if (decoded.name === 'NotCovered') return { bound: decoded.args[1], reason: 'wallet', name: decoded.name };
  if (decoded.name === 'RmmExceedsReserve') return { bound: decoded.args[1], reason: 'curve', name: decoded.name };
  return undefined;
}

// ---------------------------------------------------------------------------
// Reserve trajectory
// ---------------------------------------------------------------------------

/**
 * One reserve movement recorded by Aqua: `Pushed` adds to a strategy's virtual balance (a ship, or
 * the token a taker paid in), `Pulled` removes from it (a dock, or the token the maker delivered).
 */
export interface ReserveDelta {
  strategyHash: Hex;
  token: Address;
  /** Signed: positive for `Pushed`, negative for `Pulled`. */
  amount: bigint;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hex;
}

/** Sort key: chain order, which is the only order these can be replayed in. */
export function compareChainOrder(a: { blockNumber: bigint; logIndex: number }, b: { blockNumber: bigint; logIndex: number }): number {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  return a.logIndex - b.logIndex;
}

export interface ReserveSnapshot {
  transactionHash: Hex;
  /** Balance of each token immediately before the first log of that transaction. */
  before: Map<string, bigint>;
}

/**
 * Replay a strategy's `Pushed`/`Pulled` stream and snapshot the reserves as they stood just before
 * each of the given transactions.
 *
 * This is how the book knows what the curve looked like when a fill hit it, without a single
 * archive call: the ship amount and every subsequent movement are already in the log stream, so the
 * trajectory is a fold over history rather than a state read that a later fill would have
 * overwritten.
 */
export function replayReserves(deltas: readonly ReserveDelta[], transactions: ReadonlySet<string>): Map<string, ReserveSnapshot> {
  const ordered = [...deltas].sort(compareChainOrder);
  const balances = new Map<string, bigint>();
  const snapshots = new Map<string, ReserveSnapshot>();

  for (const delta of ordered) {
    const txKey = delta.transactionHash.toLowerCase();
    if (transactions.has(txKey) && !snapshots.has(txKey)) {
      snapshots.set(txKey, { transactionHash: delta.transactionHash, before: new Map(balances) });
    }
    const key = delta.token.toLowerCase();
    balances.set(key, (balances.get(key) ?? ZERO) + delta.amount);
  }

  return snapshots;
}

/** Reserve of `token` in a snapshot, defaulting to zero for a token the strategy never held. */
export function reserveAt(snapshot: ReserveSnapshot | undefined, token: Address): bigint {
  return snapshot?.before.get(token.toLowerCase()) ?? ZERO;
}

/** Ceiling division, matching the maker-favouring rounding the curve itself uses. */
export function ceilDiv(a: bigint, b: bigint): bigint {
  return b === ZERO ? ZERO : (a + b - ONE) / b;
}
