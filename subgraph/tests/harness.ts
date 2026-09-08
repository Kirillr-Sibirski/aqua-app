/**
 * The mapping's decoder, made callable from outside the mapping.
 *
 * `src/decode.ts` is the claim this whole read layer rests on: that the terms of every option ever
 * written on the router can be recovered from Aqua's log by anyone, with no cooperation from the
 * maker. A claim like that has to be executable, not asserted, and the code that would execute it
 * normally only runs inside graph-node with an Ethereum event in hand.
 *
 * So this file is a thin door into it. `tests/decode.test.mjs` compiles it with exactly the flags
 * `graph build` uses (`--explicitStart --exportRuntime --runtime stub`, graph-ts as the global),
 * loads the resulting WebAssembly, hands it the bytes of a real `Shipped` payload and reads the
 * decoded terms back out. Nothing is stubbed and nothing is reimplemented: the wasm under test is
 * the same AssemblyScript that ships in `build/Aqua/Aqua.wasm`.
 *
 * The interface is deliberately primitive — allocate, run, read pointers — because every managed
 * value here (`Bytes`, `BigInt`) is a `Uint8Array` subclass, and a pointer to one is all a host
 * needs to read it. That is also how graph-node itself talks to a mapping.
 */
import { BigInt, Bytes } from '@graphprotocol/graph-ts';
import { DecodedOrder, LegTerms, decodeProgram, decodeStrategy } from '../src/decode';

/** Status codes returned by `run` and `runProgram`. Distinct so a test can tell where it stopped. */
export const OK: i32 = 0;
export const NOT_AN_ORDER: i32 = 1;
export const NOT_A_LEG: i32 = 2;

let input: Uint8Array = new Uint8Array(0);
let order: DecodedOrder | null = null;
let terms: LegTerms | null = null;

/**
 * A buffer for the host to fill.
 *
 * Returns the `Uint8Array` itself; the caller reads `dataStart` out of the object header and writes
 * there. Held in a global so the stub runtime, which never collects, keeps it alive for the call.
 */
export function alloc(length: i32): Uint8Array {
  input = new Uint8Array(length);
  order = null;
  terms = null;
  return input;
}

/** Decode the buffer as `abi.encode(ISwapVM.Order)` and then as a Strikeline leg. */
export function run(): i32 {
  let decoded = decodeStrategy(Bytes.fromUint8Array(input));
  if (decoded == null) return NOT_AN_ORDER;
  order = decoded;

  let found = decodeProgram((decoded as DecodedOrder).program);
  if (found == null) return NOT_A_LEG;
  terms = found;
  return OK;
}

/** Decode the buffer as a bare SwapVM program, skipping the ABI envelope. */
export function runProgram(): i32 {
  let found = decodeProgram(Bytes.fromUint8Array(input));
  if (found == null) return NOT_A_LEG;
  terms = found;
  return OK;
}

// --------------------------------------------------------------------------------------- readback
// Every getter returns a pointer to a Uint8Array-shaped object. BigInt is little-endian, Bytes are
// the bytes themselves; the host reads both the same way.

export function maker(): Bytes {
  return Bytes.fromUint8Array(changetype<DecodedOrder>(order).maker);
}

export function tokenA(): Bytes {
  return Bytes.fromUint8Array(changetype<DecodedOrder>(order).tokenA);
}

export function tokenB(): Bytes {
  return Bytes.fromUint8Array(changetype<DecodedOrder>(order).tokenB);
}

export function program(): Bytes {
  return changetype<DecodedOrder>(order).program;
}

export function strikeWad(): BigInt {
  return changetype<LegTerms>(terms).strikeWad;
}

export function sigmaWad(): BigInt {
  return changetype<LegTerms>(terms).sigmaWad;
}

export function maturity(): BigInt {
  return changetype<LegTerms>(terms).maturity;
}

export function liquidityWad(): BigInt {
  return changetype<LegTerms>(terms).liquidityWad;
}

export function rateRisky(): BigInt {
  return changetype<LegTerms>(terms).rateRisky;
}

export function rateStable(): BigInt {
  return changetype<LegTerms>(terms).rateStable;
}

export function flags(): i32 {
  return changetype<LegTerms>(terms).flags;
}

export function guarded(): bool {
  return changetype<LegTerms>(terms).guarded;
}

export function riskyIsTokenA(): bool {
  return changetype<LegTerms>(terms).riskyIsTokenA;
}
