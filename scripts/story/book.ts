/**
 * The demo book: four option legs written from one wallet, and everything needed to build, ship, read
 * and quote them.
 *
 * The economic parameters are fixed (K, L, sigma, expiry). The reserves are not: `x` is derived from the
 * replayed tape price at the moment of shipping, and `y` is then asked of the chain. Shipping a `y` from
 * a float would be a silent, permanent failure -- one wei low and every quote reverts, and `Aqua.ship`
 * requires `tokensCount == 0` so the strategy can never be repaired -- which is why `StrikelineViews`
 * exposes `stableFor` at all.
 *
 * The instruction encoders come from `web/src/components/curve/rmm.ts`, the same module the app compiles
 * legs with, so the demo cannot drift from the product. `assertEncoderPinned()` re-checks the golden
 * vector that module pins against `forge` before anything is shipped.
 */
import {
  decodeAbiParameters,
  encodeAbiParameters,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import {
  ORDER_TUPLE_ABI,
  aquaAbi,
  buildAquaOrder,
  buildTakerTraits,
  swapVmAbi,
  type Order,
} from '../../web/src/lib/swapvm/index.ts';
import {
  ASSIGNMENT_WINDOW_SECONDS,
  FLAG_RISKY_IS_TOKEN_A,
  buildLegProgram,
  encodeRmmSwap,
  expiryFlagsFor,
  rateFor,
  strikelineViewsAbi,
  toRawReserve,
  type LegKind,
  type RmmArgs,
} from '../../web/src/components/curve/rmm.ts';
import { targetRiskyWad, type CurveParams } from '../arb/rmm.ts';
import { publicClient } from '../fork/lib.ts';
import type { LegId, StoredLeg, StoredOrder } from './lib.ts';

// ---------------------------------------------------------------------------
// The book
// ---------------------------------------------------------------------------

/** 60% annualised, chosen by the maker. No oracle supplies it and nothing on-chain reads it but the curve. */
export const SIGMA_WAD = 600_000_000_000_000_000n;
export const EXPIRY_DAYS = 7;

/** The maker's wallet, seeded at irregular amounts because round numbers read as fake even when they are real. */
export const WALLET_WETH = 10_400_000_000_000_000_000n; // 10.4 WETH
export const WALLET_USDC = 24_850_000_000n; // 24,850 USDC

export interface LegSpec {
  id: LegId;
  kind: LegKind;
  /** `K` in whole stable units. */
  strike: number;
  /** `L` in whole risky units. */
  liquidity: number;
  label: string;
}

/**
 * Three covered calls above spot and one cash-secured put below it, all backed by the same 10.4 WETH and
 * 24,850 USDC. The calls alone write 32 WETH of notional against a 10.4 WETH wallet; `Coverage` is what
 * makes that portfolio margin rather than phantom depth.
 */
export const BOOK: readonly LegSpec[] = [
  { id: 'call2600', kind: 'call', strike: 2600, liquidity: 12, label: 'call K=2,600 L=12' },
  { id: 'call2800', kind: 'call', strike: 2800, liquidity: 10, label: 'call K=2,800 L=10' },
  { id: 'call3000', kind: 'call', strike: 3000, liquidity: 10, label: 'call K=3,000 L=10' },
  { id: 'put2300', kind: 'put', strike: 2300, liquidity: 10, label: 'put  K=2,300 L=10' },
];

/**
 * The vector `web/src/components/curve/__tests__/rmm.test.ts` pins against `RmmSwap.build` in Solidity.
 * Re-checked here because this process ships real strategies: a one-byte drift changes
 * `keccak256(strategy)` and every later quote reverts as "not in an active strategy", which reads like
 * missing liquidity rather than like an encoding bug.
 */
const PINNED_RMM_VECTOR =
  '0x553e070853a0d2313c0000006aa1f940000000000000008cf23f909c0fa000000000000000000000a688906bd8b000000000000000000001000000e8d4a51000';

export function assertEncoderPinned(): void {
  const encoded = encodeRmmSwap({
    flags: 0x07,
    sigmaWad: 600_000_000_000_000_000n,
    maturity: 1_789_000_000,
    strikeWad: 2_600_000_000_000_000_000_000n,
    liquidityWad: 12_000_000_000_000_000_000n,
    rateRisky: 1n,
    rateStable: 1_000_000_000_000n,
  });
  if (encoded !== PINNED_RMM_VECTOR) {
    throw new Error(
      `RmmSwap encoder drifted from the Solidity golden vector.\n  expected ${PINNED_RMM_VECTOR}\n  got      ${encoded}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export interface Pair {
  risky: Address;
  stable: Address;
  riskyDecimals: number;
  stableDecimals: number;
  rateRisky: bigint;
  rateStable: bigint;
  riskyIsTokenA: boolean;
  tokenA: Address;
  tokenB: Address;
}

export function pairFor(weth: Address, usdc: Address): Pair {
  const riskyIsTokenA = BigInt(weth) < BigInt(usdc);
  return {
    risky: weth,
    stable: usdc,
    riskyDecimals: 18,
    stableDecimals: 6,
    rateRisky: rateFor(18),
    rateStable: rateFor(6),
    riskyIsTokenA,
    tokenA: riskyIsTokenA ? weth : usdc,
    tokenB: riskyIsTokenA ? usdc : weth,
  };
}

// ---------------------------------------------------------------------------
// Leg construction
// ---------------------------------------------------------------------------

export interface BuiltLeg {
  spec: LegSpec;
  args: RmmArgs;
  program: Hex;
  order: Order;
  hash: Hex;
  /** Normalised risky reserve the maker aims to ship, chosen from the replayed spot. */
  targetRiskyWad: bigint;
  salt: bigint;
}

export function curveParamsOf(args: Pick<RmmArgs, 'strikeWad' | 'sigmaWad' | 'maturity' | 'liquidityWad' | 'rateRisky' | 'rateStable'>): CurveParams {
  return {
    strikeWad: args.strikeWad,
    sigmaWad: args.sigmaWad,
    maturity: args.maturity,
    liquidityWad: args.liquidityWad,
    rateRisky: args.rateRisky,
    rateStable: args.rateStable,
  };
}

/**
 * Compile one leg. `spotWad` only picks *where* on the curve the reserves start -- a maker's choice of
 * moneyness, not a value anything settles against.
 */
export function buildLeg(
  spec: LegSpec,
  opts: { maker: Address; pair: Pair; maturity: number; spotWad: bigint; nowSeconds: number; salt: bigint },
): BuiltLeg {
  const { maker, pair, maturity, spotWad, nowSeconds, salt } = opts;
  const args: RmmArgs = {
    flags: (pair.riskyIsTokenA ? FLAG_RISKY_IS_TOKEN_A : 0) | expiryFlagsFor(spec.kind),
    sigmaWad: SIGMA_WAD,
    maturity,
    strikeWad: BigInt(spec.strike) * 10n ** 18n,
    liquidityWad: BigInt(spec.liquidity) * 10n ** 18n,
    rateRisky: pair.rateRisky,
    rateStable: pair.rateStable,
  };
  const program = buildLegProgram({
    rmm: args,
    coverage: { flags: 0, haircutBps: 0 },
    deadline: maturity + ASSIGNMENT_WINDOW_SECONDS,
    salt,
  });
  const order = buildAquaOrder({ maker, tokenA: pair.tokenA, tokenB: pair.tokenB, program });
  return {
    spec,
    args,
    program,
    order,
    hash: orderHash(order),
    targetRiskyWad: targetRiskyWad(spotWad, curveParamsOf(args), nowSeconds),
    salt,
  };
}

/**
 * Compile the whole ladder, sized by the chain.
 *
 * `x` is chosen off the replayed spot -- a maker picking moneyness, which is a choice and may be a
 * float -- and `y` is then asked of the router's own `stableFor`, because the leg has to start exactly
 * on the curve AS THE CHAIN COMPUTES IT, with the chain's approximated `Phi`. One wei low and every
 * quote reverts for the life of the leg; one wei high and the surplus goes to the first taker; and a
 * shipped hash can never be repaired, because `Aqua.ship` requires `tokensCount == 0` and `dock` writes
 * `0xff` permanently.
 *
 * Scene 1 and scene 6 both call this, so a roll cannot drift from the original ship.
 */
export async function compileBook(opts: {
  router: Address;
  maker: Address;
  pair: Pair;
  maturity: number;
  spotWad: bigint;
  nowSeconds: number;
  /** Monotonic across rolls: a docked strategy hash can never be re-shipped. */
  generation: number;
  specs?: readonly LegSpec[];
}): Promise<Array<{ built: BuiltLeg; row: StoredLeg }>> {
  const specs = opts.specs ?? BOOK;
  const rows: Array<{ built: BuiltLeg; row: StoredLeg }> = [];
  for (const [i, spec] of specs.entries()) {
    const built = buildLeg(spec, {
      maker: opts.maker,
      pair: opts.pair,
      maturity: opts.maturity,
      spotWad: opts.spotWad,
      nowSeconds: opts.nowSeconds,
      salt: BigInt(opts.generation * 10 + i + 1),
    });
    const yWadOnCurve = await stableFor(opts.router, curveParamsOf(built.args), built.targetRiskyWad);
    // Rounding the stable side DOWN to raw USDC leaves the reserves a hair inside the curve, which is
    // the maker's side of a millionth of a cent.
    const risky = toRawReserve(built.targetRiskyWad, opts.pair.rateRisky);
    const stable = toRawReserve(yWadOnCurve, opts.pair.rateStable);
    const [amountA, amountB] = opts.pair.riskyIsTokenA ? [risky.raw, stable.raw] : [stable.raw, risky.raw];
    rows.push({
      built,
      row: {
        id: spec.id,
        kind: spec.kind,
        label: spec.label,
        strikeWad: built.args.strikeWad.toString(),
        liquidityWad: built.args.liquidityWad.toString(),
        sigmaWad: built.args.sigmaWad.toString(),
        maturity: opts.maturity,
        salt: built.salt.toString(),
        xWad: risky.normalised.toString(),
        yWad: stable.normalised.toString(),
        tokenA: opts.pair.tokenA,
        tokenB: opts.pair.tokenB,
        amountA: amountA.toString(),
        amountB: amountB.toString(),
        order: storeOrder(built.order),
        hash: built.hash,
        shipTx: '0x' as Hex,
        shipBlock: 0,
      },
    });
  }
  return rows;
}

/** Aqua-mode strategy hash: `keccak256(abi.encode(order))`, which is also `router.hash(order)`. */
export function orderHash(order: Order): Hex {
  return keccak256(encodeStrategy(order));
}

export function encodeStrategy(order: Order): Hex {
  return encodeAbiParameters(ORDER_TUPLE_ABI, [order]);
}

export function storeOrder(order: Order): StoredOrder {
  return { maker: order.maker, traits: order.traits.toString(), data: order.data };
}

export function restoreOrder(stored: StoredOrder): Order {
  return { maker: stored.maker, traits: BigInt(stored.traits), data: stored.data };
}

export function decodeStrategy(strategy: Hex): Order {
  const [order] = decodeAbiParameters(ORDER_TUPLE_ABI, strategy);
  return order as Order;
}

// ---------------------------------------------------------------------------
// Chain reads
// ---------------------------------------------------------------------------

export interface LegReserves {
  /** Raw Aqua virtual balances. */
  rawRisky: bigint;
  rawStable: bigint;
  /** The same, lifted into the normalised space the curve works in. */
  xWad: bigint;
  yWad: bigint;
}

export async function readReserves(
  leg: StoredLeg,
  pair: Pair,
  opts: { aqua: Address; router: Address; blockNumber?: bigint; client?: PublicClient },
): Promise<LegReserves> {
  const client = opts.client ?? publicClient;
  const [balA, balB] = await client.readContract({
    address: opts.aqua,
    abi: aquaAbi,
    functionName: 'safeBalances',
    args: [leg.order.maker, opts.router, leg.hash, leg.tokenA, leg.tokenB],
    ...(opts.blockNumber === undefined ? {} : { blockNumber: opts.blockNumber }),
  });
  const rawRisky = pair.riskyIsTokenA ? balA : balB;
  const rawStable = pair.riskyIsTokenA ? balB : balA;
  return { rawRisky, rawStable, xWad: rawRisky * pair.rateRisky, yWad: rawStable * pair.rateStable };
}

export async function coverageOf(
  router: Address,
  maker: Address,
  token: Address,
  blockNumber?: bigint,
): Promise<bigint> {
  return publicClient.readContract({
    address: router,
    abi: strikelineViewsAbi,
    functionName: 'coverage',
    args: [maker, token],
    ...(blockNumber === undefined ? {} : { blockNumber }),
  });
}

export async function stableFor(
  router: Address,
  p: CurveParams,
  xWad: bigint,
  blockNumber?: bigint,
): Promise<bigint> {
  return publicClient.readContract({
    address: router,
    abi: strikelineViewsAbi,
    functionName: 'stableFor',
    args: [p.strikeWad, p.sigmaWad, p.maturity, p.liquidityWad, xWad],
    ...(blockNumber === undefined ? {} : { blockNumber }),
  });
}

export async function riskyFor(router: Address, p: CurveParams, yWad: bigint, blockNumber?: bigint): Promise<bigint> {
  return publicClient.readContract({
    address: router,
    abi: strikelineViewsAbi,
    functionName: 'riskyFor',
    args: [p.strikeWad, p.sigmaWad, p.maturity, p.liquidityWad, yWad],
    ...(blockNumber === undefined ? {} : { blockNumber }),
  });
}

export async function bandFor(
  router: Address,
  p: CurveParams,
  xWad: bigint,
  yWad: bigint,
  blockNumber?: bigint,
): Promise<{ minRiskyIn: bigint; minStableIn: bigint }> {
  const [minRiskyIn, minStableIn] = await publicClient.readContract({
    address: router,
    abi: strikelineViewsAbi,
    functionName: 'bandFor',
    args: [p.strikeWad, p.sigmaWad, p.maturity, p.liquidityWad, xWad, yWad],
    ...(blockNumber === undefined ? {} : { blockNumber }),
  });
  return { minRiskyIn, minStableIn };
}

export async function tauNow(router: Address, maturity: number, blockNumber?: bigint): Promise<bigint> {
  return publicClient.readContract({
    address: router,
    abi: strikelineViewsAbi,
    functionName: 'tauNow',
    args: [maturity],
    ...(blockNumber === undefined ? {} : { blockNumber }),
  });
}

// ---------------------------------------------------------------------------
// Quote / swap plumbing
// ---------------------------------------------------------------------------

export interface TakerOpts {
  taker: Address;
  tokenIn: Address;
  tokenA: Address;
  isExactIn: boolean;
  threshold?: bigint;
  deadline?: bigint;
}

export function takerDataFor(o: TakerOpts): Hex {
  return buildTakerTraits({
    taker: o.taker,
    isExactIn: o.isExactIn,
    isAToB: o.tokenIn.toLowerCase() === o.tokenA.toLowerCase(),
    useTransferFromAndAquaPush: true,
    ...(o.threshold === undefined ? {} : { threshold: o.threshold }),
    ...(o.deadline === undefined ? {} : { deadline: o.deadline }),
  });
}

/** `quote()` is non-view on the router, so it is simulated as the taker rather than `eth_call`ed blind. */
export async function quoteAt(
  router: Address,
  order: Order,
  amount: bigint,
  takerData: Hex,
  account: Address,
  blockNumber?: bigint,
): Promise<{ amountIn: bigint; amountOut: bigint; orderHash: Hex }> {
  const { result } = await publicClient.simulateContract({
    address: router,
    abi: swapVmAbi,
    functionName: 'quote',
    args: [order, amount, takerData],
    account,
    ...(blockNumber === undefined ? {} : { blockNumber }),
  });
  const [amountIn, amountOut, hash] = result;
  return { amountIn, amountOut, orderHash: hash };
}
