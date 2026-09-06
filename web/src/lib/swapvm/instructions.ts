/**
 * Instruction builders. Each function returns the exact bytes produced by the
 * corresponding Solidity library `build(...)` in @1inch/swap-vm `src/instructions/*.sol`:
 * `[opcode:u8][argsLength:u8][args...]`.
 *
 * Validation `require`s from the Solidity builders are mirrored so bad programs fail
 * client-side instead of on-chain.
 */
import type { Address, Hex } from 'viem';
import { Opcode } from './opcodes';
import {
  SwapVMEncodingError,
  address20,
  addressLt,
  addressTail,
  bytesDyn,
  concat,
  encodeBool,
  instruction,
  toBigInt,
  uintN,
  type Uint,
} from './bytes';

/** 1e18 fixed-point unit (shares, decay factors, price bumps). */
export const ONE = BigInt(10) ** BigInt(18);
/** Fee denominator used by FeeFlatIn/Out and FeeProtocol: 1e7 == 100%. */
export const BPS = BigInt(10) ** BigInt(7);
/** `PeggedSwapMath.MAX_LINEAR_WIDTH` = 5000e27. */
export const MAX_LINEAR_WIDTH = BigInt(5000) * BigInt(10) ** BigInt(27);

/** Either an explicit direction flag or a token pair (`tokenIn < tokenOut`). */
export type Direction = boolean | { tokenIn: Address; tokenOut: Address };

function resolveDirection(direction: Direction): boolean {
  return typeof direction === 'boolean' ? direction : addressLt(direction.tokenIn, direction.tokenOut);
}

function boolByte(value: boolean, bit = 0): Hex {
  return uintN(encodeBool(value, bit), 1);
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

/** `Stop.build()` — Encoding: [] */
export function stop(): Hex {
  return instruction(Opcode.Stop);
}

/** `Revert.build(bytes4 | bytes)` — Encoding: [bytes exception] */
export function revert(exception: Hex): Hex {
  return instruction(Opcode.Revert, bytesDyn(exception, 'exception'));
}

/** `Salt.build(uint64 | bytes)` — Encoding: [uint64 salt] or [bytes salt] */
export function salt(value: Uint | Hex): Hex {
  const args = typeof value === 'string' ? bytesDyn(value, 'salt') : uintN(value, 8, 'salt');
  return instruction(Opcode.Salt, args);
}

/** `Deadline.build(uint40)` — Encoding: [uint40 deadline] */
export function deadline(timestamp: Uint): Hex {
  return instruction(Opcode.Deadline, uintN(timestamp, 5, 'deadline'));
}

// ---------------------------------------------------------------------------
// Jumps (nextPC is a byte offset into the program, instruction-aligned)
// ---------------------------------------------------------------------------

/** `Jump.build(uint16)` — Encoding: [uint16 nextPC] */
export function jump(nextPC: Uint): Hex {
  return instruction(Opcode.Jump, uintN(nextPC, 2, 'nextPC'));
}

/** `JumpIfDirection.build(bool | (tokenIn, tokenOut), uint16)` — Encoding: [bool direction, uint16 nextPC] */
export function jumpIfDirection(direction: Direction, nextPC: Uint): Hex {
  return instruction(Opcode.JumpIfDirection, concat(boolByte(resolveDirection(direction)), uintN(nextPC, 2, 'nextPC')));
}

/** `JumpIfTokenIn.build(address, uint16)` — Encoding: [address token, uint16 nextPC] */
export function jumpIfTokenIn(token: Address, nextPC: Uint): Hex {
  return instruction(Opcode.JumpIfTokenIn, concat(address20(token, 'token'), uintN(nextPC, 2, 'nextPC')));
}

/** `JumpIfTokenOut.build(address, uint16)` — Encoding: [address token, uint16 nextPC] */
export function jumpIfTokenOut(token: Address, nextPC: Uint): Hex {
  return instruction(Opcode.JumpIfTokenOut, concat(address20(token, 'token'), uintN(nextPC, 2, 'nextPC')));
}

// ---------------------------------------------------------------------------
// Token validators / access guards
// ---------------------------------------------------------------------------

/** Encoding: [address token] */
export function onlyTakerTokenBalanceNonZero(token: Address): Hex {
  return instruction(Opcode.OnlyTakerTokenBalanceNonZero, address20(token, 'token'));
}

/** Encoding: [address token, uint256 amount] */
export function onlyTakerTokenBalanceGte(token: Address, amount: Uint): Hex {
  return instruction(Opcode.OnlyTakerTokenBalanceGte, concat(address20(token, 'token'), uintN(amount, 32, 'amount')));
}

/** Encoding: [address token, uint64 share]; `share <= 1e18` */
export function onlyTakerTokenSupplyShareGte(token: Address, share: Uint): Hex {
  const s = toBigInt(share, 'share');
  if (s > ONE) throw new SwapVMEncodingError(`TakerTokenBalanceSupplyShareWrongShare(${s})`);
  return instruction(Opcode.OnlyTakerTokenSupplyShareGte, concat(address20(token, 'token'), uintN(s, 8, 'share')));
}

/** Encoding: [address token] */
export function onlyTxOriginTokenBalanceNonZero(token: Address): Hex {
  return instruction(Opcode.OnlyTxOriginTokenBalanceNonZero, address20(token, 'token'));
}

/** `PrivateOrder.build(address)` — Encoding: [uint80 allowedTaker] (low 10 bytes of the address) */
export function privateOrder(allowedTaker: Address): Hex {
  return instruction(Opcode.PrivateOrder, addressTail(allowedTaker, 10, 'allowedTaker'));
}

/** `WhitelistCoequal.build(uint16, address[])` — Encoding: [uint16 nextPC, uint80 allowedTakers[N]] */
export function whitelistCoequal(nextPC: Uint, allowedTakers: readonly Address[]): Hex {
  if (allowedTakers.length === 0) throw new SwapVMEncodingError('WhitelistCoequalEmptyList()');
  return instruction(
    Opcode.WhitelistCoequal,
    concat(uintN(nextPC, 2, 'nextPC'), ...allowedTakers.map((t) => addressTail(t, 10, 'allowedTaker'))),
  );
}

/**
 * `WhitelistSequential.build(uint40, uint16, address[], uint16[])`
 * Encoding: [uint40 start, uint16 nextPC, (uint16 duration, uint80 allowedTaker)[N]]
 */
export function whitelistSequential(
  start: Uint,
  nextPC: Uint,
  allowedTakers: readonly Address[],
  durations: readonly Uint[],
): Hex {
  if (allowedTakers.length === 0) throw new SwapVMEncodingError('WhitelistSequentialEmptyList()');
  if (allowedTakers.length !== durations.length) throw new SwapVMEncodingError('WhitelistSequentialLengthMismatch()');
  const items = allowedTakers.map((t, i) => concat(uintN(durations[i], 2, `durations[${i}]`), addressTail(t, 10, 'allowedTaker')));
  return instruction(Opcode.WhitelistSequential, concat(uintN(start, 5, 'start'), uintN(nextPC, 2, 'nextPC'), ...items));
}

// ---------------------------------------------------------------------------
// Swap curves
// ---------------------------------------------------------------------------

/** `XYCSwap.build()` — constant product, Encoding: [] */
export function xycSwap(): Hex {
  return instruction(Opcode.XYCSwap);
}

/**
 * `XYCConcentrateSwap.build(uint256, uint256)` — Encoding: [uint256 sqrtPriceMin, uint256 sqrtPriceMax]
 * sqrt prices are 1e18 fixed-point; requires `0 < sqrtPriceMin < sqrtPriceMax`.
 */
export function xycConcentrateSwap(sqrtPriceMin: Uint, sqrtPriceMax: Uint): Hex {
  const min = toBigInt(sqrtPriceMin, 'sqrtPriceMin');
  const max = toBigInt(sqrtPriceMax, 'sqrtPriceMax');
  if (!(BigInt(0) < min && min < max)) throw new SwapVMEncodingError(`ConcentrateInvalidPriceBounds(${min}, ${max})`);
  return instruction(Opcode.XYCConcentrateSwap, concat(uintN(min, 32, 'sqrtPriceMin'), uintN(max, 32, 'sqrtPriceMax')));
}

/** `LimitSwap.build(bool | (tokenIn, tokenOut))` — Encoding: [bool direction] */
export function limitSwap(direction: Direction): Hex {
  return instruction(Opcode.LimitSwap, boolByte(resolveDirection(direction)));
}

/** `LimitSwapFullAmount.build(bool | (tokenIn, tokenOut))` — Encoding: [bool direction] */
export function limitSwapFullAmount(direction: Direction): Hex {
  return instruction(Opcode.LimitSwapFullAmount, boolByte(resolveDirection(direction)));
}

export interface PeggedSwapArgs {
  /** Initial X reserve normalization factor (= initial balance X * rate). */
  x0: Uint;
  /** Initial Y reserve normalization factor. */
  y0: Uint;
  /** Linear component coefficient scaled by 1e27; `<= 5000e27`. */
  linearWidth: Uint;
  /** Rate multiplier for the token with the LOWER address. */
  rateA: Uint;
  /** Rate multiplier for the token with the GREATER address. */
  rateB: Uint;
}

/** `PeggedSwap.build(...)` — Encoding: [uint256 x0, uint256 y0, uint256 linearWidth, uint256 rateA, uint256 rateB] */
export function peggedSwap(args: PeggedSwapArgs): Hex {
  const x0 = toBigInt(args.x0, 'x0');
  const y0 = toBigInt(args.y0, 'y0');
  const linearWidth = toBigInt(args.linearWidth, 'linearWidth');
  const rateA = toBigInt(args.rateA, 'rateA');
  const rateB = toBigInt(args.rateB, 'rateB');
  if (!(x0 > BigInt(0) && y0 > BigInt(0))) throw new SwapVMEncodingError(`PeggedSwapInvalidInitialBalances(${x0}, ${y0})`);
  if (linearWidth > MAX_LINEAR_WIDTH) throw new SwapVMEncodingError(`PeggedSwapInvalidLinearWidth(${linearWidth})`);
  if (!(rateA > BigInt(0) && rateB > BigInt(0))) throw new SwapVMEncodingError(`PeggedSwapInvalidRates(${rateA}, ${rateB})`);
  return instruction(
    Opcode.PeggedSwap,
    concat(uintN(x0, 32), uintN(y0, 32), uintN(linearWidth, 32), uintN(rateA, 32), uintN(rateB, 32)),
  );
}

export interface TwapSwapArgs {
  balanceIn: Uint;
  balanceOut: Uint;
  startTime: Uint;
  duration: Uint;
  /** 1e18 fixed-point, `>= 1e18`. */
  priceBumpAfterIlliquidity: Uint;
  minTradeAmountOut: Uint;
}

/**
 * `TWAPSwap.build(...)`
 * Encoding: [uint256 balanceIn, uint256 balanceOut, uint256 startTime, uint256 duration,
 *            uint256 priceBumpAfterIlliquidity, uint256 minTradeAmountOut]
 */
export function twapSwap(args: TwapSwapArgs): Hex {
  const balanceIn = toBigInt(args.balanceIn, 'balanceIn');
  const balanceOut = toBigInt(args.balanceOut, 'balanceOut');
  const duration = toBigInt(args.duration, 'duration');
  const bump = toBigInt(args.priceBumpAfterIlliquidity, 'priceBumpAfterIlliquidity');
  if (!(balanceIn > BigInt(0) && balanceOut > BigInt(0))) throw new SwapVMEncodingError(`TWAPSwapInvalidBalances(${balanceIn}, ${balanceOut})`);
  if (duration <= BigInt(0)) throw new SwapVMEncodingError(`TWAPSwapInvalidDuration(${duration})`);
  if (bump < ONE) throw new SwapVMEncodingError(`TWAPSwapInvalidPriceBump(${bump})`);
  return instruction(
    Opcode.TWAPSwap,
    concat(
      uintN(balanceIn, 32),
      uintN(balanceOut, 32),
      uintN(args.startTime, 32, 'startTime'),
      uintN(duration, 32),
      uintN(bump, 32),
      uintN(args.minTradeAmountOut, 32, 'minTradeAmountOut'),
    ),
  );
}

// ---------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------

/** `FeeFlatIn.build(uint24)` — Encoding: [uint24 feeBps]; 1e7 == 100% */
export function feeFlatIn(feeBps: Uint): Hex {
  const fee = toBigInt(feeBps, 'feeBps');
  if (fee >= BPS) throw new SwapVMEncodingError(`FeeBpsOutOfRange(${fee})`);
  return instruction(Opcode.FeeFlatIn, uintN(fee, 3, 'feeBps'));
}

/** `FeeFlatOut.build(uint24)` — Encoding: [uint24 feeBps]; 1e7 == 100% */
export function feeFlatOut(feeBps: Uint): Hex {
  const fee = toBigInt(feeBps, 'feeBps');
  if (fee >= BPS) throw new SwapVMEncodingError(`FeeBpsOutOfRange(${fee})`);
  return instruction(Opcode.FeeFlatOut, uintN(fee, 3, 'feeBps'));
}

export interface FeeProtocolReceiver {
  receiver: Address;
  /** Flat fee in 1e7-BPS; 0 = no flat fee. */
  feeBps?: Uint;
  /** Surplus fee in 1e7-BPS; 0 = no surplus fee. */
  surplusBps?: Uint;
}

export interface FeeProtocolProvider {
  /** `IProtocolFeeProvider` contract resolving recipient and fees at swap time. */
  provider: Address;
  takeFlatFee?: boolean;
  takeSurplusFee?: boolean;
}

export interface FeeProtocolArgs {
  /** Charge fees in tokenIn (true) or tokenOut (false). */
  isTokenIn: boolean;
  receivers?: readonly FeeProtocolReceiver[];
  providers?: readonly FeeProtocolProvider[];
  /** uint216 estimate used for surplus fees; encoded only when any surplus fee is enabled. */
  surplusEstimate?: Uint;
}

/**
 * `FeeProtocol.build(bool, ReceiverConfig[], ProviderConfig[], uint216)`
 * Encoding: [uint8 header, [uint8 flags, address target, uint24 feeBps?, uint24 surplusBps?] * count, uint216 surplusEstimate?]
 *   header: [bit isTokenIn, bit3 _, uint4 count]
 *   flags:  [bit isProvider, bit takeFlatFee, bit takeSurplusFee, bit5 _]
 */
export function feeProtocol(args: FeeProtocolArgs): Hex {
  const receivers = args.receivers ?? [];
  const providers = args.providers ?? [];
  const count = receivers.length + providers.length;
  if (count >= 16) throw new SwapVMEncodingError('FeeProtocolExceedMaxCount()');

  const chunks: Hex[] = [uintN(encodeBool(args.isTokenIn, 0) | count, 1)];
  let encodeSurplusEstimate = false;

  for (const r of receivers) {
    const feeBps = toBigInt(r.feeBps ?? BigInt(0), 'feeBps');
    const surplusBps = toBigInt(r.surplusBps ?? BigInt(0), 'surplusBps');
    const takeFlatFee = feeBps > BigInt(0);
    const takeSurplusFee = surplusBps > BigInt(0);
    if (!(takeFlatFee || takeSurplusFee)) throw new SwapVMEncodingError('FeeProtocolNoFeeFlagsSet()');
    const receiver = address20(r.receiver, 'receiver');
    if (receiver === '0x0000000000000000000000000000000000000000') throw new SwapVMEncodingError('FeeProtocolBadTarget()');
    chunks.push(uintN(encodeBool(false, 0) | encodeBool(takeFlatFee, 1) | encodeBool(takeSurplusFee, 2), 1), receiver);
    if (takeFlatFee) chunks.push(uintN(feeBps, 3, 'feeBps'));
    if (takeSurplusFee) chunks.push(uintN(surplusBps, 3, 'surplusBps'));
    encodeSurplusEstimate ||= takeSurplusFee;
  }

  for (const p of providers) {
    const takeFlatFee = p.takeFlatFee ?? false;
    const takeSurplusFee = p.takeSurplusFee ?? false;
    if (!(takeFlatFee || takeSurplusFee)) throw new SwapVMEncodingError('FeeProtocolNoFeeFlagsSet()');
    const provider = address20(p.provider, 'provider');
    if (provider === '0x0000000000000000000000000000000000000000') throw new SwapVMEncodingError('FeeProtocolBadTarget()');
    chunks.push(uintN(encodeBool(true, 0) | encodeBool(takeFlatFee, 1) | encodeBool(takeSurplusFee, 2), 1), provider);
    encodeSurplusEstimate ||= takeSurplusFee;
  }

  if (encodeSurplusEstimate) chunks.push(uintN(args.surplusEstimate ?? BigInt(0), 27, 'surplusEstimate'));
  return instruction(Opcode.FeeProtocol, concat(...chunks));
}

// ---------------------------------------------------------------------------
// Balances tuning
// ---------------------------------------------------------------------------

/** `StaticBalances.build(uint256, uint256)` — Encoding: [uint256 balanceA, uint256 balanceB] */
export function staticBalances(balanceA: Uint, balanceB: Uint): Hex {
  return instruction(Opcode.StaticBalances, concat(uintN(balanceA, 32, 'balanceA'), uintN(balanceB, 32, 'balanceB')));
}

/** `DynamicBalances.build(uint256, uint256)` — Encoding: [uint256 balanceA, uint256 balanceB] */
export function dynamicBalances(balanceA: Uint, balanceB: Uint): Hex {
  return instruction(Opcode.DynamicBalances, concat(uintN(balanceA, 32, 'balanceA'), uintN(balanceB, 32, 'balanceB')));
}

/** `Decay.build(uint16)` — Encoding: [uint16 period] (seconds) */
export function decay(period: Uint): Hex {
  return instruction(Opcode.Decay, uintN(period, 2, 'period'));
}

function dutchAuctionArgs(start: Uint, duration: Uint, decayFactor: Uint): Hex {
  const d = toBigInt(decayFactor, 'decay');
  if (d >= ONE) throw new SwapVMEncodingError(`DutchAuctionWrongDecayFactor(${d})`);
  return concat(uintN(start, 5, 'start'), uintN(duration, 2, 'duration'), uintN(d, 8, 'decay'));
}

/** `DutchAuctionBalanceIn.build(uint40, uint16, uint64)` — Encoding: [uint40 start, uint16 duration, uint64 decay]; decay < 1e18 */
export function dutchAuctionBalanceIn(start: Uint, duration: Uint, decayFactor: Uint): Hex {
  return instruction(Opcode.DutchAuctionBalanceIn, dutchAuctionArgs(start, duration, decayFactor));
}

/** `DutchAuctionBalanceOut.build(uint40, uint16, uint64)` — Encoding: [uint40 start, uint16 duration, uint64 decay]; decay < 1e18 */
export function dutchAuctionBalanceOut(start: Uint, duration: Uint, decayFactor: Uint): Hex {
  return instruction(Opcode.DutchAuctionBalanceOut, dutchAuctionArgs(start, duration, decayFactor));
}

function piecewiseArgs(timestamp: Uint, durations: readonly Uint[], scales: readonly Uint[]): Hex {
  if (scales.length < 2) throw new SwapVMEncodingError('PiecewiseLinearScaleNotEnoughPointsToBuildPiece()');
  if (durations.length + 1 !== scales.length) throw new SwapVMEncodingError('PiecewiseLinearScaleMismatchInputLengths()');
  const chunks: Hex[] = [uintN(timestamp, 5, 'timestamp'), uintN(scales[0], 3, 'scales[0]')];
  for (let i = 0; i < durations.length; i++) {
    chunks.push(uintN(durations[i], 2, `durations[${i}]`), uintN(scales[i + 1], 3, `scales[${i + 1}]`));
  }
  return concat(...chunks);
}

/**
 * `PiecewiseLinearScaleBalanceIn.build(uint40, uint16[], uint24[])`
 * Encoding: [uint40 timestamp, uint24 scales[0], (uint16 durations[i], uint24 scales[i+1])...]; durations.length == scales.length - 1
 */
export function piecewiseLinearScaleBalanceIn(timestamp: Uint, durations: readonly Uint[], scales: readonly Uint[]): Hex {
  return instruction(Opcode.PiecewiseLinearScaleBalanceIn, piecewiseArgs(timestamp, durations, scales));
}

/** `PiecewiseLinearScaleBalanceOut.build(uint40, uint16[], uint24[])` — same encoding as the BalanceIn variant. */
export function piecewiseLinearScaleBalanceOut(timestamp: Uint, durations: readonly Uint[], scales: readonly Uint[]): Hex {
  return instruction(Opcode.PiecewiseLinearScaleBalanceOut, piecewiseArgs(timestamp, durations, scales));
}

// ---------------------------------------------------------------------------
// Invalidators & epochs
// ---------------------------------------------------------------------------

/** `InvalidateBit.build(uint32)` — Encoding: [uint32 bitIndex] */
export function invalidateBit(bitIndex: Uint): Hex {
  return instruction(Opcode.InvalidateBit, uintN(bitIndex, 4, 'bitIndex'));
}

/** `InvalidateTokenIn.build()` — Encoding: [] */
export function invalidateTokenIn(): Hex {
  return instruction(Opcode.InvalidateTokenIn);
}

/** `InvalidateTokenOut.build()` — Encoding: [] */
export function invalidateTokenOut(): Hex {
  return instruction(Opcode.InvalidateTokenOut);
}

/** `ValidateSeriesEpoch.build(uint32, uint32)` — Encoding: [uint32 seriesId, uint32 epoch] */
export function validateSeriesEpoch(seriesId: Uint, epoch: Uint): Hex {
  return instruction(Opcode.ValidateSeriesEpoch, concat(uintN(seriesId, 4, 'seriesId'), uintN(epoch, 4, 'epoch')));
}

// ---------------------------------------------------------------------------
// Rates tuning
// ---------------------------------------------------------------------------

/** `RequireMinRate.build(uint64, uint64)` — Encoding: [uint64 rateA, uint64 rateB] */
export function requireMinRate(rateA: Uint, rateB: Uint): Hex {
  return instruction(Opcode.RequireMinRate, concat(uintN(rateA, 8, 'rateA'), uintN(rateB, 8, 'rateB')));
}

/** `AdjustMinRate.build(uint64, uint64)` — Encoding: [uint64 rateA, uint64 rateB] */
export function adjustMinRate(rateA: Uint, rateB: Uint): Hex {
  return instruction(Opcode.AdjustMinRate, concat(uintN(rateA, 8, 'rateA'), uintN(rateB, 8, 'rateB')));
}

export interface OraclePriceAdjusterArgs {
  /** 1e18 fixed-point cap on price movement; `< 1e18`. */
  maxPriceDecay: Uint;
  /** Seconds. */
  maxStaleness: Uint;
  oracleDecimals: Uint;
  /** Chainlink-compatible aggregator. */
  oracleAddress: Address;
}

/** `OraclePriceAdjuster.build(...)` — Encoding: [uint64 maxPriceDecay, uint16 maxStaleness, uint8 oracleDecimals, address oracleAddress] */
export function oraclePriceAdjuster(args: OraclePriceAdjusterArgs): Hex {
  const maxPriceDecay = toBigInt(args.maxPriceDecay, 'maxPriceDecay');
  if (maxPriceDecay >= ONE) throw new SwapVMEncodingError(`OraclePriceAdjusterWrongMaxPriceDecay(${maxPriceDecay})`);
  return instruction(
    Opcode.OraclePriceAdjuster,
    concat(
      uintN(maxPriceDecay, 8),
      uintN(args.maxStaleness, 2, 'maxStaleness'),
      uintN(args.oracleDecimals, 1, 'oracleDecimals'),
      address20(args.oracleAddress, 'oracleAddress'),
    ),
  );
}

export interface BaseFeeAdjusterArgs {
  baseGasPrice: Uint;
  ethPrice: Uint;
  gasAmount: Uint;
  /** 1e18 fixed-point; `< 1e18`. */
  maxDecay: Uint;
}

/** `BaseFeeAdjuster.build(...)` — Encoding: [uint64 baseGasPrice, uint96 ethPrice, uint24 gasAmount, uint64 maxDecay] */
export function baseFeeAdjuster(args: BaseFeeAdjusterArgs): Hex {
  const maxDecay = toBigInt(args.maxDecay, 'maxDecay');
  if (maxDecay >= ONE) throw new SwapVMEncodingError(`BaseFeeAdjusterInvalidMaxDecay(${maxDecay})`);
  return instruction(
    Opcode.BaseFeeAdjuster,
    concat(
      uintN(args.baseGasPrice, 8, 'baseGasPrice'),
      uintN(args.ethPrice, 12, 'ethPrice'),
      uintN(args.gasAmount, 3, 'gasAmount'),
      uintN(maxDecay, 8),
    ),
  );
}

// ---------------------------------------------------------------------------
// Extensions & debug
// ---------------------------------------------------------------------------

/** `Extruction.build(address, bytes)` — Encoding: [address target, bytes extructionArgs] */
export function extruction(target: Address, extructionArgs: Hex = '0x'): Hex {
  return instruction(Opcode.Extruction, concat(address20(target, 'target'), bytesDyn(extructionArgs, 'extructionArgs')));
}

export interface SwapRegisters {
  balanceIn: Uint;
  balanceOut: Uint;
  amountIn: Uint;
  amountOut: Uint;
}

/** `PatchSwapRegisters.build(SwapRegisters)` — Encoding: [uint256 balanceIn, uint256 balanceOut, uint256 amountIn, uint256 amountOut] */
export function patchSwapRegisters(swap: SwapRegisters): Hex {
  return instruction(
    Opcode.PatchSwapRegisters,
    concat(
      uintN(swap.balanceIn, 32, 'balanceIn'),
      uintN(swap.balanceOut, 32, 'balanceOut'),
      uintN(swap.amountIn, 32, 'amountIn'),
      uintN(swap.amountOut, 32, 'amountOut'),
    ),
  );
}

export const printSwapRegisters = (): Hex => instruction(Opcode.PrintSwapRegisters);
export const printSwapQuery = (): Hex => instruction(Opcode.PrintSwapQuery);
export const printVM = (): Hex => instruction(Opcode.PrintVM);
export const printFreeMemoryPointer = (): Hex => instruction(Opcode.PrintFreeMemoryPointer);
export const printGasLeft = (): Hex => instruction(Opcode.PrintGasLeft);
export const printFee = (): Hex => instruction(Opcode.PrintFee);

// ---------------------------------------------------------------------------
// Project-custom opcodes
// ---------------------------------------------------------------------------

/** `ProbeScale.build(uint32)` (our ProbeRouter, Opcode._d0) — Encoding: [uint32 factor]; 1e9 == 1x */
export function probeScale(factor: Uint): Hex {
  return instruction(Opcode.ProbeScale, uintN(factor, 4, 'factor'));
}

/** Generic `[opcode][len][args]` for any custom opcode. */
export function customInstruction(opcode: number, args: Hex = '0x'): Hex {
  return instruction(opcode, args);
}

/** A program is the plain concatenation of its instructions. */
export function program(...instructions: readonly Hex[]): Hex {
  return concat(...instructions);
}
