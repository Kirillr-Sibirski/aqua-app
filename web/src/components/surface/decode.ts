/**
 * Turning a shipped strategy into an option.
 *
 * `Aqua.ship` takes the strategy "fully instead of being pre-hashed, for data availability", so the
 * `Shipped` event carries the whole program and a Strikeline leg's strike, implied vol, maturity
 * and liquidity are public the moment it lands. This module is the browser's copy of that decode;
 * `contracts/src/SurfaceLens.sol` and `subgraph/src/decode.ts` are the other two, and all three
 * read the same byte offsets out of `RmmSwap.sol`.
 *
 * It computes nothing. There is no `Phi` here and there will not be one: the curve's own
 * approximated `Phi` is the only correct source of a reserve or a price, and a second
 * implementation that disagreed by one wei would be worse than no implementation at all. Delta is
 * the exception that proves it — `X/L` is a ratio of two numbers read from Aqua, not a model.
 */
import { getAddress, type Address } from 'viem';
import {
  COVERAGE_OPCODE,
  FLAG_RISKY_IS_TOKEN_A,
  RMM_SWAP_OPCODE,
  decodeRmmSwapArgs,
  explainProgram,
} from '@/components/curve';
import type { ShippedStrategy } from '@/lib/contracts';
import type { SurfaceCensus, SurfaceLeg, SurfacePoint } from './types';

const ZERO = BigInt(0);

/** Why a strategy on the router is not on the surface. Shown as a count, never hidden. */
export type SkipReason = 'no-rmm' | 'malformed';

export interface DecodeResult {
  leg: SurfaceLeg | null;
  reason?: SkipReason;
}

/**
 * Decode one `Shipped` payload.
 *
 * Returns `null` for the strategies that are not options — an ordinary `XYCSwap` pool shipped to
 * the same router decodes perfectly well and simply has no curve of ours in it. Declining is the
 * correct answer; guessing a strike would not be.
 */
export function decodeSurfaceLeg(strategy: ShippedStrategy, mine: boolean): DecodeResult {
  let instructions;
  try {
    instructions = explainProgram(strategy.program);
  } catch {
    return { leg: null, reason: 'malformed' };
  }

  const rmm = instructions.find((i) => i.opcode === RMM_SWAP_OPCODE);
  if (!rmm) return { leg: null, reason: 'no-rmm' };

  let args;
  try {
    args = decodeRmmSwapArgs(rmm.args);
  } catch {
    return { leg: null, reason: 'malformed' };
  }

  const riskyIsTokenA = (args.flags & FLAG_RISKY_IS_TOKEN_A) !== 0;
  // Checksummed here rather than trusted: `decodeOrder` slices these out of `order.data` and hands
  // them back lowercase, and a screen that renders one address two ways is a screen a maker stops
  // believing. Comparisons downstream are case-insensitive either way.
  const [tokenA, tokenB] = [getAddress(strategy.tokens[0]), getAddress(strategy.tokens[1])];
  const tokenRisky = riskyIsTokenA ? tokenA : tokenB;
  const tokenStable = riskyIsTokenA ? tokenB : tokenA;

  // Aqua's reserves arrive per token; match them to the sides the curve names.
  const balance = (token: Address): bigint =>
    strategy.balances.find((b) => b.token.toLowerCase() === token.toLowerCase())?.balance ?? ZERO;

  return {
    leg: {
      strategyHash: strategy.strategyHash,
      maker: getAddress(strategy.maker),
      app: getAddress(strategy.app),
      tokenRisky,
      tokenStable,
      riskyIsTokenA,
      strikeWad: args.strikeWad,
      sigmaWad: args.sigmaWad,
      maturity: args.maturity,
      liquidityWad: args.liquidityWad,
      rateRisky: args.rateRisky,
      rateStable: args.rateStable,
      flags: args.flags,
      guarded: instructions.some((i) => i.opcode === COVERAGE_OPCODE),
      reserveRisky: balance(tokenRisky),
      reserveStable: balance(tokenStable),
      docked: strategy.docked,
      shippedAtBlock: strategy.blockNumber,
      mine,
    },
  };
}

/** The whole log, decoded. Legs in ship order, plus a count of what was skipped and why. */
export function decodeSurface(
  strategies: readonly ShippedStrategy[],
  connected: Address | undefined,
): { legs: SurfaceLeg[]; skipped: Record<SkipReason, number> } {
  const legs: SurfaceLeg[] = [];
  const skipped: Record<SkipReason, number> = { 'no-rmm': 0, malformed: 0 };
  const me = connected?.toLowerCase();

  for (const strategy of strategies) {
    const { leg, reason } = decodeSurfaceLeg(strategy, !!me && strategy.maker.toLowerCase() === me);
    if (leg) legs.push(leg);
    else if (reason) skipped[reason] += 1;
  }
  return { legs, skipped };
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export function pointKey(strikeWad: bigint, maturity: number): string {
  return `${strikeWad.toString()}-${maturity}`;
}

/**
 * Group legs into the cells of the surface.
 *
 * A cell is one (strike, expiry) across every maker, which is the unit a taker actually shops: "who
 * will write me a 7-day 2,800 call, and at what vol". Live legs are ranked widest vol first,
 * because that is the best bid.
 */
export function groupSurface(legs: readonly SurfaceLeg[]): SurfacePoint[] {
  const byKey = new Map<string, SurfaceLeg[]>();
  for (const leg of legs) {
    const key = pointKey(leg.strikeWad, leg.maturity);
    const list = byKey.get(key);
    if (list) list.push(leg);
    else byKey.set(key, [leg]);
  }

  const points: SurfacePoint[] = [];
  for (const [key, group] of byKey) {
    const liveLegs = group
      .filter((l) => !l.docked)
      .sort((a, b) => (a.sigmaWad === b.sigmaWad ? 0 : a.sigmaWad > b.sigmaWad ? -1 : 1));
    points.push({
      key,
      strikeWad: group[0].strikeWad,
      maturity: group[0].maturity,
      legs: group,
      liveLegs,
      maxSigmaWad: liveLegs.length ? liveLegs[0].sigmaWad : ZERO,
      minSigmaWad: liveLegs.length ? liveLegs[liveLegs.length - 1].sigmaWad : ZERO,
      liveLiquidityWad: liveLegs.reduce((sum, l) => sum + l.liquidityWad, ZERO),
      mine: liveLegs.some((l) => l.mine),
    });
  }

  return points.sort((a, b) =>
    a.maturity === b.maturity
      ? a.strikeWad === b.strikeWad
        ? 0
        : a.strikeWad < b.strikeWad
          ? -1
          : 1
      : a.maturity - b.maturity,
  );
}

/** The counts printed above the chart. Facts about the log, not estimates. */
export function censusOf(legs: readonly SurfaceLeg[], foreign: number): SurfaceCensus {
  const live = legs.filter((l) => !l.docked);
  return {
    legs: legs.length,
    liveLegs: live.length,
    makers: new Set(live.map((l) => l.maker.toLowerCase())).size,
    strikes: new Set(live.map((l) => l.strikeWad.toString())).size,
    expiries: new Set(live.map((l) => l.maturity)).size,
    writtenWad: live.reduce((sum, l) => sum + l.liquidityWad, ZERO),
    guarded: live.filter((l) => l.guarded).length,
    foreign,
  };
}

// ---------------------------------------------------------------------------
// Derived, from chain reads only
// ---------------------------------------------------------------------------

/** Days to expiry on the chain's clock. Negative once past. */
export function daysToExpiry(maturity: number, nowSeconds: number): number {
  return (maturity - nowSeconds) / 86_400;
}

/** `sigmaWad` as a ratio, for an axis or a percentage. */
export function ivOf(leg: { sigmaWad: bigint }): number {
  return Number(leg.sigmaWad) / 1e18;
}

/**
 * `X/L`, the leg's delta in risky per unit of liquidity.
 *
 * Safe to compute here: it is a ratio of two numbers Aqua stores, and the identity `dV/dS = X` is
 * exact at every point of the curve because reserves sit on it by construction. The lens returns
 * the same figure; this is the fallback when it has not answered.
 */
export function deltaOf(leg: SurfaceLeg): number | undefined {
  if (leg.liquidityWad === ZERO) return undefined;
  return Number((leg.reserveRisky * leg.rateRisky * BigInt(1e9)) / leg.liquidityWad) / 1e9;
}

/**
 * The spot the book itself implies: the liquidity-weighted mean of the legs' own marks.
 *
 * Every live leg on a pair implies a spot through its own reserve point, and arbitrage is what
 * keeps those numbers together, so their spread is a reading of how far the book is from
 * arbitrage-free. No oracle is involved; this is the curves talking.
 */
export function impliedSpot(legs: readonly SurfaceLeg[]): { markWad: bigint; spreadWad: bigint; legs: number } | null {
  const priced = legs.filter((l) => !l.docked && l.pricing && l.pricing.markWad > ZERO);
  if (priced.length === 0) return null;

  let weight = ZERO;
  let total = ZERO;
  let lo = priced[0].pricing!.markWad;
  let hi = lo;
  for (const leg of priced) {
    const mark = leg.pricing!.markWad;
    total += mark * leg.liquidityWad;
    weight += leg.liquidityWad;
    if (mark < lo) lo = mark;
    if (mark > hi) hi = mark;
  }
  if (weight === ZERO) return null;
  return { markWad: total / weight, spreadWad: hi - lo, legs: priced.length };
}
