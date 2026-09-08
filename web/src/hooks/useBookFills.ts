'use client';

/**
 * Fills, and the theta they actually paid.
 *
 * "Theta captured" is the number a vol seller is judged on, and it is the easiest number in DeFi to
 * fake: evaluate Black-Scholes at whatever inputs flatter the position and print the difference.
 * This hook refuses to do that. It measures.
 *
 * The measurement rests on one property of the curve. Liquidity is fixed and the invariant offset
 * is zero, so a leg's reserves sit exactly ON the curve at the moment they land. As tau falls the
 * curve moves away from that stale point in both directions, and a trade only clears once it is
 * large enough to close the gap. `StrikelineViews.bandFor` publishes that gap. So the accrued theta
 * at any instant is the band, and the theta a taker paid is the band that stood in front of them
 * when their transaction executed.
 *
 * Which means realised theta is recoverable exactly, from the chain, for every fill that ever
 * happened:
 *
 *   1. Aqua's `Pushed`/`Pulled` stream is a complete record of a strategy's virtual reserves — the
 *      ship amount, every token a taker paid in, every token the maker delivered. Folding it gives
 *      the reserves as they stood immediately before any given transaction, with no archive call.
 *   2. `bandFor` is a pure function of the leg's terms, those reserves, and `block.timestamp`. So
 *      calling it *at the fill's own block*, with the pre-fill reserves, reproduces the exact band
 *      that taker had to clear.
 *
 * Anything the taker paid beyond the band is movement along the curve, not premium, so the band is
 * the whole of the theta and none of the slippage. Each fill lands the reserves back on the curve,
 * so summing the bands telescopes into the total decay the leg has collected over its life.
 *
 * Per-fill results are immutable history and are cached as such: a new fill costs one call, not a
 * rescan.
 */
import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getAbiItem, type Address, type Hex, type PublicClient } from 'viem';
import { usePublicClient } from 'wagmi';
import { aquaFork } from '@/lib/chain';
import { aquaAbi, swapVmAbi } from '@/lib/contracts';
import {
  compareChainOrder,
  fromWad,
  replayReserves,
  reserveAt,
  strikelineViewsAbi,
  type ReserveDelta,
  type RmmArgs,
} from './strikeline';

const ZERO = BigInt(0);

const swappedEvent = getAbiItem({ abi: swapVmAbi, name: 'Swapped' });
const pushedEvent = getAbiItem({ abi: aquaAbi, name: 'Pushed' });
const pulledEvent = getAbiItem({ abi: aquaAbi, name: 'Pulled' });

/** What a leg has to be for its fills to be priced: its terms and which token is which. */
export interface FillableLeg {
  strategyHash: Hex;
  rmm: RmmArgs;
  risky: Address;
  stable: Address;
}

export interface BookFill {
  /** Aqua's strategy hash and SwapVM's order hash are the same 32 bytes. */
  orderHash: Hex;
  taker: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOut: bigint;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hex;
  /** Reserves as they stood immediately before this transaction, in token units. */
  reserveRiskyBefore: bigint;
  reserveStableBefore: bigint;
}

export interface FillTheta {
  /** Chain timestamp of the fill's block. */
  timestamp?: bigint;
  /** The band this fill had to clear, in the units of the token the taker paid in. */
  paid?: bigint;
  token?: Address;
  /** Set when the band could not be replayed (no views on this router, or a pruned block). */
  error?: unknown;
}

export interface UseBookFillsOptions {
  /** Re-scan the log range whenever this changes. Pass the watched block so the tape is live. */
  blockNumber?: bigint;
  enabled?: boolean;
}

/** Realised theta for one leg, split by the token it was paid in. */
export interface LegTheta {
  risky: bigint;
  stable: bigint;
  fills: number;
  /** True while at least one fill's band is still being replayed. */
  pending: boolean;
  /** True when at least one fill's band could not be read at all. */
  incomplete: boolean;
}

export interface UseBookFillsReturn {
  fills: BookFill[];
  /** Per fill, keyed by `${transactionHash}:${logIndex}`. */
  theta: Map<string, FillTheta>;
  /** Per leg, keyed by lowercase strategy hash. */
  byLeg: Map<string, LegTheta>;
  isLoading: boolean;
  isFetching: boolean;
  /** True while any per-fill band replay is still in flight. */
  isPricing: boolean;
  error: unknown;
  refetch: () => void;
}

function fillKey(fill: BookFill): string {
  return `${fill.transactionHash.toLowerCase()}:${fill.logIndex}`;
}

/**
 * Scan the log range for this maker's fills, and reconstruct the reserves each one hit.
 *
 * `Swapped` comes from our router (it carries the taker and both amounts); the reserve trajectory
 * comes from Aqua's own `Pushed`/`Pulled`, because those are the only events that see a ship. None
 * of the three has indexed parameters, so the filtering is client-side — the same shape
 * `fetchShippedStrategiesDetailed` already uses for `Shipped`.
 */
async function scanFills(
  client: PublicClient,
  params: { aqua: Address; router: Address; maker: Address; fromBlock: bigint; legs: readonly FillableLeg[] },
): Promise<BookFill[]> {
  const { aqua, router, maker, fromBlock, legs } = params;
  const byHash = new Map(legs.map((l) => [l.strategyHash.toLowerCase(), l]));
  const toBlock = await client.getBlockNumber();

  const [swapped, pushed, pulled] = await Promise.all([
    client.getLogs({ address: router, event: swappedEvent, fromBlock, toBlock, strict: true }),
    client.getLogs({ address: aqua, event: pushedEvent, fromBlock, toBlock, strict: true }),
    client.getLogs({ address: aqua, event: pulledEvent, fromBlock, toBlock, strict: true }),
  ]);

  const isOurs = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

  const deltas: ReserveDelta[] = [];
  for (const log of pushed) {
    if (!isOurs(log.args.app, router) || !isOurs(log.args.maker, maker)) continue;
    if (!byHash.has(log.args.strategyHash.toLowerCase())) continue;
    deltas.push({
      strategyHash: log.args.strategyHash,
      token: log.args.token,
      amount: log.args.amount,
      blockNumber: log.blockNumber,
      logIndex: log.logIndex,
      transactionHash: log.transactionHash,
    });
  }
  for (const log of pulled) {
    if (!isOurs(log.args.app, router) || !isOurs(log.args.maker, maker)) continue;
    if (!byHash.has(log.args.strategyHash.toLowerCase())) continue;
    deltas.push({
      strategyHash: log.args.strategyHash,
      token: log.args.token,
      amount: -log.args.amount,
      blockNumber: log.blockNumber,
      logIndex: log.logIndex,
      transactionHash: log.transactionHash,
    });
  }

  const raw = swapped
    .filter((log) => isOurs(log.args.maker, maker) && byHash.has(log.args.orderHash.toLowerCase()))
    .map((log) => ({
      orderHash: log.args.orderHash,
      taker: log.args.taker,
      tokenIn: log.args.tokenIn,
      tokenOut: log.args.tokenOut,
      amountIn: log.args.amountIn,
      amountOut: log.args.amountOut,
      blockNumber: log.blockNumber,
      logIndex: log.logIndex,
      transactionHash: log.transactionHash,
    }));

  // Replay each leg's own reserve stream, snapshotting at the transactions that filled it.
  const fills: BookFill[] = [];
  for (const [key, leg] of byHash) {
    const legFills = raw.filter((f) => f.orderHash.toLowerCase() === key);
    if (legFills.length === 0) continue;
    const legDeltas = deltas.filter((d) => d.strategyHash.toLowerCase() === key);
    const snapshots = replayReserves(legDeltas, new Set(legFills.map((f) => f.transactionHash.toLowerCase())));
    for (const fill of legFills) {
      const before = snapshots.get(fill.transactionHash.toLowerCase());
      fills.push({
        ...fill,
        reserveRiskyBefore: reserveAt(before, leg.risky),
        reserveStableBefore: reserveAt(before, leg.stable),
      });
    }
  }

  return fills.sort((a, b) => -compareChainOrder(a, b));
}

/**
 * Fills for a maker's book, each priced with the theta it paid.
 *
 * Returns empty rather than throwing whenever the inputs are not ready, so a caller can render the
 * disconnected and loading states without branching on undefined.
 */
export function useBookFills(
  params: {
    maker?: Address;
    aqua?: Address;
    router?: Address;
    fromBlock?: bigint;
    legs: readonly FillableLeg[];
  },
  options: UseBookFillsOptions = {},
): UseBookFillsReturn {
  const client = usePublicClient({ chainId: aquaFork.id });
  const { maker, aqua, router, fromBlock, legs } = params;

  // The leg set changes only on a ship or a dock, so it keys the scan by identity rather than by
  // the array reference react re-creates on every render.
  const legsKey = legs.map((l) => l.strategyHash).join(',');

  const enabled = (options.enabled ?? true) && !!client && !!maker && !!aqua && !!router && fromBlock !== undefined && legs.length > 0;

  const scan = useQuery({
    queryKey: ['book', 'fills', router, maker, legsKey, options.blockNumber?.toString() ?? 'latest'],
    queryFn: async () => {
      if (!client || !maker || !aqua || !router || fromBlock === undefined) throw new Error('not ready');
      return scanFills(client as PublicClient, { aqua, router, maker, fromBlock, legs });
    },
    enabled,
    // A fill that has been mined never changes; keeping the previous tape avoids a flash of empty
    // rows every time the watched block advances.
    placeholderData: (previous) => previous,
  });

  const fills = useMemo(() => scan.data ?? [], [scan.data]);
  const legByHash = useMemo(() => new Map(legs.map((l) => [l.strategyHash.toLowerCase(), l])), [legs]);

  /**
   * One query per fill, each pinned to that fill's own block and cached forever: the band a
   * transaction faced is history, and history does not need re-reading.
   */
  const replays = useQueries({
    queries: fills.map((fill) => {
      const leg = legByHash.get(fill.orderHash.toLowerCase());
      return {
        queryKey: ['book', 'fillTheta', router, fill.transactionHash, fill.logIndex],
        queryFn: async (): Promise<FillTheta> => {
          if (!client || !router || !leg) throw new Error('not ready');
          const { rmm } = leg;
          const [block, band] = await Promise.all([
            client.getBlock({ blockNumber: fill.blockNumber }),
            client.readContract({
              address: router,
              abi: strikelineViewsAbi,
              functionName: 'bandFor',
              args: [
                rmm.strikeWad,
                rmm.sigmaWad,
                rmm.maturity,
                rmm.liquidityWad,
                fill.reserveRiskyBefore * rmm.rateRisky,
                fill.reserveStableBefore * rmm.rateStable,
              ],
              blockNumber: fill.blockNumber,
            }),
          ]);
          const [minRiskyIn, minStableIn] = band;
          const paidRisky = fill.tokenIn.toLowerCase() === leg.risky.toLowerCase();
          return {
            timestamp: block.timestamp,
            paid: paidRisky ? fromWad(minRiskyIn, rmm.rateRisky) : fromWad(minStableIn, rmm.rateStable),
            token: paidRisky ? leg.risky : leg.stable,
          };
        },
        enabled: !!client && !!router && !!leg,
        staleTime: Infinity,
        gcTime: Infinity,
        retry: false,
      };
    }),
  });

  // Both maps are folded on every render rather than memoised: `useQueries` hands back a fresh
  // array each time, so a memo over it would recompute anyway while pretending not to. A book is a
  // handful of legs and a handful of fills, and this is a pair of loops over them.
  const theta = new Map<string, FillTheta>();
  fills.forEach((fill, i) => {
    const result = replays[i];
    if (!result) return;
    theta.set(fillKey(fill), result.data ?? (result.error ? { error: result.error } : {}));
  });

  const byLeg = new Map<string, LegTheta>();
  for (const fill of fills) {
    const key = fill.orderHash.toLowerCase();
    const leg = legByHash.get(key);
    const entry = byLeg.get(key) ?? { risky: ZERO, stable: ZERO, fills: 0, pending: false, incomplete: false };
    entry.fills += 1;
    const t = theta.get(fillKey(fill));
    if (t?.error) {
      entry.incomplete = true;
    } else if (t?.paid !== undefined && t.token && leg) {
      if (t.token.toLowerCase() === leg.risky.toLowerCase()) entry.risky += t.paid;
      else entry.stable += t.paid;
    } else {
      entry.pending = true;
    }
    byLeg.set(key, entry);
  }

  return {
    fills,
    theta,
    byLeg,
    isLoading: scan.isLoading,
    isFetching: scan.isFetching,
    isPricing: replays.some((r) => r.isPending || r.isFetching),
    error: scan.error,
    refetch: () => void scan.refetch(),
  };
}
