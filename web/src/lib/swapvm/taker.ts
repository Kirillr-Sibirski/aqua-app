/**
 * Taker traits + data packing, mirroring `TakerTraitsLib.build` (@1inch/swap-vm `src/libs/TakerTraits.sol`).
 *
 * packed = slicesIndexes(10 × uint16 = 20 bytes, index9..index0) ‖ flags(uint16)
 *        ‖ threshold(0|32) ‖ to(0|20) ‖ deadline(0|5)
 *        ‖ preInHookData ‖ postInHookData ‖ preOutHookData ‖ postOutHookData
 *        ‖ preInCallbackData ‖ preOutCallbackData ‖ instructionsArgs ‖ signature
 */
import { hexToBigInt, size, slice, type Address, type Hex } from 'viem';
import { SwapVMEncodingError, assertAddress, bytesDyn, concat, toBigInt, uintN, type Uint } from './bytes';
import { ZERO_ADDRESS } from './order';

export const TAKER_IS_EXACT_IN = 0x0001;
export const TAKER_SHOULD_UNWRAP_WETH = 0x0002;
export const TAKER_HAS_PRE_TRANSFER_IN_CALLBACK = 0x0004;
export const TAKER_HAS_PRE_TRANSFER_OUT_CALLBACK = 0x0008;
export const TAKER_IS_STRICT_THRESHOLD = 0x0010;
export const TAKER_IS_FIRST_TRANSFER_FROM_TAKER = 0x0020;
export const TAKER_USE_TRANSFER_FROM_AND_AQUA_PUSH = 0x0040;
export const TAKER_IS_A_TO_B = 0x0080;
export const TAKER_ALLOW_PARTIAL_FILL = 0x0100;

/** Header = 10 slice indexes (uint16) + flags (uint16). */
export const TAKER_TRAITS_HEADER_SIZE = 22;

/** 1:1 with `TakerTraitsLib.Args`; optional fields default to false/zero/empty. */
export interface BuildTakerTraitsArgs {
  /** msg.sender of `swap`/`quote`; only used to elide `to` when `to == taker`. */
  taker: Address;
  /** True: `amount` is amountIn; false: `amount` is amountOut. */
  isExactIn: boolean;
  /** True: tokenA -> tokenB, false: tokenB -> tokenA. */
  isAToB: boolean;
  shouldUnwrapWeth?: boolean;
  /** Require the threshold to match exactly instead of min-out / max-in. */
  isStrictThresholdAmount?: boolean;
  /** Transfer taker -> maker before maker -> taker. */
  isFirstTransferFromTaker?: boolean;
  /** Aqua orders: router does `transferFrom(taker)` then `Aqua.push` (vs. taker pushing to Aqua up-front). */
  useTransferFromAndAquaPush?: boolean;
  allowPartialFill?: boolean;
  /** Min amountOut (exactIn) or max amountIn (exactOut); omit for no threshold. */
  threshold?: Uint | null;
  /** Recipient of tokenOut (zero / == taker => taker). */
  to?: Address;
  /** uint40 unix timestamp; 0 = no deadline. */
  deadline?: Uint;
  hasPreTransferInCallback?: boolean;
  hasPreTransferOutCallback?: boolean;
  preTransferInHookData?: Hex;
  postTransferInHookData?: Hex;
  preTransferOutHookData?: Hex;
  postTransferOutHookData?: Hex;
  preTransferInCallbackData?: Hex;
  preTransferOutCallbackData?: Hex;
  /** Dynamic args consumed by instructions (e.g. Extruction). */
  instructionsArgs?: Hex;
  /** Maker signature for non-Aqua orders. */
  signature?: Hex;
}

function toUint16(value: number, name: string): Hex {
  if (value > 0xffff) throw new SwapVMEncodingError(`SafeCastOverflowedUintDowncast(16, ${value}) for ${name}`);
  return uintN(value, 2, name);
}

/** `TakerTraitsLib.build(args)` — the `takerTraitsAndData` argument of `quote`/`swap`. */
export function buildTakerTraits(args: BuildTakerTraitsArgs): Hex {
  const taker = assertAddress(args.taker, 'taker');
  const to = assertAddress(args.to ?? ZERO_ADDRESS, 'to');
  const deadline = toBigInt(args.deadline ?? BigInt(0), 'deadline');

  const threshold: Hex = args.threshold === undefined || args.threshold === null ? '0x' : uintN(args.threshold, 32, 'threshold');
  const toBytes: Hex = to !== ZERO_ADDRESS && to !== taker ? to : '0x';
  const deadlineBytes: Hex = deadline !== BigInt(0) ? uintN(deadline, 5, 'deadline') : '0x';

  const preInHook = bytesDyn(args.preTransferInHookData, 'preTransferInHookData');
  const postInHook = bytesDyn(args.postTransferInHookData, 'postTransferInHookData');
  const preOutHook = bytesDyn(args.preTransferOutHookData, 'preTransferOutHookData');
  const postOutHook = bytesDyn(args.postTransferOutHookData, 'postTransferOutHookData');
  const preInCb = bytesDyn(args.preTransferInCallbackData, 'preTransferInCallbackData');
  const preOutCb = bytesDyn(args.preTransferOutCallbackData, 'preTransferOutCallbackData');
  const instructionsArgs = bytesDyn(args.instructionsArgs, 'instructionsArgs');
  const signature = bytesDyn(args.signature, 'signature');

  if (size(preInCb) > 0 && !args.hasPreTransferInCallback) throw new SwapVMEncodingError('TakerTraitsMissingHasPreTransferInFlag()');
  if (size(preOutCb) > 0 && !args.hasPreTransferOutCallback) throw new SwapVMEncodingError('TakerTraitsMissingHasPreTransferOutFlag()');

  const index0 = size(threshold);
  const index1 = index0 + size(toBytes);
  const index2 = index1 + size(deadlineBytes);
  const index3 = index2 + size(preInHook);
  const index4 = index3 + size(postInHook);
  const index5 = index4 + size(preOutHook);
  const index6 = index5 + size(postOutHook);
  const index7 = index6 + size(preInCb);
  const index8 = index7 + size(preOutCb);
  const index9 = index8 + size(instructionsArgs);

  const slicesIndexes = concat(
    toUint16(index9, 'index9'),
    toUint16(index8, 'index8'),
    toUint16(index7, 'index7'),
    toUint16(index6, 'index6'),
    toUint16(index5, 'index5'),
    toUint16(index4, 'index4'),
    toUint16(index3, 'index3'),
    toUint16(index2, 'index2'),
    toUint16(index1, 'index1'),
    toUint16(index0, 'index0'),
  );

  const flags =
    (args.isExactIn ? TAKER_IS_EXACT_IN : 0) |
    (args.shouldUnwrapWeth ? TAKER_SHOULD_UNWRAP_WETH : 0) |
    (args.isStrictThresholdAmount ? TAKER_IS_STRICT_THRESHOLD : 0) |
    (args.isFirstTransferFromTaker ? TAKER_IS_FIRST_TRANSFER_FROM_TAKER : 0) |
    (args.useTransferFromAndAquaPush ? TAKER_USE_TRANSFER_FROM_AND_AQUA_PUSH : 0) |
    (args.hasPreTransferInCallback ? TAKER_HAS_PRE_TRANSFER_IN_CALLBACK : 0) |
    (args.hasPreTransferOutCallback ? TAKER_HAS_PRE_TRANSFER_OUT_CALLBACK : 0) |
    (args.isAToB ? TAKER_IS_A_TO_B : 0) |
    (args.allowPartialFill ? TAKER_ALLOW_PARTIAL_FILL : 0);

  return concat(
    slicesIndexes,
    uintN(flags, 2),
    threshold,
    toBytes,
    deadlineBytes,
    preInHook,
    postInHook,
    preOutHook,
    postOutHook,
    preInCb,
    preOutCb,
    instructionsArgs,
    signature,
  );
}

export interface TakerTraitsDecoded {
  isExactIn: boolean;
  shouldUnwrapWeth: boolean;
  hasPreTransferInCallback: boolean;
  hasPreTransferOutCallback: boolean;
  isStrictThresholdAmount: boolean;
  isFirstTransferFromTaker: boolean;
  useTransferFromAndAquaPush: boolean;
  isAToB: boolean;
  allowPartialFill: boolean;
  /** undefined when no threshold slice is present. */
  threshold?: bigint;
  /** undefined when the taker is the recipient. */
  to?: Address;
  /** 0 when no deadline. */
  deadline: bigint;
  preTransferInHookData: Hex;
  postTransferInHookData: Hex;
  preTransferOutHookData: Hex;
  postTransferOutHookData: Hex;
  preTransferInCallbackData: Hex;
  preTransferOutCallbackData: Hex;
  instructionsArgs: Hex;
  signature: Hex;
}

/** Inverse of `buildTakerTraits` (mirrors `TakerTraitsLib.parse` + slice getters). */
export function decodeTakerTraits(packed: Hex): TakerTraitsDecoded {
  const total = size(packed);
  if (total < TAKER_TRAITS_HEADER_SIZE) throw new SwapVMEncodingError('TakerTraitsMissingTraits()');
  const header = hexToBigInt(slice(packed, 0, TAKER_TRAITS_HEADER_SIZE));
  const flags = Number(header & BigInt(0xffff));
  const offset = (n: number) => Number((header >> BigInt(16) >> BigInt(n << 4)) & BigInt(0xffff));
  const tailLen = total - TAKER_TRAITS_HEADER_SIZE;
  const tail: Hex = tailLen === 0 ? '0x' : slice(packed, TAKER_TRAITS_HEADER_SIZE);
  const sliceN = (i: number): Hex => {
    const start = i === 0 ? 0 : offset(i - 1);
    const end = i === 10 ? tailLen : offset(i);
    if (start > end || end > tailLen) throw new SwapVMEncodingError('TakerTraitsMissingHookData()');
    return start === end ? '0x' : slice(tail, start, end);
  };
  const threshold = sliceN(0);
  const to = sliceN(1);
  const deadline = sliceN(2);
  return {
    isExactIn: (flags & TAKER_IS_EXACT_IN) !== 0,
    shouldUnwrapWeth: (flags & TAKER_SHOULD_UNWRAP_WETH) !== 0,
    hasPreTransferInCallback: (flags & TAKER_HAS_PRE_TRANSFER_IN_CALLBACK) !== 0,
    hasPreTransferOutCallback: (flags & TAKER_HAS_PRE_TRANSFER_OUT_CALLBACK) !== 0,
    isStrictThresholdAmount: (flags & TAKER_IS_STRICT_THRESHOLD) !== 0,
    isFirstTransferFromTaker: (flags & TAKER_IS_FIRST_TRANSFER_FROM_TAKER) !== 0,
    useTransferFromAndAquaPush: (flags & TAKER_USE_TRANSFER_FROM_AND_AQUA_PUSH) !== 0,
    isAToB: (flags & TAKER_IS_A_TO_B) !== 0,
    allowPartialFill: (flags & TAKER_ALLOW_PARTIAL_FILL) !== 0,
    threshold: size(threshold) === 32 ? hexToBigInt(threshold) : undefined,
    to: size(to) === 20 ? (to as Address) : undefined,
    deadline: size(deadline) === 5 ? hexToBigInt(deadline) : BigInt(0),
    preTransferInHookData: sliceN(3),
    postTransferInHookData: sliceN(4),
    preTransferOutHookData: sliceN(5),
    postTransferOutHookData: sliceN(6),
    preTransferInCallbackData: sliceN(7),
    preTransferOutCallbackData: sliceN(8),
    instructionsArgs: sliceN(9),
    signature: sliceN(10),
  };
}
