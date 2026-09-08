/**
 * The browser's decoder, pinned to Solidity.
 *
 * Three implementations read the same bytes: `contracts/src/SurfaceLens.sol`,
 * `subgraph/src/decode.ts` and this one. A one-byte disagreement between them would put a wrong
 * strike on screen with no error anywhere, so the golden vector below is the exact
 * `abi.encode(order)` a Foundry test shipped to a live Aqua — printed by
 * `contracts/test/surface/SurfaceLens.t.sol::test_Decode_RecoversTheTermsFromTheShippedBytes`,
 * whose assertions fix every field it decodes to.
 *
 * Regenerate: `forge test --match-test test_Decode_RecoversTheTermsFromTheShippedBytes -vv`
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { keccak256, type Address, type Hex } from 'viem';
import { decodeStrategyBytes, type ShippedStrategy } from '@/lib/contracts';
import { decodeOrder, orderHashAqua } from '@/lib/swapvm';
import { censusOf, decodeSurface, decodeSurfaceLeg, deltaOf, groupSurface, impliedSpot, pointKey } from '../decode';
import { surfaceLensAbi } from '../lens';
import { SURFACE_LENS_BYTECODE } from '../lensBytecode';
import type { SurfaceLeg } from '../types';

/** A 2,600 strike, 60% vol, 7-day covered call on WETH/USDC, exactly as it was shipped. */
const GOLDEN: Hex =
  '0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e05fcc23807536bee418f142d19fa0d21bb0cff740000000002800280028002800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000007e2e234dae75c793f67a35089c9d99245e1c58470bf62849f9a0b5bf2913b396098f7c7019b51a820a200500000941899303000000553e070853a0d2313c00000000093a81000000000000008cf23f909c0fa000000000000000000000a688906bd8b000000000000000000001000000e8d4a51000020800000000000000010000';

const MAKER = '0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7' as Address;
const WETH = '0x2e234DAe75C793f67A35089C9d99245E1C58470b' as Address;
const USDC = '0xF62849F9A0B5Bf2913b396098F7c7019b51A820a' as Address;
const ROUTER = '0xa0Cb889707d426A7A386870A03bc70d1b0697598' as Address;

const WAD = BigInt(10) ** BigInt(18);

/** Rebuild the `ShippedStrategy` the log reader would hand us, from the shipped bytes alone. */
function shipped(
  strategy: Hex,
  overrides: Partial<Pick<ShippedStrategy, 'balances' | 'docked' | 'maker'>> = {},
): ShippedStrategy {
  const order = decodeStrategyBytes(strategy);
  const decoded = decodeOrder(order);
  const tokens: [Address, Address] = [decoded.tokenA as Address, decoded.tokenB as Address];
  return {
    strategyHash: keccak256(strategy),
    maker: overrides.maker ?? (order.maker as Address),
    app: ROUTER,
    strategy,
    order,
    decoded,
    tokens,
    program: decoded.program,
    hashMatches: orderHashAqua(order) === keccak256(strategy),
    blockNumber: BigInt(50_946_001),
    transactionHash: `0x${'11'.repeat(32)}` as Hex,
    logIndex: 0,
    balances: overrides.balances ?? [
      { token: tokens[0], balance: BigInt('8410000000000000000'), tokensCount: 2 },
      { token: tokens[1], balance: BigInt('8454182435'), tokensCount: 2 },
    ],
    docked: overrides.docked ?? false,
    active: !(overrides.docked ?? false),
  };
}

describe('decodeSurfaceLeg, against the Solidity golden vector', () => {
  const { leg } = decodeSurfaceLeg(shipped(GOLDEN), true);

  it('recovers the identity Aqua stores', () => {
    expect(leg).not.toBeNull();
    expect(leg!.strategyHash).toBe(keccak256(GOLDEN));
    expect(leg!.maker).toBe(MAKER);
  });

  it('recovers the terms of the option from the program bytes', () => {
    expect(leg!.strikeWad).toBe(BigInt(2600) * WAD);
    expect(leg!.sigmaWad).toBe(BigInt(6) * WAD / BigInt(10));
    expect(leg!.liquidityWad).toBe(BigInt(12) * WAD);
    expect(leg!.maturity).toBe(604_801);
    expect(leg!.rateRisky).toBe(BigInt(1));
    expect(leg!.rateStable).toBe(BigInt(10) ** BigInt(12));
  });

  // The tokens arrive lowercase from `decodeOrder`, which slices them out of `order.data`; the
  // decoder is expected to checksum them rather than pass them through.
  it('names the risky and stable sides from the flag, not from a token list', () => {
    expect(leg!.riskyIsTokenA).toBe(true);
    expect(leg!.tokenRisky).toBe(WETH);
    expect(leg!.tokenStable).toBe(USDC);
  });

  it('sees the Coverage wrapper, so the surface can say whether the depth is margined', () => {
    expect(leg!.guarded).toBe(true);
  });

  it('matches the reserves Aqua reports to the sides the curve names', () => {
    expect(leg!.reserveRisky).toBe(BigInt('8410000000000000000'));
    expect(leg!.reserveStable).toBe(BigInt('8454182435'));
  });

  it('reads delta straight off the reserve: X/L, no model', () => {
    // 8.41 / 12 = 0.7008333…, the same figure SurfaceLens returns as deltaWad.
    expect(deltaOf(leg!)).toBeCloseTo(0.700833333, 9);
  });
});

describe('decodeSurfaceLeg, on input it should decline', () => {
  it('declines a strategy with no RmmSwap instruction', () => {
    // The same order shape with an XYCSwap program: `[0x50][0x00]` then `Salt(1)`.
    const xyc = shipped(GOLDEN);
    const { leg, reason } = decodeSurfaceLeg({ ...xyc, program: '0x5000020800000000000000001' as Hex }, false);
    expect(leg).toBeNull();
    expect(reason).toBe('malformed');
  });

  it('declines a truncated instruction stream rather than half-reading it', () => {
    const truncated = shipped(GOLDEN);
    const { leg, reason } = decodeSurfaceLeg({ ...truncated, program: '0x553e' as Hex }, false);
    expect(leg).toBeNull();
    expect(reason).toBe('malformed');
  });

  it('declines a plain XYC pool, which is a valid strategy and not an option', () => {
    const pool = shipped(GOLDEN);
    const { leg, reason } = decodeSurfaceLeg({ ...pool, program: '0x5000' as Hex }, false);
    expect(leg).toBeNull();
    expect(reason).toBe('no-rmm');
  });

  it('counts what it skipped instead of hiding it', () => {
    const good = shipped(GOLDEN);
    const bad = { ...shipped(GOLDEN), program: '0x5000' as Hex };
    const { legs, skipped } = decodeSurface([good, bad], undefined);
    expect(legs).toHaveLength(1);
    expect(skipped['no-rmm']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The surface itself
// ---------------------------------------------------------------------------

function leg(overrides: Partial<SurfaceLeg>): SurfaceLeg {
  return {
    strategyHash: `0x${'ab'.repeat(32)}` as Hex,
    maker: MAKER,
    app: ROUTER,
    tokenRisky: WETH,
    tokenStable: USDC,
    riskyIsTokenA: true,
    strikeWad: BigInt(2800) * WAD,
    sigmaWad: BigInt(6) * WAD / BigInt(10),
    maturity: 604_801,
    liquidityWad: BigInt(10) * WAD,
    rateRisky: BigInt(1),
    rateStable: BigInt(10) ** BigInt(12),
    flags: 0b111,
    guarded: true,
    reserveRisky: BigInt('9220000000000000000'),
    reserveStable: BigInt('1864000000'),
    docked: false,
    shippedAtBlock: BigInt(1),
    mine: false,
    ...overrides,
  };
}

describe('groupSurface', () => {
  it('puts two makers at the same strike and expiry in one cell, best bid first', () => {
    const mine = leg({ strategyHash: '0x01' as Hex, mine: true });
    const wider = leg({
      strategyHash: '0x02' as Hex,
      maker: '0x000000000000000000000000000000000000dEaD' as Address,
      sigmaWad: BigInt(8) * WAD / BigInt(10),
    });
    const [point, ...rest] = groupSurface([mine, wider]);

    expect(rest).toHaveLength(0);
    expect(point.key).toBe(pointKey(BigInt(2800) * WAD, 604_801));
    expect(point.liveLegs).toHaveLength(2);
    // The widest vol is the maker paying the most theta, so it ranks first.
    expect(point.liveLegs[0].sigmaWad).toBe(BigInt(8) * WAD / BigInt(10));
    expect(point.maxSigmaWad).toBe(BigInt(8) * WAD / BigInt(10));
    expect(point.minSigmaWad).toBe(BigInt(6) * WAD / BigInt(10));
    expect(point.liveLiquidityWad).toBe(BigInt(20) * WAD);
    expect(point.mine).toBe(true);
  });

  it('keeps a docked leg on the record but out of the live quote', () => {
    const [point] = groupSurface([leg({ strategyHash: '0x01' as Hex, docked: true })]);
    expect(point.legs).toHaveLength(1);
    expect(point.liveLegs).toHaveLength(0);
    expect(point.maxSigmaWad).toBe(BigInt(0));
  });

  it('separates two expiries at one strike into two cells: that is the term structure', () => {
    const near = leg({ strategyHash: '0x01' as Hex });
    const far = leg({ strategyHash: '0x02' as Hex, maturity: 604_801 + 14 * 86_400 });
    const points = groupSurface([far, near]);
    expect(points).toHaveLength(2);
    expect(points[0].maturity).toBeLessThan(points[1].maturity);
  });
});

describe('censusOf', () => {
  it('counts live quotes, makers and notional, and never counts a docked leg as live', () => {
    const census = censusOf(
      [
        leg({ strategyHash: '0x01' as Hex }),
        leg({ strategyHash: '0x02' as Hex, maker: '0x000000000000000000000000000000000000dEaD' as Address }),
        leg({ strategyHash: '0x03' as Hex, docked: true }),
        leg({ strategyHash: '0x04' as Hex, guarded: false, strikeWad: BigInt(3000) * WAD }),
      ],
      2,
    );
    expect(census.legs).toBe(4);
    expect(census.liveLegs).toBe(3);
    expect(census.makers).toBe(2);
    expect(census.strikes).toBe(2);
    expect(census.expiries).toBe(1);
    expect(census.writtenWad).toBe(BigInt(30) * WAD);
    expect(census.guarded).toBe(2);
    expect(census.foreign).toBe(2);
  });
});

describe('impliedSpot', () => {
  const priced = (markWad: bigint, liquidityWad: bigint, hash: string): SurfaceLeg =>
    leg({
      strategyHash: hash as Hex,
      liquidityWad,
      pricing: {
        tauWad: BigInt(0),
        markWad,
        deltaWad: BigInt(0),
        premiumWad: BigInt(0),
        valueWad: BigInt(0),
        minRiskyIn: BigInt(0),
        minStableIn: BigInt(0),
        freeRisky: BigInt(0),
        freeStable: BigInt(0),
        deliverableRisky: BigInt(0),
        deliverableStable: BigInt(0),
        matured: false,
      },
    });

  it('weights each leg’s own mark by its liquidity', () => {
    const spot = impliedSpot([
      priced(BigInt(2400) * WAD, BigInt(30) * WAD, '0x01'),
      priced(BigInt(2500) * WAD, BigInt(10) * WAD, '0x02'),
    ]);
    // (2400*30 + 2500*10) / 40 = 2425
    expect(spot!.markWad).toBe(BigInt(2425) * WAD);
    expect(spot!.spreadWad).toBe(BigInt(100) * WAD);
    expect(spot!.legs).toBe(2);
  });

  it('returns null rather than a zero when nothing has been priced', () => {
    expect(impliedSpot([leg({})])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Drift guards
// ---------------------------------------------------------------------------

const ARTIFACT = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../../contracts/out/SurfaceLens.sol/SurfaceLens.json', import.meta.url)),
    'utf8',
  ),
) as { abi: { type: string; name?: string; inputs?: unknown[]; outputs?: { components?: { name: string; type: string }[] }[] }[]; bytecode: { object: string } };

describe('SurfaceLens, as the app sees it', () => {
  it('has the Leg struct the app decodes, field for field', () => {
    const solidity = ARTIFACT.abi.find((f) => f.type === 'function' && f.name === 'book')!;
    const mine = surfaceLensAbi.find((f) => f.type === 'function' && f.name === 'book')!;
    expect(mine.outputs[0].components.map((c) => [c.name, c.type])).toEqual(
      solidity.outputs![0].components!.map((c) => [c.name, c.type]),
    );
  });

  it('ships the bytecode the contract actually compiles to', () => {
    // Code only. Solc appends a CBOR trailer carrying the IPFS hash of the contract metadata, which
    // hashes the *source text* of every dependency — so a comment edited in `RmmSwap.sol` moves those
    // last bytes while moving nothing that executes. What has to hold is that the init code this app
    // runs deployless is the init code the contract compiles to; that is what this compares.
    expect(codeOf(SURFACE_LENS_BYTECODE)).toBe(codeOf(ARTIFACT.bytecode.object));
  });
});

/**
 * Creation bytecode with the CBOR metadata trailer removed.
 *
 * The trailer is `<cbor…><2-byte big-endian length>` at the very end, per the Solidity encoding of
 * contract metadata. A string that does not carry one is returned whole rather than guessed at.
 */
function codeOf(bytecode: string): string {
  const hex = bytecode.startsWith('0x') ? bytecode.slice(2) : bytecode;
  if (hex.length < 4) return hex;
  const cborLength = parseInt(hex.slice(-4), 16);
  const end = hex.length - 4 - cborLength * 2;
  if (!Number.isFinite(cborLength) || end <= 0) return hex;
  // `a2` opens a 2-entry CBOR map, which is what solc emits (`ipfs`/`bzzr1` + `solc`).
  return hex.slice(end, end + 2) === 'a2' ? hex.slice(0, end) : hex;
}
