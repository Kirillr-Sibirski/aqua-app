#!/usr/bin/env node
/**
 * The mapping's decoder, executed.
 *
 * The read layer's whole claim is that the terms of every option written on this router are
 * recoverable from Aqua's log by anyone. Three implementations make that claim in three languages —
 * `contracts/src/SurfaceLens.sol`, `subgraph/src/decode.ts` and `web/src/components/surface/decode.ts`
 * — and a single byte of disagreement between them would put a wrong strike on a screen with no
 * error anywhere. The Solidity one is covered by Foundry and the TypeScript one by vitest. This is
 * the AssemblyScript one.
 *
 * It runs the real thing. `tests/harness.ts` is compiled with exactly the flags `graph build` uses,
 * against the same `@graphprotocol/graph-ts` global, so the WebAssembly under test is the code that
 * ships inside `build/Aqua/Aqua.wasm`. No mock, no transpile-to-TypeScript, no second copy of the
 * offsets. The fixture is `tests/golden.json`: one real `abi.encode(ISwapVM.Order)` payload captured
 * from a Foundry test that shipped it to a live Aqua, and the terms it must decode to.
 *
 *   node tests/decode.test.mjs        (or: npm test)
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmPath = join(root, 'tests/build/harness.wasm');
const golden = JSON.parse(readFileSync(join(root, 'tests/golden.json'), 'utf8'));

// --------------------------------------------------------------------------------------- compile
// The same argument list `@graphprotocol/graph-cli` passes to `asc` in
// `dist/compiler/asc.js::compile`, with the harness as the entry instead of a mapping. If that list
// ever drifts from this one, the thing under test stops being the thing that ships.
mkdirSync(join(root, 'tests/build'), { recursive: true });
execFileSync(
  join(root, 'node_modules/.bin/asc'),
  [
    '--explicitStart',
    '--exportRuntime',
    '--runtime',
    'stub',
    'tests/harness.ts',
    'node_modules/@graphprotocol/graph-ts/global/global.ts',
    '--baseDir',
    '.',
    '--lib',
    'node_modules',
    '--outFile',
    'tests/build/harness.wasm',
    '--optimize',
    '--debug',
  ],
  { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] },
);

// ------------------------------------------------------------------------------------- the host
// graph-node hands a mapping two things: memory and a handful of host functions. Only two of them
// are reachable from the decoder, and neither is faked into returning something convenient.

const STRING_ID = 0; // TypeId.String, from graph-ts/global/global.ts

let exports_;

/** `Uint8Array` and every subclass (`Bytes`, `BigInt`) share this header: buffer, dataStart, length. */
function viewOf(pointer) {
  const memory = new DataView(exports_.memory.buffer);
  const dataStart = memory.getUint32(pointer + 4, true);
  const byteLength = memory.getUint32(pointer + 8, true);
  return new Uint8Array(exports_.memory.buffer, dataStart, byteLength);
}

const hex = (bytes) => `0x${Buffer.from(bytes).toString('hex')}`;

/** `BigInt` is a little-endian magnitude, exactly as graph-node reads it. */
function bigIntOf(pointer) {
  const bytes = viewOf(pointer);
  let value = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) value = (value << 8n) | BigInt(bytes[i]);
  return value;
}

/** Copy a payload into the module's own memory through its allocator. */
function load(bytes) {
  const pointer = exports_.alloc(bytes.length);
  viewOf(pointer).set(bytes);
}

const imports = {
  env: {
    abort(messagePointer, filePointer, line, column) {
      throw new Error(`wasm abort at ${line}:${column}`);
    },
  },
  conversion: {
    // The one host conversion the decoder can reach. Implemented rather than stubbed: a stub that
    // returns a constant would let a test pass on a decoder that hexed the wrong bytes.
    'typeConversion.bytesToHex'(pointer) {
      const string = hex(viewOf(pointer));
      const out = exports_.__new(string.length * 2, STRING_ID);
      const memory = new DataView(exports_.memory.buffer);
      for (let i = 0; i < string.length; i++) memory.setUint16(out + i * 2, string.charCodeAt(i), true);
      return out;
    },
  },
};

const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), imports);
exports_ = instance.exports;
exports_._start(); // --explicitStart: graph-node calls this before the first handler too.

const OK = exports_.OK.value;
const NOT_AN_ORDER = exports_.NOT_AN_ORDER.value;
const NOT_A_LEG = exports_.NOT_A_LEG.value;

const bytesOf = (string) => Buffer.from(string.replace(/^0x/, ''), 'hex');
const expected = golden.expected;

// ----------------------------------------------------------------------------------------- tests

test('decodes a real Shipped payload into the option its maker wrote', () => {
  load(bytesOf(golden.strategy));
  assert.equal(exports_.run(), OK, 'the shipped bytes decode to a Strikeline leg');

  assert.equal(bigIntOf(exports_.strikeWad()), BigInt(expected.strikeWad), 'K');
  assert.equal(bigIntOf(exports_.sigmaWad()), BigInt(expected.sigmaWad), 'sigma');
  assert.equal(bigIntOf(exports_.maturity()), BigInt(expected.maturity), 'maturity');
  assert.equal(bigIntOf(exports_.liquidityWad()), BigInt(expected.liquidityWad), 'L');
  assert.equal(bigIntOf(exports_.rateRisky()), BigInt(expected.rateRisky), 'rateRisky');
  assert.equal(bigIntOf(exports_.rateStable()), BigInt(expected.rateStable), 'rateStable');
});

test('recovers the identity and the pair from the ABI envelope', () => {
  load(bytesOf(golden.strategy));
  assert.equal(exports_.run(), OK);

  assert.equal(hex(viewOf(exports_.maker())), expected.maker, 'maker');
  assert.equal(hex(viewOf(exports_.tokenA())), expected.tokenA, 'tokenA');
  assert.equal(hex(viewOf(exports_.tokenB())), expected.tokenB, 'tokenB');
  // The program slice is found through the traits offset word, not by assuming 40 bytes of tokens.
  assert.equal(hex(viewOf(exports_.program())), expected.program, 'the SwapVM program');
});

test('reads the flags the surface renders: which side is risky, and whether Coverage margins it', () => {
  load(bytesOf(golden.strategy));
  assert.equal(exports_.run(), OK);

  assert.equal(exports_.flags(), expected.flags, 'flags byte');
  assert.equal(Boolean(exports_.riskyIsTokenA()), expected.riskyIsTokenA, 'riskyIsTokenA');
  assert.equal(Boolean(exports_.guarded()), expected.guarded, 'guarded');
});

test('an option written without the Coverage wrapper decodes, and says its depth is unmargined', () => {
  load(bytesOf(golden.unguarded.program));
  assert.equal(exports_.runProgram(), OK, golden.unguarded.why);

  assert.equal(bigIntOf(exports_.strikeWad()), BigInt(expected.strikeWad), 'same strike');
  assert.equal(bigIntOf(exports_.sigmaWad()), BigInt(expected.sigmaWad), 'same vol');
  assert.equal(Boolean(exports_.guarded()), false, 'no Coverage instruction in the stream');
});

test('declines rather than guessing, on every program that is not a leg', () => {
  for (const { why, program } of golden.declines) {
    load(bytesOf(program));
    assert.equal(exports_.runProgram(), NOT_A_LEG, why);
  }
});

test('declines a payload that is not an abi.encode(Order) at all', () => {
  // A length word of 2^256-1 is what a hostile log looks like: the decoder has to bound-check it
  // rather than trap, because a trap in a mapping kills the whole subgraph, not one entry.
  const hostile = Buffer.concat([
    bytesOf(`0x${'00'.repeat(31)}20`),
    bytesOf(`0x${'00'.repeat(32)}`),
    bytesOf(`0x${'00'.repeat(32)}`),
    bytesOf(`0x${'ff'.repeat(32)}`),
    bytesOf(`0x${'00'.repeat(64)}`),
  ]);
  load(hostile);
  assert.equal(exports_.run(), NOT_AN_ORDER, 'an out-of-range data offset is refused');

  load(bytesOf('0x1234'));
  assert.equal(exports_.run(), NOT_AN_ORDER, 'a payload too short to be an order is refused');
});

test('the golden vector is the same one the TypeScript decoder is pinned to', () => {
  const web = readFileSync(
    join(root, '../web/src/components/surface/__tests__/decode.test.ts'),
    'utf8',
  );
  assert.ok(
    web.includes(golden.strategy),
    'web/src/components/surface/__tests__/decode.test.ts must read these exact bytes',
  );
});
