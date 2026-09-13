/**
 * Low-level byte encoding helpers mirroring `MemoryPtrLib` / `InstructionBuilder`
 * from @1inch/swap-vm. Everything is big-endian, fixed-width, and lowercase hex.
 */
import { concatHex, hexToBigInt, isAddress, isHex, size, type Address, type Hex } from 'viem';

export type Uint = bigint | number;

export class SwapVMEncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SwapVMEncodingError';
  }
}

export function toBigInt(value: Uint, name = 'value'): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new SwapVMEncodingError(`${name} must be a bigint or a safe integer, got ${String(value)}`);
  }
  return BigInt(value);
}

/** `MemoryPtrLib.push(uint256 value, uint8 size)`: big-endian, exactly `bytes` bytes. */
export function uintN(value: Uint, bytes: number, name = 'value'): Hex {
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > 32) {
    throw new SwapVMEncodingError(`invalid uint width ${bytes}`);
  }
  const v = toBigInt(value, name);
  if (v < BigInt(0)) throw new SwapVMEncodingError(`${name} must be non-negative`);
  if (v >> BigInt(bytes * 8) !== BigInt(0)) {
    throw new SwapVMEncodingError(`${name} does not fit in uint${bytes * 8}: ${v}`);
  }
  return `0x${v.toString(16).padStart(bytes * 2, '0')}`;
}

export function assertAddress(value: string, name = 'address'): Address {
  if (!isAddress(value, { strict: false })) throw new SwapVMEncodingError(`${name} is not an address: ${value}`);
  return value.toLowerCase() as Address;
}

/** `MemoryPtrLib.push(address)`: 20 raw bytes. */
export function address20(value: Address, name = 'address'): Hex {
  return assertAddress(value, name);
}

/** `uint80(uint160(addr))` style truncation: the low `bytes` bytes of an address. */
export function addressTail(value: Address, bytes: number, name = 'address'): Hex {
  const v = hexToBigInt(assertAddress(value, name));
  return uintN(v & ((BigInt(1) << BigInt(bytes * 8)) - BigInt(1)), bytes, name);
}

/** Dynamic `bytes` argument (`undefined` => empty). */
export function bytesDyn(value: Hex | undefined, name = 'bytes'): Hex {
  if (value === undefined || value === null) return '0x';
  if (!isHex(value, { strict: true }) || value.length % 2 !== 0) {
    throw new SwapVMEncodingError(`${name} must be even-length hex`);
  }
  return value.toLowerCase() as Hex;
}

/** `InstructionBuilder.encodeBool(value, bit)`: a single bit counted from the MSB of a byte. */
export function encodeBool(value: boolean, bit: number): number {
  if (!Number.isInteger(bit) || bit < 0 || bit >= 8) throw new SwapVMEncodingError(`InstructionBuilderBitExceedsByte(${bit})`);
  return value ? 128 >> bit : 0;
}

/** Numeric address comparison, as Solidity `tokenIn < tokenOut`. */
export function addressLt(a: Address, b: Address): boolean {
  return hexToBigInt(assertAddress(a, 'a')) < hexToBigInt(assertAddress(b, 'b'));
}

/** Size of the `[opcode:u8][argsLength:u8]` header (`InstructionBuilder.sizeOf()`). */
export const INSTRUCTION_HEADER_SIZE = 2;

/** `[opcode][len][args]` exactly as `pushHeader` + `patchLength` produce it. */
export function instruction(opcode: number, args: Hex = '0x'): Hex {
  if (!Number.isInteger(opcode) || opcode < 0 || opcode > 0xff) throw new SwapVMEncodingError(`invalid opcode ${opcode}`);
  const body = bytesDyn(args, 'args');
  const len = size(body);
  if (len >= 256) throw new SwapVMEncodingError(`InstructionBuilderArgsLengthExceeded(${len})`);
  return concat(uintN(opcode, 1), uintN(len, 1), body);
}

/** Concatenate hex chunks (a program is simply the concatenation of instructions). */
export function concat(...chunks: Hex[]): Hex {
  return concatHex(chunks).toLowerCase() as Hex;
}

/** Byte length of a hex string. */
export function byteLength(value: Hex): number {
  return size(value);
}
