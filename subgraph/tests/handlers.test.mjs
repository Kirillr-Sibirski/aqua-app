/**
 * The mappings, run over a whole event sequence.
 *
 * `tests/decode.test.mjs` proves the bytes decode. This proves the entity graph a query is served
 * from: two makers writing the same option, the surface cell that relates them, a fill that walks
 * the reserves, and a dock that takes one of the quotes off the book. The handlers are the real
 * ones, compiled the way `graph build` compiles them; only the host is Node's (see `tests/wasm.mjs`
 * for exactly what that does and does not model).
 *
 * The event order is Aqua's own: `Aqua.ship` emits `Shipped` and then one `Pushed` per token
 * (`node_modules/@1inch/aqua/src/Aqua.sol:45-51`), which is why the mapping can attach opening
 * reserves to a leg it has only just created.
 *
 * The second and third legs are the golden payload with individual fields patched — a different
 * maker, a wider vol, a different strike. Every patch is verified by the decode it produces, so a
 * wrong offset here fails rather than quietly testing the wrong option.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { hexBytes, load, word } from './wasm.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const golden = JSON.parse(readFileSync(join(root, 'tests/golden.json'), 'utf8'));

const WAD = 10n ** 18n;

// The router the manifest names. Everything shipped to any other app is not ours to index.
const ROUTER = '0xa0cb889707d426a7a386870a03bc70d1b0697598';
const OTHER_APP = '0x1111111254eeb25477b68fb85ed929f73a960582';
const WETH = golden.expected.tokenA;
const USDC = golden.expected.tokenB;
const MAKER_A = golden.expected.maker;
const MAKER_B = '0x7c8ba2f1b0b8a2c8b1b1f0e9d5a4c3b2a1908f7e';
const MAKER_C = '0x2d4f7b1c9e0a8d3f6b5c4e2a1908f7e6d5c4b3a2';
const TAKER = '0x3f8cb69d9c0eb0c4d0a1f2b3c4d5e6f708192a3b';

// Offsets into the shipped payload. `programAt` is found rather than assumed; the RmmSwap arguments
// start two bytes into the instruction, after `Deadline` (7 bytes) and `Coverage` (5).
const strategyBytes = hexBytes(golden.strategy);
const programAt = indexOf(strategyBytes, hexBytes(golden.expected.program));
const MAKER_AT = 0x2c;
const RMM_ARGS = programAt + 12 + 2;
const SIGMA_AT = RMM_ARGS + 1;
const STRIKE_AT = RMM_ARGS + 14;
const SALT_AT = programAt + 78;

const { wasm, arg, resetArgs, entity, entities } = await load({ router: ROUTER });

// ------------------------------------------------------------------------------ the event stream

const T0 = 1_760_000_000;
const legA = golden.strategyHash;
const legB = `0x${'b1'.repeat(32)}`;
const legC = `0x${'c1'.repeat(32)}`;
const legD = `0x${'d1'.repeat(32)}`;
const legX = `0x${'ee'.repeat(32)}`;
const foreign = `0x${'fa'.repeat(32)}`;

/** The golden leg, exactly as Foundry shipped it: maker A, K 2,600, 60% vol, L 12. */
const strategyA = strategyBytes;

// Three makers write the 2,800 call: B at 72%, C at 68%, A at 60%. B withdraws before the end, so
// the best bid a taker can actually reach is C's. That is the query this whole layer exists for.

/** Maker B, one strike up from the golden leg, quoting the widest vol - until it docks. */
const strategyB = patch(strategyA, [
  [MAKER_AT, hexBytes(MAKER_B)],
  [SIGMA_AT, beBytes((72n * WAD) / 100n, 8)],
  [STRIKE_AT, beBytes(2800n * WAD, 16)],
  [SALT_AT, beBytes(2n, 8)],
]);

/** Maker C, same option, quoting between the other two, and still standing at the end. */
const strategyD = patch(strategyA, [
  [MAKER_AT, hexBytes(MAKER_C)],
  [SIGMA_AT, beBytes((68n * WAD) / 100n, 8)],
  [STRIKE_AT, beBytes(2800n * WAD, 16)],
  [SALT_AT, beBytes(4n, 8)],
]);

/** Maker A again, same option as B and C, at the vol the golden leg was written with. */
const strategyC = patch(strategyA, [
  [STRIKE_AT, beBytes(2800n * WAD, 16)],
  [SALT_AT, beBytes(3n, 8)],
]);

/** A well-formed strategy with no RmmSwap: `0x55` becomes `0x50`, an ordinary XYC pool. */
const strategyForeign = patch(strategyA, [[programAt + 12, Uint8Array.from([0x50])]]);

ship(MAKER_A, ROUTER, legA, strategyA, 100, T0);
push(MAKER_A, ROUTER, legA, WETH, 8_410_000_000_000_000_000n, 100, T0);
push(MAKER_A, ROUTER, legA, USDC, 8_454_182_435n, 100, T0);

ship(MAKER_B, ROUTER, legB, strategyB, 101, T0 + 40);
push(MAKER_B, ROUTER, legB, WETH, 6_180_000_000_000_000_000n, 101, T0 + 40);

ship(MAKER_C, ROUTER, legD, strategyD, 102, T0 + 80);
push(MAKER_C, ROUTER, legD, WETH, 7_040_000_000_000_000_000n, 102, T0 + 80);

ship(MAKER_A, ROUTER, legC, strategyC, 102, T0 + 90);
push(MAKER_A, ROUTER, legC, WETH, 9_220_000_000_000_000_000n, 102, T0 + 90);

// Shipped to some other app on the same registry, and a strategy that is not an option at all.
ship(MAKER_B, OTHER_APP, legX, strategyA, 103, T0 + 120);
ship(MAKER_A, ROUTER, foreign, strategyForeign, 103, T0 + 120);

// A taker crosses maker A's 2,600 quote: 7,101.44 USDC in, 2.7 WETH out.
const AMOUNT_IN = 7_101_440_000n;
const AMOUNT_OUT = 2_700_000_000_000_000_000n;
pull(MAKER_A, ROUTER, legA, WETH, AMOUNT_OUT, 104, T0 + 3_600);
push(MAKER_A, ROUTER, legA, USDC, AMOUNT_IN, 104, T0 + 3_600);
swap(legA, MAKER_A, TAKER, USDC, WETH, AMOUNT_IN, AMOUNT_OUT, 104, T0 + 3_600);
// A fill against a strategy that is not a leg of ours. Ignored, not invented.
swap(legX, MAKER_B, TAKER, USDC, WETH, AMOUNT_IN, AMOUNT_OUT, 104, T0 + 3_600);

// Maker B withdraws. `dock` is unconditional and instant, and it moves no tokens.
dock(MAKER_B, ROUTER, legB, 105, T0 + 7_200);

// ------------------------------------------------------------------------------------- the tests

test('a Shipped event becomes an option, with the terms the maker wrote in it', () => {
  const leg = entity('Leg', legA);
  assert.ok(leg, 'the golden strategy was indexed');

  assert.equal(leg.maker, MAKER_A);
  assert.equal(leg.app, ROUTER);
  assert.equal(leg.strikeWad, BigInt(golden.expected.strikeWad));
  assert.equal(leg.sigmaWad, BigInt(golden.expected.sigmaWad));
  assert.equal(leg.maturity, BigInt(golden.expected.maturity));
  assert.equal(leg.liquidityWad, BigInt(golden.expected.liquidityWad));
  assert.equal(leg.rateRisky, BigInt(golden.expected.rateRisky));
  assert.equal(leg.rateStable, BigInt(golden.expected.rateStable));
  assert.equal(leg.tokenRisky, WETH, 'the flag names the risky side, not a token list');
  assert.equal(leg.tokenStable, USDC);
  assert.equal(leg.riskyIsTokenA, true);
  assert.equal(leg.guarded, true, 'the program carries the Coverage wrapper');
  assert.equal(leg.docked, false);
  assert.equal(leg.shippedAt, BigInt(T0));
  assert.equal(leg.shippedAtBlock, 100n);
  // The bytes are kept verbatim, so nothing above has to be taken on trust.
  assert.equal(leg.strategy, golden.strategy);
  assert.equal(leg.program, golden.expected.program);
});

test('reserves are walked by Aqua’s own Pushed and Pulled, never by the fill', () => {
  const leg = entity('Leg', legA);
  // 8.41 shipped, 2.7 pulled by the taker.
  assert.equal(leg.reserveRisky, 8_410_000_000_000_000_000n - AMOUNT_OUT);
  assert.equal(leg.reserveStable, 8_454_182_435n + AMOUNT_IN);
});

test('the fill joins its leg by orderHash, and is counted once', () => {
  const fills = entities('Fill');
  assert.equal(fills.size, 1, 'the Swapped against a strategy we do not index was ignored');

  const [id, fill] = [...fills.entries()][0];
  assert.equal(fill.leg, legA);
  assert.equal(fill.maker, MAKER_A);
  assert.equal(fill.taker, TAKER);
  assert.equal(fill.amountIn, AMOUNT_IN);
  assert.equal(fill.amountOut, AMOUNT_OUT);
  assert.equal(id, `${fill.transactionHash}-${fill.logIndex}`, 'txHash-logIndex is the identity');

  const leg = entity('Leg', legA);
  assert.equal(leg.fillCount, 1);
  assert.equal(leg.volumeIn, AMOUNT_IN);
  assert.equal(leg.volumeOut, AMOUNT_OUT);
});

test('every maker who wrote the same option lands in one cell of the surface', () => {
  const point = entity('SurfacePoint', pointId(2800n * WAD));
  assert.ok(point, 'the 2,800 / 7-day cell exists');
  assert.equal(point.legCount, 3, 'three makers wrote the same option');
  assert.deepEqual(point.legIds, [legB, legD, legC], 'in the order they shipped');
  assert.equal(point.strikeWad, 2800n * WAD);
});

test('the cell knows the best bid, which is the widest live vol at that strike and expiry', () => {
  // Three quotes on the 2,800 call: A at 60%, C at 68%, B at 72% until B withdrew. The widest live
  // vol is the maker paying the most for the wait, so it is the one a taker should be shown.
  assert.equal(entity('Leg', legB).sigmaWad, (72n * WAD) / 100n, 'the patched vol decoded as written');
  assert.equal(entity('Leg', legD).sigmaWad, (68n * WAD) / 100n);
  assert.equal(entity('Leg', legD).maker, MAKER_C);
  assert.equal(entity('Leg', legD).strikeWad, 2800n * WAD, 'the patched strike decoded as written');

  const point = entity('SurfacePoint', pointId(2800n * WAD));
  assert.equal(point.liveLegCount, 2, 'B withdrew; A and C are still quoting');
  assert.equal(point.bestLeg, legD, 'the widest vol still live');
  assert.equal(point.maxSigmaWad, (68n * WAD) / 100n);
  assert.equal(point.minSigmaWad, BigInt(golden.expected.sigmaWad), 'A, the tightest of the three');
  assert.equal(point.liveLiquidityWad, 24n * WAD, 'size written at this point across all makers');
});

test('a dock takes the quote off the book without moving a token', () => {
  const leg = entity('Leg', legB);
  assert.equal(leg.docked, true);
  assert.equal(leg.dockedAt, BigInt(T0 + 7_200));
  // Aqua zeroes every balance in `dock`, so the index does too rather than keeping a stale depth.
  assert.equal(leg.reserveRisky, 0n);
  assert.equal(leg.reserveStable, 0n);

  const maker = entity('Maker', MAKER_B);
  assert.equal(maker.legsShipped, 1, 'the record keeps it');
  assert.equal(maker.legsLive, 0, 'the book does not');
});

test('a different strike is a different cell, not a competing quote', () => {
  const point = entity('SurfacePoint', pointId(BigInt(golden.expected.strikeWad)));
  assert.ok(point, 'the golden leg is on the 2,600 cell, alone');
  assert.equal(point.legCount, 1);
  assert.equal(point.bestLeg, legA);
  assert.equal(point.maxSigmaWad, BigInt(golden.expected.sigmaWad));
});

test('the app filter keeps another app’s strategies out, since Aqua indexes no parameters', () => {
  assert.equal(entity('Leg', legX), undefined, 'shipped to a different app on the same registry');
  const makers = entities('Maker');
  assert.deepEqual([...makers.keys()].sort(), [MAKER_A, MAKER_B, MAKER_C].sort());
});

test('a strategy that is not an option is skipped, not guessed at', () => {
  assert.equal(entity('Leg', foreign), undefined, 'an XYC pool is a valid strategy and not a leg');
  assert.equal(entities('Leg').size, 4, 'four legs indexed, from five Shipped events on our app');
});

test('a maker’s counters are the ones a portfolio view would read', () => {
  const maker = entity('Maker', MAKER_A);
  assert.equal(maker.legsShipped, 2, 'the foreign strategy did not count as an option');
  assert.equal(maker.legsLive, 2);
  assert.equal(maker.fillCount, 1);
  assert.equal(maker.firstSeenAt, BigInt(T0));
  assert.equal(maker.lastSeenAt, BigInt(T0 + 3_600));
});

/**
 * The query the read layer exists for, answered from the entities the mappings just produced.
 *
 * Written to `tests/build/surface.query.json` so the response in `README.md` is a transcript rather
 * than an illustration. The field selection is the one in the README; the shaping a GraphQL server
 * would do — following `bestLeg`, ordering, naming — is done here by hand, and nothing is computed
 * that the mapping did not already store.
 */
test('the best-bid query has an answer, and it is the one the README prints', () => {
  const points = [...entities('SurfacePoint').values()]
    .filter((point) => point.liveLegCount > 0)
    .sort((a, b) => Number(a.strikeWad - b.strikeWad));

  const response = {
    data: {
      surfacePoints: points.map((point) => {
        const best = entity('Leg', point.bestLeg);
        return {
          strikeWad: point.strikeWad.toString(),
          maturity: point.maturity.toString(),
          liveLegCount: point.liveLegCount,
          maxSigmaWad: point.maxSigmaWad.toString(),
          liveLiquidityWad: point.liveLiquidityWad.toString(),
          bestLeg: {
            id: best.id,
            maker: { id: best.maker },
            sigmaWad: best.sigmaWad.toString(),
            liquidityWad: best.liquidityWad.toString(),
            reserveRisky: best.reserveRisky.toString(),
            guarded: best.guarded,
          },
        };
      }),
    },
  };

  assert.equal(response.data.surfacePoints.length, 2, 'two live cells: the 2,600 and the 2,800');
  assert.equal(response.data.surfacePoints[0].bestLeg.maker.id, MAKER_A, 'alone on the 2,600');
  assert.equal(response.data.surfacePoints[1].bestLeg.maker.id, MAKER_C, 'the widest live vol at 2,800');
  writeFileSync(join(root, 'tests/build/surface.query.json'), `${JSON.stringify(response, null, 2)}\n`);
});

// --------------------------------------------------------------------------------------- helpers

/** The id the mapping gives a cell of the surface: pair, then strike, then expiry. */
function pointId(strikeWad) {
  return `${WETH}-${USDC}-${strikeWad}-${golden.expected.maturity}`;
}

function ship(maker, app, hash, strategy, block, timestamp) {
  resetArgs();
  wasm.ship(
    arg(hexBytes(maker)),
    arg(hexBytes(app)),
    arg(hexBytes(hash)),
    arg(strategy),
    arg(hexBytes(`0x${block.toString(16).padStart(64, '0')}`)),
    0,
    BigInt(block),
    BigInt(timestamp),
  );
}

function dock(maker, app, hash, block, timestamp) {
  resetArgs();
  wasm.dock(
    arg(hexBytes(maker)),
    arg(hexBytes(app)),
    arg(hexBytes(hash)),
    arg(hexBytes(`0x${block.toString(16).padStart(64, '0')}`)),
    0,
    BigInt(block),
    BigInt(timestamp),
  );
}

function balance(fn, maker, app, hash, token, amount, block, timestamp) {
  resetArgs();
  fn(
    arg(hexBytes(maker)),
    arg(hexBytes(app)),
    arg(hexBytes(hash)),
    arg(hexBytes(token)),
    arg(word(amount)),
    arg(hexBytes(`0x${block.toString(16).padStart(64, '0')}`)),
    0,
    BigInt(block),
    BigInt(timestamp),
  );
}

function push(...args) {
  balance(wasm.push, ...args);
}

function pull(...args) {
  balance(wasm.pull, ...args);
}

function swap(hash, maker, taker, tokenIn, tokenOut, amountIn, amountOut, block, timestamp) {
  resetArgs();
  wasm.swap(
    arg(hexBytes(hash)),
    arg(hexBytes(maker)),
    arg(hexBytes(taker)),
    arg(hexBytes(tokenIn)),
    arg(hexBytes(tokenOut)),
    arg(word(amountIn)),
    arg(word(amountOut)),
    arg(hexBytes(`0x${block.toString(16).padStart(64, '0')}`)),
    3,
    BigInt(block),
    BigInt(timestamp),
  );
}

/** A copy of `bytes` with each patch written at its offset. */
function patch(bytes, patches) {
  const out = Uint8Array.from(bytes);
  for (const [offset, value] of patches) out.set(value, offset);
  return out;
}

/** `value` as `length` big-endian bytes, the way the instruction encodes its arguments. */
function beBytes(value, length) {
  const out = new Uint8Array(length);
  let remaining = value;
  for (let i = length - 1; i >= 0 && remaining > 0n; i--) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

function indexOf(haystack, needle) {
  const at = Buffer.from(haystack).indexOf(Buffer.from(needle));
  assert.notEqual(at, -1, 'the fixture’s program must be a slice of its strategy');
  return at;
}
