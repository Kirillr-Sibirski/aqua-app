/**
 * The decoder: shipped bytes in, an option out.
 *
 * `Aqua.ship` takes the strategy "fully instead of being pre-hashed, for data availability", and the
 * `Shipped` event carries exactly those bytes. For a SwapVM order they are `abi.encode(Order)`, and
 * the order's `data` ends in the VM program. A Strikeline leg's program contains `RmmSwap` (opcode
 * `0x55`), whose 62 argument bytes hold the strike, the implied vol, the maturity and the liquidity
 * in the clear.
 *
 * So this file is the whole read layer's premise: every option any maker has written on the router
 * is publicly decodable, from the log alone, with no cooperation from the maker and no off-chain
 * book. Nothing here calls a contract.
 *
 * Mirrors `contracts/src/SurfaceLens.sol` (`decodeProgram`, `_price`) and
 * `MakerTraitsLib._getOffset` in @1inch/swap-vm.
 */
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { asIndex, beUint, readable, slice } from "./bytes";

/** `RmmSwap.opcode` — the covered-call curve. Curves bank `0x50-0x6f`. */
export const OPCODE_RMM_SWAP: i32 = 0x55;
/** `Coverage.opcode` — the portfolio-margin wrapper. Balances-tuning bank `0x90-0xaf`. */
export const OPCODE_COVERAGE: i32 = 0x93;
/** `[opcode][argsLength]`, per `InstructionBuilder.sizeOf()`. */
const INSTRUCTION_HEADER: i32 = 2;
/** `RmmSwap` argument length; a `0x55` with any other length is not our instruction. */
const RMM_ARGS_LENGTH: i32 = 62;

export const FLAG_RISKY_IS_TOKEN_A: i32 = 1;

/** The `Order` struct, recovered from `abi.encode(order)`. */
export class DecodedOrder {
  maker: Address;
  tokenA: Address;
  tokenB: Address;
  program: Bytes;

  constructor(maker: Address, tokenA: Address, tokenB: Address, program: Bytes) {
    this.maker = maker;
    this.tokenA = tokenA;
    this.tokenB = tokenB;
    this.program = program;
  }
}

/** The `RmmSwap` arguments, plus whether the program wraps them in `Coverage`. */
export class LegTerms {
  flags: i32;
  sigmaWad: BigInt;
  maturity: BigInt;
  strikeWad: BigInt;
  liquidityWad: BigInt;
  rateRisky: BigInt;
  rateStable: BigInt;
  guarded: boolean;

  constructor(
    flags: i32,
    sigmaWad: BigInt,
    maturity: BigInt,
    strikeWad: BigInt,
    liquidityWad: BigInt,
    rateRisky: BigInt,
    rateStable: BigInt,
    guarded: boolean
  ) {
    this.flags = flags;
    this.sigmaWad = sigmaWad;
    this.maturity = maturity;
    this.strikeWad = strikeWad;
    this.liquidityWad = liquidityWad;
    this.rateRisky = rateRisky;
    this.rateStable = rateStable;
    this.guarded = guarded;
  }

  get riskyIsTokenA(): boolean {
    return (this.flags & FLAG_RISKY_IS_TOKEN_A) != 0;
  }
}

/**
 * `abi.decode(strategy, (Order))`, by hand.
 *
 * Layout of `abi.encode(Order{address maker, uint256 traits, bytes data})`:
 *
 *   0x00  0x20                offset to the tuple (canonical; anything else is not abi.encode)
 *   0x20  maker               left-padded to a word
 *   0x40  traits
 *   0x60  offset of `data`, relative to the start of the tuple
 *   ...   data.length, then data
 *
 * `data` is `tokenA ‖ tokenB ‖ hook slices ‖ program`, and the program's start offset is packed into
 * `traits` at bits 208..223 — the fourth `OrderDataSlices` index, which is the end of the last hook
 * slice. Reading it (rather than assuming 40) is what makes a leg with maker hooks decode correctly.
 */
export function decodeStrategy(strategy: Bytes): DecodedOrder | null {
  if (!readable(strategy, 0, 0xa0)) return null;
  if (beUint(strategy, 0, 32).notEqual(BigInt.fromI32(0x20))) return null;

  let traitsAt = 0x40;
  let dataRel = asIndex(beUint(strategy, 0x60, 32), strategy.length);
  if (dataRel < 0) return null;

  let dataOffset = 0x20 + dataRel;
  if (!readable(strategy, dataOffset, 32)) return null;
  let dataLength = asIndex(beUint(strategy, dataOffset, 32), strategy.length);
  if (dataLength < 40) return null;

  let dataAt = dataOffset + 32;
  if (!readable(strategy, dataAt, dataLength)) return null;

  // MakerTraitsLib._getOffset(traits, 3) == (traits >> 160 >> 48) & 0xffff, i.e. bits 208..223,
  // i.e. bytes 4..6 of the big-endian traits word.
  let programStart = beUint(strategy, traitsAt + 4, 2).toI32();
  if (programStart < 40 || programStart > dataLength) return null;

  return new DecodedOrder(
    Address.fromBytes(slice(strategy, 0x2c, 0x40)),
    Address.fromBytes(slice(strategy, dataAt, dataAt + 20)),
    Address.fromBytes(slice(strategy, dataAt + 20, dataAt + 40)),
    slice(strategy, dataAt + programStart, dataAt + dataLength)
  );
}

/**
 * Walk the instruction stream and pull out the curve.
 *
 * A SwapVM program is `[opcode][argsLength][args]` repeated, so this is an exact decode rather than
 * a pattern match: the scan either lands on every instruction boundary or the program is malformed
 * and we decline it. Returns null for any program that is not a Strikeline leg, which includes every
 * ordinary Aqua strategy shipped to the same router.
 */
export function decodeProgram(program: Bytes): LegTerms | null {
  let pc = 0;
  let guarded = false;
  let terms: LegTerms | null = null;

  while (pc + INSTRUCTION_HEADER <= program.length) {
    let opcode = program[pc] as i32;
    let argsLength = program[pc + 1] as i32;
    let argsAt = pc + INSTRUCTION_HEADER;
    if (argsAt + argsLength > program.length) return null;

    if (opcode == OPCODE_COVERAGE) {
      guarded = true;
    } else if (opcode == OPCODE_RMM_SWAP && terms == null && argsLength == RMM_ARGS_LENGTH) {
      terms = new LegTerms(
        program[argsAt] as i32,
        beUint(program, argsAt + 1, 8),
        beUint(program, argsAt + 9, 5),
        beUint(program, argsAt + 14, 16),
        beUint(program, argsAt + 30, 16),
        beUint(program, argsAt + 46, 8),
        beUint(program, argsAt + 54, 8),
        false
      );
    }

    pc = argsAt + argsLength;
  }

  // A stream that does not end exactly on an instruction boundary is not a program we can trust.
  if (pc != program.length) return null;
  if (terms == null) return null;

  let found = terms as LegTerms;
  found.guarded = guarded;
  return found;
}
