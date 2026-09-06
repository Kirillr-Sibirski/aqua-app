/**
 * Byte-for-byte cross-check of the TS encoder against the Solidity libraries.
 *
 * Vectors are produced by contracts/test/encoding/EncodingVectors.t.sol:
 *   cd contracts && forge test --match-path test/encoding/EncodingVectors.t.sol
 * Inputs below mirror that file verbatim.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hexToBigInt, parseUnits, type Address, type Hex } from 'viem';

import * as ix from '../instructions';
import {
  buildOrder,
  decodeOrder,
  encodeStrategyForShip,
  orderHash,
  orderHashAqua,
  orderHashEip712,
  type Order,
  type SwapVMDomain,
} from '../order';
import { buildTakerTraits, decodeTakerTraits, type BuildTakerTraitsArgs } from '../taker';
import * as math from '../math';
import { Opcode } from '../opcodes';
import { customInstruction } from '../instructions';

interface OrderVector {
  maker: Address;
  traits: Hex;
  data: Hex;
  hash: Hex;
  encoded: Hex;
}

interface Vectors {
  meta: { router: Address; chainId: number; name: string; version: string };
  instructions: Record<string, Hex>;
  programs: Record<string, Hex>;
  orders: Record<string, OrderVector>;
  taker: Record<string, Hex>;
  math: Record<string, Hex>;
}

const VECTORS_PATH = fileURLToPath(new URL('../../../../../contracts/test/encoding/vectors.json', import.meta.url));
const vectors: Vectors = JSON.parse(readFileSync(VECTORS_PATH, 'utf8'));

// Fixed addresses, identical to EncodingVectors.t.sol
const TOKEN_A: Address = '0x1111111111111111111111111111111111111111';
const TOKEN_B: Address = '0x2222222222222222222222222222222222222222';
const FEE_RECEIVER_1: Address = '0x3333333333333333333333333333333333333333';
const FEE_RECEIVER_2: Address = '0x4444444444444444444444444444444444444444';
const FEE_PROVIDER: Address = '0x5555555555555555555555555555555555555555';
const WL1: Address = '0x6666666666666666666666666666666666666666';
const WL2: Address = '0x7777777777777777777777777777777777777777';
const WL3: Address = '0x8888888888888888888888888888888888888888';
const MAKER: Address = '0xfeedfacefeedfacefeedfacefeedfacefeedface';
const TAKER: Address = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const RECIPIENT: Address = '0xcafebabecafebabecafebabecafebabecafebabe';
const HOOK_TARGET: Address = '0x1234567890123456789012345678901234567890';
const ORACLE: Address = '0x0123456789abcdef0123456789abcdef01234567';
const EXTRUCTION_TARGET: Address = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

const e18 = (v: string) => parseUnits(v, 18);
const SQRT_MIN = e18('0.5');
const SQRT_MAX = e18('2');

const eqHex = (actual: Hex, expected: Hex) => expect(actual.toLowerCase()).toBe(expected.toLowerCase());

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

const expectedInstructions: Record<string, () => Hex> = {
  stop: () => ix.stop(),
  revertBytes4: () => ix.revert('0xdeadbeef'),
  revertBytes: () => ix.revert('0x0102030405'),
  saltU64: () => ix.salt(BigInt('0x0123456789abcdef')),
  saltBytes: () => ix.salt('0x00112233445566778899'),
  deadline: () => ix.deadline(1_800_000_000),
  jump: () => ix.jump(0x1234),
  jumpIfDirectionTrue: () => ix.jumpIfDirection(true, 0x42),
  jumpIfDirectionFalse: () => ix.jumpIfDirection(false, 0x42),
  jumpIfDirectionTokens: () => ix.jumpIfDirection({ tokenIn: TOKEN_B, tokenOut: TOKEN_A }, 7),
  jumpIfTokenIn: () => ix.jumpIfTokenIn(TOKEN_A, 0xff),
  jumpIfTokenOut: () => ix.jumpIfTokenOut(TOKEN_B, 0xffff),

  onlyTakerTokenBalanceNonZero: () => ix.onlyTakerTokenBalanceNonZero(TOKEN_A),
  onlyTakerTokenBalanceGte: () => ix.onlyTakerTokenBalanceGte(TOKEN_B, BigInt('12345678901234567890123456789')),
  onlyTakerTokenSupplyShareGte: () => ix.onlyTakerTokenSupplyShareGte(TOKEN_A, e18('0.5')),
  onlyTxOriginTokenBalanceNonZero: () => ix.onlyTxOriginTokenBalanceNonZero(TOKEN_B),
  privateOrder: () => ix.privateOrder(TAKER),
  whitelistCoequal: () => ix.whitelistCoequal(0x10, [WL1, WL2, TAKER]),
  whitelistSequential: () => ix.whitelistSequential(1_700_000_000, 0x20, [WL1, WL2, WL3], [100, 200, 300]),

  xycSwap: () => ix.xycSwap(),
  xycConcentrateSwap: () => ix.xycConcentrateSwap(SQRT_MIN, SQRT_MAX),
  limitSwapTrue: () => ix.limitSwap(true),
  limitSwapFalse: () => ix.limitSwap(false),
  limitSwapTokens: () => ix.limitSwap({ tokenIn: TOKEN_A, tokenOut: TOKEN_B }),
  limitSwapFullAmountTrue: () => ix.limitSwapFullAmount(true),
  limitSwapFullAmountFalse: () => ix.limitSwapFullAmount(false),
  peggedSwap: () => ix.peggedSwap({ x0: e18('1000'), y0: e18('1000'), linearWidth: parseUnits('100', 27), rateA: 1, rateB: parseUnits('1', 12) }),
  twapSwap: () =>
    ix.twapSwap({
      balanceIn: e18('1000'),
      balanceOut: e18('2000'),
      startTime: 1_700_000_000,
      duration: 86400,
      priceBumpAfterIlliquidity: e18('1.1'),
      minTradeAmountOut: e18('1'),
    }),

  feeFlatIn: () => ix.feeFlatIn(30_000),
  feeFlatOut: () => ix.feeFlatOut(12_345),
  feeProtocolSimple: () => ix.feeProtocol({ isTokenIn: true, receivers: [{ receiver: FEE_RECEIVER_1, feeBps: 1000 }] }),
  feeProtocolFull: () =>
    ix.feeProtocol({
      isTokenIn: false,
      receivers: [
        { receiver: FEE_RECEIVER_1, feeBps: 1000, surplusBps: 0 },
        { receiver: FEE_RECEIVER_2, feeBps: 0, surplusBps: 500_000 },
      ],
      providers: [{ provider: FEE_PROVIDER, takeFlatFee: true, takeSurplusFee: true }],
      surplusEstimate: parseUnits('987654321', 9),
    }),
  feeProtocolBoth: () =>
    ix.feeProtocol({ isTokenIn: true, receivers: [{ receiver: FEE_RECEIVER_2, feeBps: 2500, surplusBps: 100_000 }], surplusEstimate: 42 }),

  staticBalances: () => ix.staticBalances(e18('100'), e18('200')),
  dynamicBalances: () => ix.dynamicBalances(e18('300'), e18('400')),
  decay: () => ix.decay(3600),
  dutchAuctionBalanceIn: () => ix.dutchAuctionBalanceIn(1_700_000_000, 3600, e18('0.99')),
  dutchAuctionBalanceOut: () => ix.dutchAuctionBalanceOut(1_700_000_001, 7200, e18('0.5')),
  piecewiseLinearScaleBalanceIn: () => ix.piecewiseLinearScaleBalanceIn(1_700_000_000, [600, 1200], [1_000_000, 900_000, 800_000]),
  piecewiseLinearScaleBalanceOut: () => ix.piecewiseLinearScaleBalanceOut(1_700_000_000, [600], [1_000_000, 1_100_000]),

  invalidateBit: () => ix.invalidateBit(0xdeadbeef),
  invalidateTokenIn: () => ix.invalidateTokenIn(),
  invalidateTokenOut: () => ix.invalidateTokenOut(),
  validateSeriesEpoch: () => ix.validateSeriesEpoch(42, 7),
  requireMinRate: () => ix.requireMinRate(e18('1'), e18('2')),
  adjustMinRate: () => ix.adjustMinRate(e18('3'), e18('4')),
  oraclePriceAdjuster: () => ix.oraclePriceAdjuster({ maxPriceDecay: e18('0.05'), maxStaleness: 3600, oracleDecimals: 8, oracleAddress: ORACLE }),
  baseFeeAdjuster: () =>
    ix.baseFeeAdjuster({ baseGasPrice: parseUnits('30', 9), ethPrice: parseUnits('3000', 6), gasAmount: 150_000, maxDecay: e18('0.1') }),
  extruction: () => ix.extruction(EXTRUCTION_TARGET, '0xaabbccdd'),
  patchSwapRegisters: () => ix.patchSwapRegisters({ balanceIn: 1, balanceOut: 2, amountIn: 3, amountOut: 4 }),
  printSwapRegisters: () => ix.printSwapRegisters(),
  printSwapQuery: () => ix.printSwapQuery(),
  printVM: () => ix.printVM(),
  printFreeMemoryPointer: () => ix.printFreeMemoryPointer(),
  printGasLeft: () => ix.printGasLeft(),
  printFee: () => ix.printFee(),
  probeScale: () => ix.probeScale(1_500_000_000),
};

describe('instructions', () => {
  it('covers every Solidity vector', () => {
    expect(Object.keys(expectedInstructions).sort()).toEqual(Object.keys(vectors.instructions).sort());
  });

  for (const [name, build] of Object.entries(expectedInstructions)) {
    it(`${name} matches Solidity build()`, () => {
      eqHex(build(), vectors.instructions[name]);
    });
  }

  it('customInstruction reproduces ProbeScale', () => {
    eqHex(customInstruction(Opcode.ProbeScale, '0x59682f00'), vectors.instructions.probeScale);
  });

  it('mirrors Solidity require()s', () => {
    expect(() => ix.feeFlatIn(10_000_000)).toThrow('FeeBpsOutOfRange');
    expect(() => ix.xycConcentrateSwap(SQRT_MAX, SQRT_MIN)).toThrow('ConcentrateInvalidPriceBounds');
    expect(() => ix.dutchAuctionBalanceIn(0, 1, e18('1'))).toThrow('DutchAuctionWrongDecayFactor');
    expect(() => ix.whitelistCoequal(0, [])).toThrow('WhitelistCoequalEmptyList');
    expect(() => ix.piecewiseLinearScaleBalanceIn(0, [], [1])).toThrow('PiecewiseLinearScaleNotEnoughPointsToBuildPiece');
    expect(() => ix.piecewiseLinearScaleBalanceIn(0, [1], [1, 2, 3])).toThrow('PiecewiseLinearScaleMismatchInputLengths');
    expect(() => ix.jump(0x10000)).toThrow('does not fit in uint16');
    expect(() => ix.salt(('0x' + 'ff'.repeat(256)) as Hex)).toThrow('InstructionBuilderArgsLengthExceeded');
  });
});

// ---------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------

const programXycFee = ix.program(ix.feeFlatIn(30_000), ix.xycSwap(), ix.stop());
const programConcentrated = ix.program(ix.salt(1), ix.xycConcentrateSwap(SQRT_MIN, SQRT_MAX), ix.stop());
const programJumps = ix.program(
  ix.jumpIfDirection(true, 14),
  ix.feeFlatIn(1000),
  ix.xycSwap(),
  ix.stop(),
  ix.feeFlatIn(2000),
  ix.xycSwap(),
  ix.stop(),
);
const programProbe = ix.program(ix.probeScale(1_500_000_000), ix.xycSwap());

describe('programs', () => {
  it('xycFee', () => eqHex(programXycFee, vectors.programs.xycFee));
  it('concentrated', () => eqHex(programConcentrated, vectors.programs.concentrated));
  it('jumps', () => eqHex(programJumps, vectors.programs.jumps));
  it('probe', () => eqHex(programProbe, vectors.programs.probe));
});

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

const domain: SwapVMDomain = {
  name: vectors.meta.name,
  version: vectors.meta.version,
  chainId: vectors.meta.chainId,
  verifyingContract: vectors.meta.router,
};

const orders: Record<string, Order> = {
  aquaNoHooks: buildOrder({ maker: MAKER, tokenA: TOKEN_A, tokenB: TOKEN_B, useAquaInsteadOfSignature: true, program: programXycFee }),
  aquaHooks: buildOrder({
    maker: MAKER,
    tokenA: TOKEN_A,
    tokenB: TOKEN_B,
    useAquaInsteadOfSignature: true,
    allowZeroAmountIn: true,
    hasPreTransferInHook: true,
    preTransferInTarget: HOOK_TARGET,
    preTransferInData: '0x01',
    hasPostTransferInHook: true,
    postTransferInTarget: MAKER,
    postTransferInData: '0x0203',
    hasPreTransferOutHook: true,
    hasPostTransferOutHook: true,
    postTransferOutTarget: HOOK_TARGET,
    postTransferOutData: '0x04050607',
    program: programConcentrated,
  }),
  signature: buildOrder({ maker: MAKER, tokenA: TOKEN_A, tokenB: TOKEN_B, receiver: RECIPIENT, shouldUnwrapWeth: true, program: programJumps }),
  probe: buildOrder({ maker: MAKER, tokenA: TOKEN_A, tokenB: TOKEN_B, useAquaInsteadOfSignature: true, program: programProbe }),
};

describe('orders', () => {
  it('covers every Solidity vector', () => {
    expect(Object.keys(orders).sort()).toEqual(Object.keys(vectors.orders).sort());
  });

  for (const [name, order] of Object.entries(orders)) {
    const v = vectors.orders[name];
    it(`${name}: MakerTraitsLib.build`, () => {
      eqHex(order.maker, v.maker);
      expect(order.traits).toBe(hexToBigInt(v.traits));
      eqHex(order.data, v.data);
    });
    it(`${name}: abi.encode(order) for Aqua.ship`, () => {
      eqHex(encodeStrategyForShip(order), v.encoded);
    });
    it(`${name}: router.hash(order)`, () => {
      eqHex(orderHash(order, domain), v.hash);
    });
  }

  it('aqua hash == keccak256(abi.encode(order))', () => {
    eqHex(orderHashAqua(orders.aquaNoHooks), vectors.orders.aquaNoHooks.hash);
    eqHex(orderHashAqua(orders.aquaHooks), vectors.orders.aquaHooks.hash);
  });

  it('signature-mode hash is EIP-712', () => {
    eqHex(orderHashEip712(orders.signature, domain), vectors.orders.signature.hash);
    expect(orderHashAqua(orders.signature).toLowerCase()).not.toBe(vectors.orders.signature.hash.toLowerCase());
    expect(() => orderHash(orders.signature)).toThrow('EIP-712 domain required');
  });

  it('decodeOrder round-trips hooks and program', () => {
    const d = decodeOrder(orders.aquaHooks);
    expect(d.tokenA).toBe(TOKEN_A);
    expect(d.tokenB).toBe(TOKEN_B);
    expect(d.useAquaInsteadOfSignature).toBe(true);
    expect(d.allowZeroAmountIn).toBe(true);
    expect(d.preTransferInHook).toEqual({ target: HOOK_TARGET, data: '0x01' });
    expect(d.postTransferInHook).toEqual({ target: MAKER, data: '0x0203' });
    expect(d.preTransferOutHook).toEqual({ target: MAKER, data: '0x' });
    expect(d.postTransferOutHook).toEqual({ target: HOOK_TARGET, data: '0x04050607' });
    eqHex(d.program, programConcentrated);

    const s = decodeOrder(orders.signature);
    expect(s.receiver).toBe(RECIPIENT);
    expect(s.shouldUnwrapWeth).toBe(true);
    expect(s.useAquaInsteadOfSignature).toBe(false);
    eqHex(s.program, programJumps);
  });

  it('rejects unsorted tokens and missing hook flags', () => {
    expect(() => buildOrder({ maker: MAKER, tokenA: TOKEN_B, tokenB: TOKEN_A, program: '0x' })).toThrow('MakerTraitsTokensNotSorted');
    expect(() => buildOrder({ maker: MAKER, tokenA: TOKEN_A, tokenB: TOKEN_B, program: '0x', preTransferInData: '0x01' })).toThrow(
      'MakerTraitsMissingHasPreTransferInFlag',
    );
  });
});

// ---------------------------------------------------------------------------
// Taker traits
// ---------------------------------------------------------------------------

const takerBase = (isExactIn: boolean, isAToB: boolean): BuildTakerTraitsArgs => ({
  taker: TAKER,
  isExactIn,
  isAToB,
  useTransferFromAndAquaPush: true,
  threshold: parseUnits('123456789', 9),
  to: RECIPIENT,
  deadline: 1_800_000_000,
  instructionsArgs: '0xaabbcc',
});

const fullSignature: Hex = `0x${'1111'.padStart(64, '0')}${'2222'.padStart(64, '0')}1b`;

const takers: Record<string, BuildTakerTraitsArgs> = {
  exactInAToB: takerBase(true, true),
  exactInBToA: takerBase(true, false),
  exactOutAToB: takerBase(false, true),
  exactOutBToA: takerBase(false, false),
  minimal: { taker: TAKER, isExactIn: true, isAToB: true },
  toIsTaker: { ...takerBase(true, true), to: TAKER },
  full: {
    ...takerBase(false, false),
    shouldUnwrapWeth: true,
    isStrictThresholdAmount: true,
    isFirstTransferFromTaker: true,
    allowPartialFill: true,
    hasPreTransferInCallback: true,
    hasPreTransferOutCallback: true,
    threshold: e18('1'),
    preTransferInHookData: '0x11',
    postTransferInHookData: '0x2222',
    preTransferOutHookData: '0x333333',
    postTransferOutHookData: '0x44444444',
    preTransferInCallbackData: '0x5555555555',
    preTransferOutCallbackData: '0x666666666666',
    instructionsArgs: '0x77777777777777',
    signature: fullSignature,
  },
};

describe('taker traits', () => {
  it('covers every Solidity vector', () => {
    expect(Object.keys(takers).sort()).toEqual(Object.keys(vectors.taker).sort());
  });

  for (const [name, args] of Object.entries(takers)) {
    it(`${name} matches TakerTraitsLib.build`, () => {
      eqHex(buildTakerTraits(args), vectors.taker[name]);
    });
  }

  it('decodeTakerTraits round-trips', () => {
    const d = decodeTakerTraits(vectors.taker.full);
    expect(d.isExactIn).toBe(false);
    expect(d.isAToB).toBe(false);
    expect(d.shouldUnwrapWeth).toBe(true);
    expect(d.isStrictThresholdAmount).toBe(true);
    expect(d.isFirstTransferFromTaker).toBe(true);
    expect(d.useTransferFromAndAquaPush).toBe(true);
    expect(d.allowPartialFill).toBe(true);
    expect(d.hasPreTransferInCallback).toBe(true);
    expect(d.hasPreTransferOutCallback).toBe(true);
    expect(d.threshold).toBe(e18('1'));
    expect(d.to).toBe(RECIPIENT);
    expect(d.deadline).toBe(BigInt(1_800_000_000));
    expect(d.preTransferInHookData).toBe('0x11');
    expect(d.postTransferInHookData).toBe('0x2222');
    expect(d.preTransferOutHookData).toBe('0x333333');
    expect(d.postTransferOutHookData).toBe('0x44444444');
    expect(d.preTransferInCallbackData).toBe('0x5555555555');
    expect(d.preTransferOutCallbackData).toBe('0x666666666666');
    expect(d.instructionsArgs).toBe('0x77777777777777');
    expect(d.signature).toBe(fullSignature);

    const m = decodeTakerTraits(vectors.taker.minimal);
    expect(m.threshold).toBeUndefined();
    expect(m.to).toBeUndefined();
    expect(m.deadline).toBe(BigInt(0));
    expect(m.signature).toBe('0x');
  });

  it('rejects callback data without the flag', () => {
    expect(() => buildTakerTraits({ taker: TAKER, isExactIn: true, isAToB: true, preTransferInCallbackData: '0x01' })).toThrow(
      'TakerTraitsMissingHasPreTransferInFlag',
    );
  });
});

// ---------------------------------------------------------------------------
// Math
// ---------------------------------------------------------------------------

describe('XYCConcentrateSwap math', () => {
  const A = e18('100');
  const B = e18('200');

  it('computeLiquidity / computeLiquidityAndPrice', () => {
    const liquidity = math.concentrateComputeLiquidity(A, B, SQRT_MIN, SQRT_MAX);
    expect(liquidity).toBe(hexToBigInt(vectors.math.liquidity));
    const lp = math.concentrateComputeLiquidityAndPrice(A, B, SQRT_MIN, SQRT_MAX);
    expect(lp.liquidity).toBe(liquidity);
    expect(lp.sqrtPriceSpot).toBe(hexToBigInt(vectors.math.sqrtPriceSpot));
  });

  it('computeBalances', () => {
    const liquidity = hexToBigInt(vectors.math.liquidity);
    const spot = hexToBigInt(vectors.math.sqrtPriceSpot);
    const b = math.concentrateComputeBalances(liquidity, spot, SQRT_MIN, SQRT_MAX);
    expect(b.balanceA).toBe(hexToBigInt(vectors.math.balanceA));
    expect(b.balanceB).toBe(hexToBigInt(vectors.math.balanceB));
  });

  it('computeLiquidityFromAmounts', () => {
    const r = math.concentrateComputeLiquidityFromAmounts(A, B, e18('1'), SQRT_MIN, SQRT_MAX);
    expect(r.liquidity).toBe(hexToBigInt(vectors.math.liquidityFromAmounts));
    expect(r.actualA).toBe(hexToBigInt(vectors.math.actualA));
    expect(r.actualB).toBe(hexToBigInt(vectors.math.actualB));
  });
});
