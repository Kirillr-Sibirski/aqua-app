/**
 * SwapVM (1inch) encoder for the browser: programs, orders, hashes and taker traits,
 * byte-for-byte identical to the Solidity libraries in @1inch/swap-vm.
 *
 * Verified against Solidity via contracts/test/encoding/EncodingVectors.t.sol
 * and __tests__/encoding.test.ts.
 */
export { Opcode, AQUA_OPCODES, PROBE_ROUTER_OPCODES, opcodeName } from './opcodes';
export type { OpcodeName, OpcodeValue } from './opcodes';

export * as ix from './instructions';
export {
  program,
  customInstruction,
  ONE,
  BPS,
  MAX_LINEAR_WIDTH,
} from './instructions';
export type {
  Direction,
  PeggedSwapArgs,
  TwapSwapArgs,
  FeeProtocolArgs,
  FeeProtocolReceiver,
  FeeProtocolProvider,
  OraclePriceAdjusterArgs,
  BaseFeeAdjusterArgs,
  SwapRegisters,
} from './instructions';

export {
  buildOrder,
  buildAquaOrder,
  encodeStrategyForShip,
  orderHash,
  orderHashAqua,
  orderHashEip712,
  decodeMakerTraits,
  decodeOrder,
  usesAqua,
  ORDER_TYPEHASH,
  ORDER_EIP712_TYPES,
  ORDER_ABI_COMPONENTS,
  ORDER_TUPLE_ABI,
  ZERO_ADDRESS,
} from './order';
export type { Order, BuildOrderArgs, SwapVMDomain, MakerTraitsDecoded, OrderDecoded, OrderHook } from './order';

export { buildTakerTraits, decodeTakerTraits, TAKER_TRAITS_HEADER_SIZE } from './taker';
export type { BuildTakerTraitsArgs, TakerTraitsDecoded } from './taker';

export { swapVmAbi, aquaAbi, erc20Abi } from './abi';

export * as math from './math';

export {
  SwapVMEncodingError,
  instruction,
  uintN,
  encodeBool,
  addressLt,
  concat,
  byteLength,
  INSTRUCTION_HEADER_SIZE,
} from './bytes';
export type { Uint } from './bytes';
