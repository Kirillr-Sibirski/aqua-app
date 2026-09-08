/**
 * The mapping, made callable from outside graph-node.
 *
 * The read layer's claim is that the terms of every option ever written on this router can be
 * recovered from Aqua's log by anyone, with no cooperation from the maker. A claim like that has to
 * be executable, not asserted — and the code that would execute it normally only runs inside
 * graph-node, with an Ethereum event in hand and a Postgres behind it.
 *
 * So this file is a door into it. `tests/wasm.mjs` compiles this module with exactly the flags
 * `graph build` uses (`--explicitStart --exportRuntime --runtime stub`, graph-ts as the global),
 * loads the WebAssembly, and plays the host: it supplies the store, the data source context and the
 * logger the way graph-node does. The mapping under test is therefore the same AssemblyScript that
 * ships in `build/Aqua/Aqua.wasm` — nothing is reimplemented in the test, and nothing is mocked
 * except the host itself.
 *
 * Two doors:
 *
 *   1. the decoder, directly, so a byte offset can be pinned against the Solidity and TypeScript
 *      implementations of the same decode (`tests/decode.test.mjs`);
 *   2. the handlers, through synthetic-but-well-formed events, so the entity graph a query would
 *      actually return can be asserted (`tests/handlers.test.mjs`).
 *
 * The interface is deliberately primitive — allocate, fill, call, read back a pointer — because
 * every managed value here (`Bytes`, `BigInt`) is a `Uint8Array` subclass and a pointer to one is
 * all a host needs. That is also how graph-node itself talks to a mapping.
 */
import { Address, BigInt, Bytes, DataSourceContext, Value, ethereum } from '@graphprotocol/graph-ts';
import { Docked, Pulled, Pushed, Shipped } from '../generated/Aqua/Aqua';
import { Swapped } from '../generated/StrikelineRouter/StrikelineRouter';
import { handleDocked, handlePulled, handlePushed, handleShipped } from '../src/aqua';
import { handleSwapped } from '../src/router';
import { beUint } from '../src/bytes';
import { DecodedOrder, LegTerms, decodeProgram, decodeStrategy } from '../src/decode';

/** Status codes returned by `run` and `runProgram`. Distinct so a test can tell where it stopped. */
export const OK: i32 = 0;
export const NOT_AN_ORDER: i32 = 1;
export const NOT_A_LEG: i32 = 2;

// ------------------------------------------------------------------------------------- arguments
// The host cannot build an AssemblyScript object, so it fills byte buffers and refers to them by
// index. Addresses, hashes, strategies and amounts all arrive this way; an amount is a 32-byte
// big-endian word, exactly as it sits in a log.

let args: Array<Uint8Array> = new Array<Uint8Array>();

/** A buffer for the host to fill. Returns the array; the caller writes at its `dataStart`. */
export function pushArg(length: i32): Uint8Array {
  let buffer = new Uint8Array(length);
  args.push(buffer);
  return buffer;
}

export function clearArgs(): void {
  args = new Array<Uint8Array>();
}

function argBytes(index: i32): Bytes {
  return Bytes.fromUint8Array(args[index]);
}

function argAddress(index: i32): Address {
  return Address.fromBytes(argBytes(index));
}

/** An ASCII buffer, as a string. Lets the host pass text without allocating an AssemblyScript one. */
function argString(index: i32): string {
  let bytes = args[index];
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

/**
 * `typeConversion.stringToH160`, which the host owes the mapping.
 *
 * graph-node implements it in Rust; here it is implemented in AssemblyScript and exported so the
 * JavaScript host can satisfy the same import. `Address.fromString` calls it, and `src/aqua.ts`
 * calls that on the configured router, so without it the app filter cannot run at all.
 */
export function h160(text: string): Bytes {
  let start = text.startsWith('0x') ? 2 : 0;
  let out = new Uint8Array((text.length - start) >> 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = <u8>((nibble(text.charCodeAt(start + i * 2)) << 4) | nibble(text.charCodeAt(start + i * 2 + 1)));
  }
  return Bytes.fromUint8Array(out);
}

function nibble(code: i32): i32 {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 97 && code <= 102) return code - 87;
  if (code >= 65 && code <= 70) return code - 55;
  return 0;
}

/** A 32-byte big-endian word, read with the mapping's own reader. */
function argWord(index: i32): BigInt {
  return beUint(argBytes(index), 0, args[index].length);
}

// -------------------------------------------------------------------------------- door 1: decode

let input: Uint8Array = new Uint8Array(0);
let order: DecodedOrder | null = null;
let terms: LegTerms | null = null;

/** A buffer for the payload to decode. Held in a global so the stub runtime keeps it alive. */
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

// Readback. Every getter returns a pointer to a Uint8Array-shaped object: BigInt is little-endian,
// Bytes are the bytes themselves, and the host reads both the same way.

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

// ------------------------------------------------------------------------------ door 2: handlers

/**
 * The data source context graph-node would hand the mapping.
 *
 * `src/aqua.ts` reads `context.router` to filter events that carry no indexed parameters, so the
 * host has to supply one. It is built here and returned to the host, which hands the same pointer
 * back from `dataSource.context()` — the same trick the store uses.
 */
export function makeContext(routerArg: i32): DataSourceContext {
  let context = new DataSourceContext();
  context.set('router', Value.fromString(argString(routerArg)));
  return context;
}

/** An empty context: the case where `subgraph.yaml` names no router and every app is indexed. */
export function makeEmptyContext(): DataSourceContext {
  return new DataSourceContext();
}

/**
 * A block and a transaction with the fields the mappings read and nothing else invented.
 *
 * The handlers touch `block.timestamp`, `block.number` and `transaction.hash`; every other field is
 * zeroed rather than filled with a plausible-looking number, so a mapping that starts reading one
 * fails here loudly instead of quietly agreeing with a fiction.
 */
function blockAt(number: i64, timestamp: i64): ethereum.Block {
  let zeroBytes = Bytes.fromHexString('0x');
  let zero = BigInt.zero();
  return new ethereum.Block(
    zeroBytes,
    zeroBytes,
    zeroBytes,
    Address.zero(),
    zeroBytes,
    zeroBytes,
    zeroBytes,
    BigInt.fromI64(number),
    zero,
    zero,
    BigInt.fromI64(timestamp),
    zero,
    zero,
    null,
    null
  );
}

function transactionWith(hash: Bytes): ethereum.Transaction {
  let zero = BigInt.zero();
  return new ethereum.Transaction(
    hash,
    zero,
    Address.zero(),
    null,
    zero,
    zero,
    zero,
    Bytes.fromHexString('0x'),
    zero
  );
}

function eventParams(names: string[], values: ethereum.Value[]): Array<ethereum.EventParam> {
  let params = new Array<ethereum.EventParam>();
  for (let i = 0; i < names.length; i++) {
    params.push(new ethereum.EventParam(names[i], values[i]));
  }
  return params;
}

function baseEvent(
  parameters: Array<ethereum.EventParam>,
  logIndex: i32,
  blockNumber: i64,
  timestamp: i64,
  txHash: Bytes
): ethereum.Event {
  return new ethereum.Event(
    Address.zero(),
    BigInt.fromI32(logIndex),
    BigInt.zero(),
    null,
    blockAt(blockNumber, timestamp),
    transactionWith(txHash),
    parameters,
    null
  );
}

/**
 * `Shipped(address maker, address app, bytes32 strategyHash, bytes strategy)`.
 *
 * Argument indices are into the byte buffers the host pushed: maker, app, strategyHash, strategy,
 * transaction hash.
 */
export function ship(
  makerArg: i32,
  appArg: i32,
  hashArg: i32,
  strategyArg: i32,
  txArg: i32,
  logIndex: i32,
  blockNumber: i64,
  timestamp: i64
): void {
  let params = eventParams(
    ['maker', 'app', 'strategyHash', 'strategy'],
    [
      ethereum.Value.fromAddress(argAddress(makerArg)),
      ethereum.Value.fromAddress(argAddress(appArg)),
      ethereum.Value.fromFixedBytes(argBytes(hashArg)),
      ethereum.Value.fromBytes(argBytes(strategyArg)),
    ]
  );
  let event = baseEvent(params, logIndex, blockNumber, timestamp, argBytes(txArg));
  handleShipped(changetype<Shipped>(event));
}

/** `Docked(address maker, address app, bytes32 strategyHash)`. */
export function dock(
  makerArg: i32,
  appArg: i32,
  hashArg: i32,
  txArg: i32,
  logIndex: i32,
  blockNumber: i64,
  timestamp: i64
): void {
  let params = eventParams(
    ['maker', 'app', 'strategyHash'],
    [
      ethereum.Value.fromAddress(argAddress(makerArg)),
      ethereum.Value.fromAddress(argAddress(appArg)),
      ethereum.Value.fromFixedBytes(argBytes(hashArg)),
    ]
  );
  let event = baseEvent(params, logIndex, blockNumber, timestamp, argBytes(txArg));
  handleDocked(changetype<Docked>(event));
}

/** `Pushed`/`Pulled(address maker, address app, bytes32 strategyHash, address token, uint256 amount)`. */
function balanceEvent(
  makerArg: i32,
  appArg: i32,
  hashArg: i32,
  tokenArg: i32,
  amountArg: i32,
  txArg: i32,
  logIndex: i32,
  blockNumber: i64,
  timestamp: i64
): ethereum.Event {
  let params = eventParams(
    ['maker', 'app', 'strategyHash', 'token', 'amount'],
    [
      ethereum.Value.fromAddress(argAddress(makerArg)),
      ethereum.Value.fromAddress(argAddress(appArg)),
      ethereum.Value.fromFixedBytes(argBytes(hashArg)),
      ethereum.Value.fromAddress(argAddress(tokenArg)),
      ethereum.Value.fromUnsignedBigInt(argWord(amountArg)),
    ]
  );
  return baseEvent(params, logIndex, blockNumber, timestamp, argBytes(txArg));
}

export function push(
  makerArg: i32,
  appArg: i32,
  hashArg: i32,
  tokenArg: i32,
  amountArg: i32,
  txArg: i32,
  logIndex: i32,
  blockNumber: i64,
  timestamp: i64
): void {
  handlePushed(
    changetype<Pushed>(
      balanceEvent(makerArg, appArg, hashArg, tokenArg, amountArg, txArg, logIndex, blockNumber, timestamp)
    )
  );
}

export function pull(
  makerArg: i32,
  appArg: i32,
  hashArg: i32,
  tokenArg: i32,
  amountArg: i32,
  txArg: i32,
  logIndex: i32,
  blockNumber: i64,
  timestamp: i64
): void {
  handlePulled(
    changetype<Pulled>(
      balanceEvent(makerArg, appArg, hashArg, tokenArg, amountArg, txArg, logIndex, blockNumber, timestamp)
    )
  );
}

/**
 * `Swapped(bytes32 orderHash, address maker, address taker, address tokenIn, address tokenOut,
 * uint256 amountIn, uint256 amountOut)` — the router's own fill event, in its own parameter order.
 */
export function swap(
  hashArg: i32,
  makerArg: i32,
  takerArg: i32,
  tokenInArg: i32,
  tokenOutArg: i32,
  amountInArg: i32,
  amountOutArg: i32,
  txArg: i32,
  logIndex: i32,
  blockNumber: i64,
  timestamp: i64
): void {
  let params = eventParams(
    ['orderHash', 'maker', 'taker', 'tokenIn', 'tokenOut', 'amountIn', 'amountOut'],
    [
      ethereum.Value.fromFixedBytes(argBytes(hashArg)),
      ethereum.Value.fromAddress(argAddress(makerArg)),
      ethereum.Value.fromAddress(argAddress(takerArg)),
      ethereum.Value.fromAddress(argAddress(tokenInArg)),
      ethereum.Value.fromAddress(argAddress(tokenOutArg)),
      ethereum.Value.fromUnsignedBigInt(argWord(amountInArg)),
      ethereum.Value.fromUnsignedBigInt(argWord(amountOutArg)),
    ]
  );
  let event = baseEvent(params, logIndex, blockNumber, timestamp, argBytes(txArg));
  handleSwapped(changetype<Swapped>(event));
}
