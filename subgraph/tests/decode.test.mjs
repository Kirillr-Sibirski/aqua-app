/**
 * The mapping's decoder, executed.
 *
 * The read layer's whole claim is that the terms of every option written on this router are
 * recoverable from Aqua's log by anyone. Three implementations make that claim in three languages —
 * `contracts/src/SurfaceLens.sol`, `subgraph/src/decode.ts` and `web/src/components/surface/decode.ts`
 * — and a single byte of disagreement between them would put a wrong strike on a screen with no
 * error anywhere. The Solidity one is covered by Foundry and the TypeScript one by vitest. This is
 * the AssemblyScript one, and it runs the same WebAssembly that ships in `build/Aqua/Aqua.wasm`.
 *
 * The fixture is `tests/golden.json`: one real `abi.encode(ISwapVM.Order)` payload captured from a
 * Foundry test that shipped it to a live Aqua, and the terms it must decode to.
 *
 *   node --test tests/           (or: npm test)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { hex, hexBytes, load } from './wasm.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const golden = JSON.parse(readFileSync(join(root, 'tests/golden.json'), 'utf8'));
const expected = golden.expected;

const { wasm, viewOf, bigIntAt } = await load();
const OK = wasm.OK.value;
const NOT_AN_ORDER = wasm.NOT_AN_ORDER.value;
const NOT_A_LEG = wasm.NOT_A_LEG.value;

/** Copy a payload into the module's own memory through its allocator. */
function payload(bytes) {
  viewOf(wasm.alloc(bytes.length)).set(bytes);
}

test('decodes a real Shipped payload into the option its maker wrote', () => {
  payload(hexBytes(golden.strategy));
  assert.equal(wasm.run(), OK, 'the shipped bytes decode to a Strikeline leg');

  assert.equal(bigIntAt(wasm.strikeWad()), BigInt(expected.strikeWad), 'K');
  assert.equal(bigIntAt(wasm.sigmaWad()), BigInt(expected.sigmaWad), 'sigma');
  assert.equal(bigIntAt(wasm.maturity()), BigInt(expected.maturity), 'maturity');
  assert.equal(bigIntAt(wasm.liquidityWad()), BigInt(expected.liquidityWad), 'L');
  assert.equal(bigIntAt(wasm.rateRisky()), BigInt(expected.rateRisky), 'rateRisky');
  assert.equal(bigIntAt(wasm.rateStable()), BigInt(expected.rateStable), 'rateStable');
});

test('recovers the identity and the pair from the ABI envelope', () => {
  payload(hexBytes(golden.strategy));
  assert.equal(wasm.run(), OK);

  assert.equal(hex(viewOf(wasm.maker())), expected.maker, 'maker');
  assert.equal(hex(viewOf(wasm.tokenA())), expected.tokenA, 'tokenA');
  assert.equal(hex(viewOf(wasm.tokenB())), expected.tokenB, 'tokenB');
  // The program slice is found through the traits offset word, not by assuming 40 bytes of tokens.
  assert.equal(hex(viewOf(wasm.program())), expected.program, 'the SwapVM program');
});

test('reads the flags the surface renders: which side is risky, and whether Coverage margins it', () => {
  payload(hexBytes(golden.strategy));
  assert.equal(wasm.run(), OK);

  assert.equal(wasm.flags(), expected.flags, 'flags byte');
  assert.equal(Boolean(wasm.riskyIsTokenA()), expected.riskyIsTokenA, 'riskyIsTokenA');
  assert.equal(Boolean(wasm.guarded()), expected.guarded, 'guarded');
});

test('an option written without the Coverage wrapper decodes, and says its depth is unmargined', () => {
  payload(hexBytes(golden.unguarded.program));
  assert.equal(wasm.runProgram(), OK, golden.unguarded.why);

  assert.equal(bigIntAt(wasm.strikeWad()), BigInt(expected.strikeWad), 'same strike');
  assert.equal(bigIntAt(wasm.sigmaWad()), BigInt(expected.sigmaWad), 'same vol');
  assert.equal(Boolean(wasm.guarded()), false, 'no Coverage instruction in the stream');
});

test('declines rather than guessing, on every program that is not a leg', () => {
  for (const { why, program } of golden.declines) {
    payload(hexBytes(program));
    assert.equal(wasm.runProgram(), NOT_A_LEG, why);
  }
});

test('declines a payload that is not an abi.encode(Order) at all', () => {
  // A length word of 2^256-1 is what a hostile log looks like: the decoder has to bound-check it
  // rather than trap, because a trap in a mapping kills the whole subgraph, not one entry.
  payload(
    hexBytes(`0x${'00'.repeat(31)}20${'00'.repeat(32)}${'00'.repeat(32)}${'ff'.repeat(32)}${'00'.repeat(64)}`),
  );
  assert.equal(wasm.run(), NOT_AN_ORDER, 'an out-of-range data offset is refused');

  payload(hexBytes('0x1234'));
  assert.equal(wasm.run(), NOT_AN_ORDER, 'a payload too short to be an order is refused');
});

