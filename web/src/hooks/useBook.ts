'use client';

/**
 * The book: one wallet, a ladder of legs written against it, and the margin that makes the
 * over-allocation real rather than fictional.
 *
 * Everything on this screen is a chain read, and — this is the part that matters — **every number
 * is read at the same block**. The watched block number is passed into each multicall, so the
 * wallet balance, the coverage bound, every leg's Aqua reserves and every leg's deliverable depth
 * are a single consistent snapshot. That is what lets the screen show a fill on one leg shrinking
 * its siblings' depth *in the same block* instead of as four bars drifting into place as their own
 * pollers happen to fire.
 *
 * Two rounds, both pinned to that block:
 *
 *   1. wallet `balanceOf` + `allowance(maker, AQUA)` + `StrikelineViews.coverage`, Aqua's
 *      `rawBalances` for each leg's two tokens, and `tauNow` for each leg's maturity;
 *   2. `bandFor` at those reserves, and a probe `quote` asking each leg for the whole of what it
 *      advertises — the round that needs round one's output as its input.
 *
 * The probe is the interesting one. It does not ask "how much could this leg deliver"; it asks the
 * leg to deliver everything it has written and reads the answer out of the refusal.
 * `NotCovered(needed, free)` and `RmmExceedsReserve(requested, available)` both carry the true
 * bound as their second argument, so a leg that cannot deliver its written depth says so, with the
 * number, from the same instruction that will enforce it at fill time. No estimate, no clamp, no
 * off-chain reimplementation of the guard.
 */
import { useMemo } from 'react';
import { erc20Abi, type Abi, type Address, type Hex } from 'viem';
import { useBlock, useReadContracts } from 'wagmi';
import { aquaFork, type SupportedChainId } from '@/lib/chain';
import { DOCKED_TOKENS_COUNT, aquaAbi, tokenInfo, type Deployments, type ShippedStrategy } from '@/lib/contracts';
import { buildTakerTraits, type Order } from '@/lib/swapvm';
import { formatUnits } from '@/lib/ui';
import { useDeployments } from './useDeployments';
import { useShippedStrategies } from './useShippedStrategies';
import { useBookFills, type BookFill, type FillableLeg, type LegTheta } from './useBookFills';
import {
  boundFromRevert,
  decodeLegProgram,
  fromWad,
  minBig,
  quoteWithStrikelineErrorsAbi,
  ratio,
  rateForDecimals,
  strikelineViewsAbi,
  toWad,
  type RmmArgs,
  type VmInstruction,
} from './strikeline';

const ZERO = BigInt(0);
const DAY_SECONDS = BigInt(86_400);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LegStatus = 'active' | 'settling' | 'docked' | 'idle';

export interface BookTokenClaim {
  strategyHash: Hex;
  /** Short label for the segment: the leg's strike. */
  label: string;
  amount: bigint;
  kind: 'call' | 'put';
}

/**
 * One side of the shared inventory: what the wallet holds of a token, and every claim written
 * against it.
 */
export interface BookTokenView {
  address: Address;
  symbol: string;
  decimals: number;
  /** Multiplier into the curve's normalised WAD space. */
  rate: bigint;
  /** `balanceOf(maker)`. */
  wallet: bigint;
  /** `allowance(maker, AQUA)` — just as binding as the balance, and easier to forget. */
  allowance: bigint;
  /** `StrikelineViews.coverage`: `min(balance, allowance)`, the number `Coverage` enforces. */
  coverage: bigint;
  /** True when the allowance, not the balance, is the binding term. */
  allowanceBinds: boolean;
  /** Sum of every leg's virtual reserve of this token: the notional written against the wallet. */
  written: bigint;
  claims: BookTokenClaim[];
  /** The single largest claim; the deepest obligation one fill could present. */
  maxClaim: bigint;
  /** `written / coverage`: 2.7x on the demo book. Zero when nothing is written. */
  writtenMultiple: number;
  /**
   * `min(1, coverage / maxClaim)`: whether the deepest leg is still deliverable in full. Not
   * `coverage / written` — a book is meant to be over-allocated, and the binding question is
   * whether any one fill can be honoured, which is exactly what `Coverage` checks.
   */
  backed: number;
  /** Set when the router did not answer `coverage` (wrong router deployed, or no views on it). */
  unavailable: boolean;
}

export interface LegDepth {
  /** `min(coverage, reserve)` in the delivery token's units. */
  amount: bigint;
  /** Which of the two bounds is the smaller one right now. */
  bound: 'wallet' | 'curve';
  /** What the leg advertises: its whole virtual reserve of the delivery token. */
  written: bigint;
}

export interface LegProbe {
  /** The quote cleared at the leg's full written depth: it can deliver everything it advertises. */
  ok: boolean;
  /** Cost in the token the taker would pay, from the successful quote. */
  amountIn?: bigint;
  /** Decoded custom error name when the quote refused. */
  errorName?: string;
  /** The bound the refusal carried, in the delivery token's units. */
  bound?: bigint;
  reason?: 'wallet' | 'curve';
  /** The raw thrown value, for `ErrorState` to decode when the refusal is not one we expect. */
  error?: unknown;
  pending: boolean;
}

export interface BookLeg {
  key: string;
  strategyHash: Hex;
  strategy: ShippedStrategy;
  order: Order;
  program: Hex;
  instructions: VmInstruction[];
  rmm: RmmArgs;
  /** The strike, formatted once: it labels the row, the bar segment and the tooltip. */
  strikeLabel: string;
  /** True when a `Coverage` instruction wraps the curve. An unguarded leg's depth is phantom. */
  guarded: boolean;
  haircutBps: number;

  risky: BookTokenView;
  stable: BookTokenView;
  /** Which token the maker is obliged to hand over when this leg is swept. */
  deliversRisky: boolean;
  kind: 'call' | 'put';

  /** Aqua's virtual reserves, in token units, read at the pinned block. */
  reserveRisky: bigint;
  reserveStable: bigint;
  /** The same, normalised into the curve's WAD space. */
  xWad: bigint;
  yWad: bigint;

  status: LegStatus;
  matured: boolean;
  /** Seconds to expiry on the chain's clock; negative once past. */
  secondsLeft: number;
  /** `tauNow(maturity)` — years in WAD, as the curve itself sees the time. */
  tauWad?: bigint;

  /** `X/L = Phi(-d1)`: the share of the leg still held in the risky token. Its delta, read not modelled. */
  deltaRatio: number;

  depth: LegDepth;
  probe: LegProbe;

  /** The accrued decay band, in the units of the token a taker would pay to sweep this leg. */
  bandNext?: bigint;
  bandToken: BookTokenView;
  bandPending: boolean;

  /** Realised theta, summed from the band each past fill actually cleared. */
  theta?: LegTheta;
  lastFill?: BookFill;
}

export interface BookKpis {
  /** Notional written as a multiple of inventory, on the most over-allocated token. */
  writtenMultiple: number;
  writtenToken?: BookTokenView;
  /** Worst backing across the book's tokens. */
  backed: number;
  backedToken?: BookTokenView;
  /** Realised theta, per token, summed across every fill. Never a model number. */
  thetaByToken: { token: BookTokenView; amount: bigint }[];
  thetaFills: number;
  thetaPending: boolean;
  thetaIncomplete: boolean;
  /** `dV/dS` for the whole book: the sum of the legs' risky reserves. */
  deltaByToken: { token: BookTokenView; amount: bigint }[];
  fills24h: number;
  lastFillAt?: bigint;
}

export interface UseBookOptions {
  enabled?: boolean;
}

export interface UseBookReturn {
  legs: BookLeg[];
  tokens: BookTokenView[];
  kpis: BookKpis;
  fills: BookFill[];
  /** Strategies on our router that carry no `RmmSwap`: shipped here, but not options. */
  foreignStrategies: ShippedStrategy[];
  deployments?: Deployments;
  /** The block every number above was read at. */
  blockNumber?: bigint;
  blockTimestamp?: bigint;
  /** False when the deployed router does not answer `StrikelineViews` — the wrong-router state. */
  routerHasViews: boolean;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface Call {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  chainId: SupportedChainId;
}

type CallResult = { status: 'success'; result: unknown } | { status: 'failure'; error: Error };

function ok<T>(entry: CallResult | undefined): T | undefined {
  return entry?.status === 'success' ? (entry.result as T) : undefined;
}

/** A leg after the bytes have been decoded but before any chain state is attached. */
interface StaticLeg {
  strategy: ShippedStrategy;
  rmm: RmmArgs;
  guarded: boolean;
  haircutBps: number;
  instructions: VmInstruction[];
  risky: Address;
  stable: Address;
  deliversRisky: boolean;
}

export function useBook(maker: Address | undefined, options: UseBookOptions = {}): UseBookReturn {
  const chainId: SupportedChainId = aquaFork.id;
  const enabled = (options.enabled ?? true) && !!maker;

  const { deployments, isLoading: deploymentsLoading, error: deploymentsError } = useDeployments();

  // One clock for the whole screen. `watch` follows the chain rather than a browser timer, which
  // matters on a fork whose time has been warped: expiry is where the block says it is.
  const { data: block } = useBlock({ chainId, watch: true, query: { enabled } });
  const blockNumber = block?.number;
  const blockTimestamp = block?.timestamp;

  // Discovery only. Legs change on a ship or a dock, not per block, so this polls gently and the
  // numbers it carries are re-read below at the pinned block instead of being used as they arrive.
  const strategiesQuery = useShippedStrategies(maker, { refetchInterval: 8000 });

  const { staticLegs, foreignStrategies } = useMemo(() => {
    const legs: StaticLeg[] = [];
    const foreign: ShippedStrategy[] = [];
    for (const strategy of strategiesQuery.strategies) {
      const decoded = decodeLegProgram(strategy.program);
      if (!decoded.rmm) {
        foreign.push(strategy);
        continue;
      }
      const [tokenA, tokenB] = strategy.tokens;
      const risky = decoded.rmm.riskyIsTokenA ? tokenA : tokenB;
      const stable = decoded.rmm.riskyIsTokenA ? tokenB : tokenA;
      legs.push({
        strategy,
        rmm: decoded.rmm,
        guarded: decoded.guarded,
        haircutBps: decoded.haircutBps,
        instructions: decoded.instructions,
        risky,
        stable,
        // The settlement flag says which side the maker is assigned on: a covered call hands over
        // the risky token, a cash-secured put hands over the stable. A leg shipped without the
        // one-way flag falls back to whichever reserve dominates, which is the same distinction.
        deliversRisky: decoded.rmm.postExpiryOneWay
          ? decoded.rmm.postExpiryOutIsRisky
          : toWad(strategy.balances.find((b) => b.token.toLowerCase() === risky.toLowerCase())?.balance ?? ZERO, decoded.rmm.rateRisky) * BigInt(2) >
            decoded.rmm.liquidityWad,
      });
    }
    return { staticLegs: legs, foreignStrategies: foreign };
  }, [strategiesQuery.strategies]);

  // The tokens the instrument draws a bar for: every token the book touches, and failing that the
  // pair the deployment is built around, so a maker with no legs still sees real inventory.
  const tokenAddresses = useMemo(() => {
    const seen = new Map<string, Address>();
    for (const leg of staticLegs) {
      seen.set(leg.risky.toLowerCase(), leg.risky);
      seen.set(leg.stable.toLowerCase(), leg.stable);
    }
    if (seen.size === 0 && deployments) {
      seen.set(deployments.weth.toLowerCase(), deployments.weth);
      seen.set(deployments.usdc.toLowerCase(), deployments.usdc);
    }
    return [...seen.values()];
  }, [staticLegs, deployments]);

  // --- round one: inventory, coverage, reserves, tau -------------------------

  const roundOne = useMemo<Call[]>(() => {
    if (!deployments || !maker) return [];
    const calls: Call[] = [];
    for (const token of tokenAddresses) {
      calls.push({ address: token, abi: erc20Abi as Abi, functionName: 'balanceOf', args: [maker], chainId });
      calls.push({ address: token, abi: erc20Abi as Abi, functionName: 'allowance', args: [maker, deployments.aqua], chainId });
      calls.push({ address: deployments.router, abi: strikelineViewsAbi as Abi, functionName: 'coverage', args: [maker, token], chainId });
    }
    for (const leg of staticLegs) {
      calls.push({
        address: deployments.aqua,
        abi: aquaAbi as Abi,
        functionName: 'rawBalances',
        args: [maker, deployments.router, leg.strategy.strategyHash, leg.risky],
        chainId,
      });
      calls.push({
        address: deployments.aqua,
        abi: aquaAbi as Abi,
        functionName: 'rawBalances',
        args: [maker, deployments.router, leg.strategy.strategyHash, leg.stable],
        chainId,
      });
      calls.push({ address: deployments.router, abi: strikelineViewsAbi as Abi, functionName: 'tauNow', args: [leg.rmm.maturity], chainId });
    }
    return calls;
  }, [deployments, maker, tokenAddresses, staticLegs, chainId]);

  const one = useReadContracts({
    contracts: roundOne,
    allowFailure: true,
    blockNumber,
    query: { enabled: enabled && roundOne.length > 0 && blockNumber !== undefined },
  });

  const oneData = one.data as CallResult[] | undefined;

  // Coverage is the first thing a wrong router fails at, and it fails for every token at once.
  const routerHasViews = !oneData || tokenAddresses.length === 0 ? true : tokenAddresses.some((_, i) => oneData[i * 3 + 2]?.status === 'success');

  const tokens = useMemo<BookTokenView[]>(() => {
    return tokenAddresses.map((address, i) => {
      const meta = tokenInfo(address, deployments);
      const wallet = ok<bigint>(oneData?.[i * 3]) ?? ZERO;
      const allowance = ok<bigint>(oneData?.[i * 3 + 1]) ?? ZERO;
      const coverageRead = ok<bigint>(oneData?.[i * 3 + 2]);
      // Falling back to min(balance, allowance) keeps the instrument honest against a router with
      // no views: it is the same quantity, computed from the same two reads Coverage itself uses.
      const coverage = coverageRead ?? minBig(wallet, allowance);
      return {
        address,
        symbol: meta.symbol,
        decimals: meta.decimals,
        rate: rateForDecimals(meta.decimals),
        wallet,
        allowance,
        coverage,
        allowanceBinds: allowance < wallet,
        written: ZERO,
        claims: [],
        maxClaim: ZERO,
        writtenMultiple: 0,
        backed: 1,
        unavailable: oneData !== undefined && coverageRead === undefined,
      };
    });
  }, [tokenAddresses, deployments, oneData]);

  const tokenIndex = useMemo(() => new Map(tokens.map((t, i) => [t.address.toLowerCase(), i])), [tokens]);

  /** Reserves and tau, in the order round one queued them (three calls per token, then three per leg). */
  const legState = useMemo(() => {
    const base = tokenAddresses.length * 3;
    return staticLegs.map((leg, i) => {
      const risky = ok<readonly [bigint, number]>(oneData?.[base + i * 3]);
      const stable = ok<readonly [bigint, number]>(oneData?.[base + i * 3 + 1]);
      const tauWad = ok<bigint>(oneData?.[base + i * 3 + 2]);
      return {
        reserveRisky: risky?.[0] ?? ZERO,
        reserveStable: stable?.[0] ?? ZERO,
        tokensCount: Number(risky?.[1] ?? 0),
        tauWad,
        read: risky !== undefined && stable !== undefined,
      };
    });
  }, [staticLegs, oneData, tokenAddresses.length]);

  // --- round two: the band, and the probe that asks for everything -----------

  const roundTwo = useMemo<Call[]>(() => {
    if (!deployments || !maker || legState.length !== staticLegs.length) return [];
    const calls: Call[] = [];
    for (let i = 0; i < staticLegs.length; i += 1) {
      const leg = staticLegs[i];
      const state = legState[i];
      const xWad = toWad(state.reserveRisky, leg.rmm.rateRisky);
      const yWad = toWad(state.reserveStable, leg.rmm.rateStable);
      calls.push({
        address: deployments.router,
        abi: strikelineViewsAbi as Abi,
        functionName: 'bandFor',
        args: [leg.rmm.strikeWad, leg.rmm.sigmaWad, leg.rmm.maturity, leg.rmm.liquidityWad, xWad, yWad],
        chainId,
      });

      const deliveryToken = leg.deliversRisky ? leg.risky : leg.stable;
      const written = leg.deliversRisky ? state.reserveRisky : state.reserveStable;
      const isAToB = deliveryToken.toLowerCase() === leg.strategy.tokens[1].toLowerCase();
      calls.push({
        address: deployments.router,
        abi: quoteWithStrikelineErrorsAbi as Abi,
        functionName: 'quote',
        args: [
          leg.strategy.order,
          written,
          buildTakerTraits({ taker: maker, isExactIn: false, isAToB, threshold: null, useTransferFromAndAquaPush: true }),
        ],
        chainId,
      });
    }
    return calls;
  }, [deployments, maker, staticLegs, legState, chainId]);

  const probeReady = roundTwo.length > 0 && legState.every((s) => s.read);

  const two = useReadContracts({
    contracts: roundTwo,
    allowFailure: true,
    blockNumber,
    query: { enabled: enabled && probeReady && blockNumber !== undefined },
  });

  const twoData = two.data as CallResult[] | undefined;

  // --- fills and realised theta ---------------------------------------------

  const fillableLegs = useMemo<FillableLeg[]>(
    () => staticLegs.map((leg) => ({ strategyHash: leg.strategy.strategyHash, rmm: leg.rmm, risky: leg.risky, stable: leg.stable })),
    [staticLegs],
  );

  const fillsQuery = useBookFills(
    {
      maker,
      aqua: deployments?.aqua,
      router: deployments?.router,
      fromBlock: deployments ? BigInt(deployments.blockNumber) : undefined,
      legs: fillableLegs,
    },
    { blockNumber, enabled },
  );

  // --- compose ---------------------------------------------------------------

  const legs = useMemo<BookLeg[]>(() => {
    return staticLegs.map((leg, i) => {
      const state = legState[i];
      const riskyToken = tokens[tokenIndex.get(leg.risky.toLowerCase()) ?? 0];
      const stableToken = tokens[tokenIndex.get(leg.stable.toLowerCase()) ?? 0];
      const deliveryToken = leg.deliversRisky ? riskyToken : stableToken;
      const payToken = leg.deliversRisky ? stableToken : riskyToken;

      const written = leg.deliversRisky ? state.reserveRisky : state.reserveStable;
      const coverage = deliveryToken?.coverage ?? ZERO;
      const depthAmount = minBig(coverage, written);

      const band = ok<readonly [bigint, bigint]>(twoData?.[i * 2]);
      const quoteEntry = twoData?.[i * 2 + 1];
      const quoteResult = ok<readonly [bigint, bigint, Hex]>(quoteEntry);
      const refusal = quoteEntry?.status === 'failure' ? boundFromRevert(quoteEntry.error) : undefined;

      const probe: LegProbe = {
        ok: quoteResult !== undefined,
        amountIn: quoteResult?.[0],
        errorName: refusal?.name,
        bound: refusal?.bound,
        reason: refusal?.reason,
        error: quoteEntry?.status === 'failure' ? quoteEntry.error : undefined,
        pending: quoteEntry === undefined,
      };

      const matured = blockTimestamp !== undefined && Number(blockTimestamp) >= leg.rmm.maturity;
      const docked = state.tokensCount === DOCKED_TOKENS_COUNT;
      const status: LegStatus = docked ? 'docked' : written === ZERO ? 'idle' : matured ? 'settling' : 'active';

      const xWad = toWad(state.reserveRisky, leg.rmm.rateRisky);
      const yWad = toWad(state.reserveStable, leg.rmm.rateStable);
      const thetaEntry = fillsQuery.byLeg.get(leg.strategy.strategyHash.toLowerCase());
      const lastFill = fillsQuery.fills.find((f) => f.orderHash.toLowerCase() === leg.strategy.strategyHash.toLowerCase());

      // A taker sweeping this leg pays the other token, so that is the side of the band they cross.
      const bandNext = band ? (leg.deliversRisky ? fromWad(band[1], leg.rmm.rateStable) : fromWad(band[0], leg.rmm.rateRisky)) : undefined;

      return {
        key: `${leg.strategy.strategyHash}-${leg.strategy.logIndex}`,
        strategyHash: leg.strategy.strategyHash,
        strategy: leg.strategy,
        order: leg.strategy.order,
        program: leg.strategy.program,
        instructions: leg.instructions,
        rmm: leg.rmm,
        strikeLabel: formatUnits(leg.rmm.strikeWad, 18, { significantDigits: 18, maxFractionDigits: 2 }),
        guarded: leg.guarded,
        haircutBps: leg.haircutBps,
        risky: riskyToken,
        stable: stableToken,
        deliversRisky: leg.deliversRisky,
        kind: leg.deliversRisky ? 'call' : 'put',
        reserveRisky: state.reserveRisky,
        reserveStable: state.reserveStable,
        xWad,
        yWad,
        status,
        matured,
        secondsLeft: blockTimestamp === undefined ? Number.NaN : leg.rmm.maturity - Number(blockTimestamp),
        tauWad: state.tauWad,
        deltaRatio: ratio(xWad, leg.rmm.liquidityWad),
        depth: {
          amount: depthAmount,
          bound: coverage < written ? 'wallet' : 'curve',
          written,
        },
        probe,
        bandNext,
        bandToken: payToken,
        bandPending: two.isLoading || (twoData === undefined && probeReady),
        theta: thetaEntry,
        lastFill,
      } satisfies BookLeg;
    });
  }, [staticLegs, legState, tokens, tokenIndex, twoData, two.isLoading, probeReady, blockTimestamp, fillsQuery.byLeg, fillsQuery.fills]);

  // Claims are folded back onto the token views once the legs exist, so each bar knows what is
  // stacked inside it.
  const tokensWithClaims = useMemo<BookTokenView[]>(() => {
    const claims = new Map<string, BookTokenClaim[]>();
    for (const leg of legs) {
      if (leg.status === 'docked') continue;
      const push = (token: BookTokenView, amount: bigint) => {
        if (amount === ZERO) return;
        const list = claims.get(token.address.toLowerCase()) ?? [];
        list.push({ strategyHash: leg.strategyHash, label: leg.strikeLabel, amount, kind: leg.kind });
        claims.set(token.address.toLowerCase(), list);
      };
      push(leg.risky, leg.reserveRisky);
      push(leg.stable, leg.reserveStable);
    }
    return tokens.map((token) => {
      const list = (claims.get(token.address.toLowerCase()) ?? []).sort((a, b) => (a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1));
      const written = list.reduce((sum, c) => sum + c.amount, ZERO);
      const maxClaim = list.reduce((max, c) => (c.amount > max ? c.amount : max), ZERO);
      return {
        ...token,
        claims: list,
        written,
        maxClaim,
        writtenMultiple: ratio(written, token.coverage),
        backed: maxClaim === ZERO ? 1 : Math.min(1, ratio(token.coverage, maxClaim)),
      };
    });
  }, [tokens, legs]);

  const kpis = useMemo<BookKpis>(() => {
    const withClaims = tokensWithClaims.filter((t) => t.written > ZERO);
    const writtenToken = withClaims.reduce<BookTokenView | undefined>(
      (best, t) => (best === undefined || t.writtenMultiple > best.writtenMultiple ? t : best),
      undefined,
    );
    const backedToken = withClaims.reduce<BookTokenView | undefined>((worst, t) => (worst === undefined || t.backed < worst.backed ? t : worst), undefined);

    const thetaTotals = new Map<string, bigint>();
    let thetaFills = 0;
    let thetaPending = false;
    let thetaIncomplete = false;
    for (const leg of legs) {
      const t = leg.theta;
      if (!t) continue;
      thetaFills += t.fills;
      thetaPending ||= t.pending;
      thetaIncomplete ||= t.incomplete;
      if (t.risky > ZERO) thetaTotals.set(leg.risky.address.toLowerCase(), (thetaTotals.get(leg.risky.address.toLowerCase()) ?? ZERO) + t.risky);
      if (t.stable > ZERO) thetaTotals.set(leg.stable.address.toLowerCase(), (thetaTotals.get(leg.stable.address.toLowerCase()) ?? ZERO) + t.stable);
    }

    const deltaTotals = new Map<string, bigint>();
    for (const leg of legs) {
      if (leg.status === 'docked') continue;
      const key = leg.risky.address.toLowerCase();
      deltaTotals.set(key, (deltaTotals.get(key) ?? ZERO) + leg.reserveRisky);
    }

    const byAddress = (map: Map<string, bigint>) =>
      [...map.entries()]
        .map(([key, amount]) => ({ token: tokensWithClaims.find((t) => t.address.toLowerCase() === key), amount }))
        .filter((e): e is { token: BookTokenView; amount: bigint } => e.token !== undefined && e.amount > ZERO)
        .sort((a, b) => (a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1));

    const cutoff = blockTimestamp !== undefined ? blockTimestamp - DAY_SECONDS : undefined;
    let fills24h = 0;
    let lastFillAt: bigint | undefined;
    for (const fill of fillsQuery.fills) {
      const stamp = fillsQuery.theta.get(`${fill.transactionHash.toLowerCase()}:${fill.logIndex}`)?.timestamp;
      if (stamp === undefined) continue;
      if (lastFillAt === undefined || stamp > lastFillAt) lastFillAt = stamp;
      if (cutoff !== undefined && stamp >= cutoff) fills24h += 1;
    }

    return {
      writtenMultiple: writtenToken?.writtenMultiple ?? 0,
      writtenToken,
      backed: backedToken?.backed ?? 1,
      backedToken,
      thetaByToken: byAddress(thetaTotals),
      thetaFills,
      thetaPending,
      thetaIncomplete,
      deltaByToken: byAddress(deltaTotals),
      fills24h,
      lastFillAt,
    };
  }, [tokensWithClaims, legs, fillsQuery.fills, fillsQuery.theta, blockTimestamp]);

  return {
    legs,
    tokens: tokensWithClaims,
    kpis,
    fills: fillsQuery.fills,
    foreignStrategies,
    deployments,
    blockNumber,
    blockTimestamp,
    routerHasViews,
    isLoading: deploymentsLoading || strategiesQuery.isLoading || (enabled && blockNumber === undefined) || one.isLoading,
    isFetching: strategiesQuery.isFetching || one.isFetching || two.isFetching || fillsQuery.isFetching || fillsQuery.isPricing,
    error: deploymentsError ?? strategiesQuery.error ?? one.error ?? fillsQuery.error,
    refetch: () => {
      void strategiesQuery.refetch();
      void one.refetch();
      void two.refetch();
      fillsQuery.refetch();
    },
  };
}
