/**
 * Order construction and hashing, mirroring `MakerTraitsLib` (@1inch/swap-vm `src/libs/MakerTraits.sol`)
 * and `SwapVM.hash(order)`.
 *
 * Order = { maker, traits, data } where
 *   traits = flags(bits 255..245) | slicesIndexes(uint64 @ bit 160) | receiver(uint160)
 *   data   = tokenA(20) ‖ tokenB(20) ‖ [preInTarget(20)?] preInData ‖ [postInTarget?] postInData
 *            ‖ [preOutTarget?] preOutData ‖ [postOutTarget?] postOutData ‖ program
 */
import {
  encodeAbiParameters,
  hashTypedData,
  hexToBigInt,
  keccak256,
  size,
  slice,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import { SwapVMEncodingError, addressLt, assertAddress, bytesDyn, concat } from './bytes';

export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

export interface Order {
  maker: Address;
  /** Packed MakerTraits (uint256). */
  traits: bigint;
  /** tokenA ‖ tokenB ‖ hook slices ‖ program. */
  data: Hex;
}

/** 1:1 with `MakerTraitsLib.Args`; every optional field defaults to zero/false/empty. */
export interface BuildOrderArgs {
  maker: Address;
  /** Recipient of tokenIn (zero => maker). Must be zero for Aqua orders. */
  receiver?: Address;
  /** Token with the lower address. */
  tokenA: Address;
  /** Token with the greater address. */
  tokenB: Address;

  /** Unwrap WETH to ETH when receiving (incompatible with Aqua). */
  shouldUnwrapWeth?: boolean;
  /** Use Aqua balances instead of a maker signature. */
  useAquaInsteadOfSignature?: boolean;
  allowZeroAmountIn?: boolean;
  hasPreTransferInHook?: boolean;
  hasPostTransferInHook?: boolean;
  hasPreTransferOutHook?: boolean;
  hasPostTransferOutHook?: boolean;

  /** Hook contract (zero or == maker => hook is called on the maker). */
  preTransferInTarget?: Address;
  preTransferInData?: Hex;
  postTransferInTarget?: Address;
  postTransferInData?: Hex;
  preTransferOutTarget?: Address;
  preTransferOutData?: Hex;
  postTransferOutTarget?: Address;
  postTransferOutData?: Hex;

  /** VM bytecode (concatenated instructions). */
  program: Hex;
}

// Flag bits (MakerTraitsLib)
export const MAKER_SHOULD_UNWRAP_WETH = BigInt(1) << BigInt(255);
export const MAKER_USE_AQUA_INSTEAD_OF_SIGNATURE = BigInt(1) << BigInt(254);
export const MAKER_ALLOW_ZERO_AMOUNT_IN = BigInt(1) << BigInt(253);
export const MAKER_HAS_PRE_TRANSFER_IN_HOOK = BigInt(1) << BigInt(252);
export const MAKER_HAS_POST_TRANSFER_IN_HOOK = BigInt(1) << BigInt(251);
export const MAKER_HAS_PRE_TRANSFER_OUT_HOOK = BigInt(1) << BigInt(250);
export const MAKER_HAS_POST_TRANSFER_OUT_HOOK = BigInt(1) << BigInt(249);
export const MAKER_PRE_TRANSFER_IN_HOOK_HAS_TARGET = BigInt(1) << BigInt(248);
export const MAKER_POST_TRANSFER_IN_HOOK_HAS_TARGET = BigInt(1) << BigInt(247);
export const MAKER_PRE_TRANSFER_OUT_HOOK_HAS_TARGET = BigInt(1) << BigInt(246);
export const MAKER_POST_TRANSFER_OUT_HOOK_HAS_TARGET = BigInt(1) << BigInt(245);
const ORDER_DATA_SLICES_INDEXES_BIT_OFFSET = BigInt(160);
const UINT16_MAX = BigInt(0xffff);
const UINT160_MASK = (BigInt(1) << BigInt(160)) - BigInt(1);

function toUint16(value: number, name: string): bigint {
  if (value > 0xffff) throw new SwapVMEncodingError(`SafeCastOverflowedUintDowncast(16, ${value}) for ${name}`);
  return BigInt(value);
}

function hasTarget(target: Address | undefined, maker: Address): boolean {
  if (target === undefined) return false;
  const t = assertAddress(target, 'hook target');
  return t !== maker && t !== ZERO_ADDRESS;
}

/** `MakerTraitsLib.build(args)`. */
export function buildOrder(args: BuildOrderArgs): Order {
  const maker = assertAddress(args.maker, 'maker');
  const receiver = assertAddress(args.receiver ?? ZERO_ADDRESS, 'receiver');
  const tokenA = assertAddress(args.tokenA, 'tokenA');
  const tokenB = assertAddress(args.tokenB, 'tokenB');
  if (!addressLt(tokenA, tokenB)) throw new SwapVMEncodingError('MakerTraitsTokensNotSorted()');

  const preInData = bytesDyn(args.preTransferInData, 'preTransferInData');
  const postInData = bytesDyn(args.postTransferInData, 'postTransferInData');
  const preOutData = bytesDyn(args.preTransferOutData, 'preTransferOutData');
  const postOutData = bytesDyn(args.postTransferOutData, 'postTransferOutData');
  const program = bytesDyn(args.program, 'program');

  const preInHasTarget = hasTarget(args.preTransferInTarget, maker);
  const postInHasTarget = hasTarget(args.postTransferInTarget, maker);
  const preOutHasTarget = hasTarget(args.preTransferOutTarget, maker);
  const postOutHasTarget = hasTarget(args.postTransferOutTarget, maker);

  if ((preInHasTarget || size(preInData) > 0) && !args.hasPreTransferInHook) throw new SwapVMEncodingError('MakerTraitsMissingHasPreTransferInFlag()');
  if ((postInHasTarget || size(postInData) > 0) && !args.hasPostTransferInHook) throw new SwapVMEncodingError('MakerTraitsMissingHasPostTransferInFlag()');
  if ((preOutHasTarget || size(preOutData) > 0) && !args.hasPreTransferOutHook) throw new SwapVMEncodingError('MakerTraitsMissingHasPreTransferOutFlag()');
  if ((postOutHasTarget || size(postOutData) > 0) && !args.hasPostTransferOutHook) throw new SwapVMEncodingError('MakerTraitsMissingHasPostTransferOutFlag()');

  const index0 = 40 + (preInHasTarget ? 20 : 0) + size(preInData);
  const index1 = index0 + (postInHasTarget ? 20 : 0) + size(postInData);
  const index2 = index1 + (preOutHasTarget ? 20 : 0) + size(preOutData);
  const index3 = index2 + (postOutHasTarget ? 20 : 0) + size(postOutData);

  // uint64(bytes8(abi.encodePacked(index3, index2, index1, index0)))
  const orderDataIndexes =
    (toUint16(index3, 'index3') << BigInt(48)) |
    (toUint16(index2, 'index2') << BigInt(32)) |
    (toUint16(index1, 'index1') << BigInt(16)) |
    toUint16(index0, 'index0');

  const traits =
    (args.shouldUnwrapWeth ? MAKER_SHOULD_UNWRAP_WETH : BigInt(0)) |
    (args.useAquaInsteadOfSignature ? MAKER_USE_AQUA_INSTEAD_OF_SIGNATURE : BigInt(0)) |
    (args.allowZeroAmountIn ? MAKER_ALLOW_ZERO_AMOUNT_IN : BigInt(0)) |
    (args.hasPreTransferInHook ? MAKER_HAS_PRE_TRANSFER_IN_HOOK : BigInt(0)) |
    (args.hasPostTransferInHook ? MAKER_HAS_POST_TRANSFER_IN_HOOK : BigInt(0)) |
    (args.hasPreTransferOutHook ? MAKER_HAS_PRE_TRANSFER_OUT_HOOK : BigInt(0)) |
    (args.hasPostTransferOutHook ? MAKER_HAS_POST_TRANSFER_OUT_HOOK : BigInt(0)) |
    (preInHasTarget ? MAKER_PRE_TRANSFER_IN_HOOK_HAS_TARGET : BigInt(0)) |
    (postInHasTarget ? MAKER_POST_TRANSFER_IN_HOOK_HAS_TARGET : BigInt(0)) |
    (preOutHasTarget ? MAKER_PRE_TRANSFER_OUT_HOOK_HAS_TARGET : BigInt(0)) |
    (postOutHasTarget ? MAKER_POST_TRANSFER_OUT_HOOK_HAS_TARGET : BigInt(0)) |
    (orderDataIndexes << ORDER_DATA_SLICES_INDEXES_BIT_OFFSET) |
    hexToBigInt(receiver);

  const data = concat(
    tokenA,
    tokenB,
    preInHasTarget ? assertAddress(args.preTransferInTarget!) : '0x',
    preInData,
    postInHasTarget ? assertAddress(args.postTransferInTarget!) : '0x',
    postInData,
    preOutHasTarget ? assertAddress(args.preTransferOutTarget!) : '0x',
    preOutData,
    postOutHasTarget ? assertAddress(args.postTransferOutTarget!) : '0x',
    postOutData,
    program,
  );

  return { maker, traits, data };
}

/** Convenience for the common Aqua case: no hooks, no receiver, Aqua balances. */
export function buildAquaOrder(args: Pick<BuildOrderArgs, 'maker' | 'tokenA' | 'tokenB' | 'program' | 'allowZeroAmountIn'>): Order {
  return buildOrder({ ...args, useAquaInsteadOfSignature: true });
}

// ---------------------------------------------------------------------------
// ABI encoding & hashing
// ---------------------------------------------------------------------------

export const ORDER_ABI_COMPONENTS = [
  { name: 'maker', type: 'address' },
  { name: 'traits', type: 'uint256' },
  { name: 'data', type: 'bytes' },
] as const;

export const ORDER_TUPLE_ABI = [{ name: 'order', type: 'tuple', components: ORDER_ABI_COMPONENTS }] as const;

/** `keccak256("Order(address maker,uint256 traits,bytes data)")` */
export const ORDER_TYPEHASH: Hex = keccak256(toHex('Order(address maker,uint256 traits,bytes data)'));

export const ORDER_EIP712_TYPES = {
  Order: [
    { name: 'maker', type: 'address' },
    { name: 'traits', type: 'uint256' },
    { name: 'data', type: 'bytes' },
  ],
} as const;

/** `abi.encode(order)` — the exact `strategy` bytes to pass to `Aqua.ship(app, strategy, tokens, amounts)`. */
export function encodeStrategyForShip(order: Order): Hex {
  return encodeAbiParameters(ORDER_TUPLE_ABI, [{ maker: order.maker, traits: order.traits, data: order.data }]);
}

/** Aqua-mode hash: `keccak256(abi.encode(order))` == Aqua strategyHash == `SwapVM.hash(order)`. */
export function orderHashAqua(order: Order): Hex {
  return keccak256(encodeStrategyForShip(order));
}

export interface SwapVMDomain {
  /** EIP-712 domain name passed to the router constructor (ProbeRouter: "ProbeRouter"). */
  name: string;
  /** EIP-712 domain version (ProbeRouter: "1"). */
  version: string;
  chainId: number | bigint;
  /** Router address. */
  verifyingContract: Address;
}

/** Signature-mode hash: `_hashTypedDataV4(keccak256(abi.encode(ORDER_TYPEHASH, maker, traits, keccak256(data))))`. */
export function orderHashEip712(order: Order, domain: SwapVMDomain): Hex {
  return hashTypedData({
    domain: {
      name: domain.name,
      version: domain.version,
      chainId: BigInt(domain.chainId),
      verifyingContract: domain.verifyingContract,
    },
    types: ORDER_EIP712_TYPES,
    primaryType: 'Order',
    message: { maker: order.maker, traits: order.traits, data: order.data },
  });
}

/** `SwapVM.hash(order)`: Aqua hash if the Aqua flag is set, otherwise EIP-712 (domain required). */
export function orderHash(order: Order, domain?: SwapVMDomain): Hex {
  if (usesAqua(order.traits)) return orderHashAqua(order);
  if (!domain) throw new SwapVMEncodingError('EIP-712 domain required for signature-mode orders');
  return orderHashEip712(order, domain);
}

// ---------------------------------------------------------------------------
// Decoding helpers (getters from MakerTraitsLib)
// ---------------------------------------------------------------------------

export function usesAqua(traits: bigint): boolean {
  return (traits & MAKER_USE_AQUA_INSTEAD_OF_SIGNATURE) !== BigInt(0);
}

export interface MakerTraitsDecoded {
  shouldUnwrapWeth: boolean;
  useAquaInsteadOfSignature: boolean;
  allowZeroAmountIn: boolean;
  hasPreTransferInHook: boolean;
  hasPostTransferInHook: boolean;
  hasPreTransferOutHook: boolean;
  hasPostTransferOutHook: boolean;
  preTransferInHookHasTarget: boolean;
  postTransferInHookHasTarget: boolean;
  preTransferOutHookHasTarget: boolean;
  postTransferOutHookHasTarget: boolean;
  /** Raw receiver (zero => maker). */
  receiver: Address;
  /** Slice end offsets [index0..index3] into `data`. */
  sliceIndexes: [number, number, number, number];
}

export function decodeMakerTraits(traits: bigint): MakerTraitsDecoded {
  const idx = (n: bigint) => Number((traits >> ORDER_DATA_SLICES_INDEXES_BIT_OFFSET >> (n << BigInt(4))) & UINT16_MAX);
  return {
    shouldUnwrapWeth: (traits & MAKER_SHOULD_UNWRAP_WETH) !== BigInt(0),
    useAquaInsteadOfSignature: (traits & MAKER_USE_AQUA_INSTEAD_OF_SIGNATURE) !== BigInt(0),
    allowZeroAmountIn: (traits & MAKER_ALLOW_ZERO_AMOUNT_IN) !== BigInt(0),
    hasPreTransferInHook: (traits & MAKER_HAS_PRE_TRANSFER_IN_HOOK) !== BigInt(0),
    hasPostTransferInHook: (traits & MAKER_HAS_POST_TRANSFER_IN_HOOK) !== BigInt(0),
    hasPreTransferOutHook: (traits & MAKER_HAS_PRE_TRANSFER_OUT_HOOK) !== BigInt(0),
    hasPostTransferOutHook: (traits & MAKER_HAS_POST_TRANSFER_OUT_HOOK) !== BigInt(0),
    preTransferInHookHasTarget: (traits & MAKER_PRE_TRANSFER_IN_HOOK_HAS_TARGET) !== BigInt(0),
    postTransferInHookHasTarget: (traits & MAKER_POST_TRANSFER_IN_HOOK_HAS_TARGET) !== BigInt(0),
    preTransferOutHookHasTarget: (traits & MAKER_PRE_TRANSFER_OUT_HOOK_HAS_TARGET) !== BigInt(0),
    postTransferOutHookHasTarget: (traits & MAKER_POST_TRANSFER_OUT_HOOK_HAS_TARGET) !== BigInt(0),
    receiver: toHex(traits & UINT160_MASK, { size: 20 }),
    sliceIndexes: [idx(BigInt(0)), idx(BigInt(1)), idx(BigInt(2)), idx(BigInt(3))],
  };
}

export interface OrderHook {
  /** Contract the hook is called on (maker when no explicit target). */
  target: Address;
  data: Hex;
}

export interface OrderDecoded extends MakerTraitsDecoded {
  maker: Address;
  tokenA: Address;
  tokenB: Address;
  preTransferInHook: OrderHook;
  postTransferInHook: OrderHook;
  preTransferOutHook: OrderHook;
  postTransferOutHook: OrderHook;
  program: Hex;
}

/** Split `order.data` into tokens, hook slices and program (`MakerTraitsLib` slice getters). */
export function decodeOrder(order: Order): OrderDecoded {
  const t = decodeMakerTraits(order.traits);
  const data = order.data;
  const len = size(data);
  if (len < 40) throw new SwapVMEncodingError('order.data shorter than 40 bytes');
  const bounds = [40, ...t.sliceIndexes];
  const sliceAt = (i: number): Hex => {
    const [start, end] = [bounds[i], bounds[i + 1]];
    if (start > end || end > len) throw new SwapVMEncodingError('MakerTraitsMissingHookData()');
    return start === end ? '0x' : slice(data, start, end);
  };
  const hook = (i: number, withTarget: boolean): OrderHook => {
    const raw = sliceAt(i);
    if (!withTarget) return { target: order.maker, data: raw };
    if (size(raw) < 20) throw new SwapVMEncodingError('MakerTraitsMissingHookTarget()');
    return { target: slice(raw, 0, 20) as Address, data: size(raw) === 20 ? '0x' : slice(raw, 20) };
  };
  return {
    ...t,
    maker: order.maker,
    tokenA: slice(data, 0, 20) as Address,
    tokenB: slice(data, 20, 40) as Address,
    preTransferInHook: hook(0, t.preTransferInHookHasTarget),
    postTransferInHook: hook(1, t.postTransferInHookHasTarget),
    preTransferOutHook: hook(2, t.preTransferOutHookHasTarget),
    postTransferOutHook: hook(3, t.postTransferOutHookHasTarget),
    program: t.sliceIndexes[3] === len ? '0x' : slice(data, t.sliceIndexes[3]),
  };
}
