/**
 * Byte reading for the mapping.
 *
 * Everything here is deliberately hand-rolled rather than routed through `ethereum.decode`. The
 * payload we parse is `abi.encode(ISwapVM.Order)`, a top-level *dynamic tuple*, and the host
 * decoder's handling of that case has changed between graph-node versions. The ABI layout has not:
 * it is fixed by the spec, so parsing it directly is both more legible and more stable.
 */
import { BigInt, Bytes } from "@graphprotocol/graph-ts";

/** A copy of `data[start:end]`. Copied rather than `subarray`d so nothing aliases the source buffer. */
export function slice(data: Bytes, start: i32, end: i32): Bytes {
  let n = end - start;
  let out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = data[start + i];
  }
  return Bytes.fromUint8Array(out);
}

/**
 * The big-endian unsigned integer of `length` bytes at `offset`.
 *
 * `BigInt.fromUnsignedBytes` reads little-endian, so the bytes are reversed on the way in. The
 * caller is responsible for bounds; `readable()` is the check.
 */
export function beUint(data: Bytes, offset: i32, length: i32): BigInt {
  let out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    out[length - 1 - i] = data[offset + i];
  }
  return BigInt.fromUnsignedBytes(Bytes.fromUint8Array(out));
}

/** True when `[offset, offset + length)` lies inside `data`. */
export function readable(data: Bytes, offset: i32, length: i32): boolean {
  return offset >= 0 && length >= 0 && offset + length <= data.length;
}

/**
 * A `BigInt` narrowed to an array index, or -1 when it does not fit.
 *
 * The input is a public event log, so a length word can be `2^256 - 1`. `BigInt.toI32()` traps on
 * overflow, and a trap kills the whole subgraph rather than one entry, so the range is checked
 * before the conversion instead of after.
 */
export function asIndex(value: BigInt, max: i32): i32 {
  if (value.lt(BigInt.zero())) return -1;
  if (value.gt(BigInt.fromI32(max))) return -1;
  return value.toI32();
}
