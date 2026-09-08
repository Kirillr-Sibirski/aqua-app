'use client';

/**
 * The reads a leg detail screen needs beyond the curve itself: the block clock's `tau`, the accrued
 * theta band, the wallet's deliverable depth, and the fills that walked the reserve point to where
 * it is now.
 *
 * All four are chain reads. In particular the band is `StrikelineViews.bandFor()` rather than a
 * difference computed here, and realised fills are reconstructed from Aqua's own `Pushed`/`Pulled`
 * logs rather than from a model of what a fill should have done.
 */
import { useEffect, useMemo, useState } from 'react';
import { getAbiItem, type Address, type Hex, type PublicClient } from 'viem';
import { useQuery } from '@tanstack/react-query';
import { usePublicClient, useReadContract, useReadContracts } from 'wagmi';
import { aquaFork, type SupportedChainId } from '@/lib/chain';
import { aquaAbi } from '@/lib/contracts';
import { strikelineViewsAbi } from './rmm';

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

// ---------------------------------------------------------------------------
// tau
// ---------------------------------------------------------------------------

/**
 * `tau` in years (WAD) as the curve currently sees it: floored at one hour, and zero once matured,
 * which is what switches the leg into its settlement branch.
 *
 * Read from the router rather than from `Date.now()` because on a fork the two disagree by design —
 * `evm_increaseTime` is how the demo ages a position, and a screen that trusted the browser clock
 * would keep drawing yesterday's curve.
 */
export function useTauNow(
  router: Address | undefined,
  maturity: number | undefined,
  options: { chainId?: SupportedChainId; refetchInterval?: number | false } = {},
) {
  const query = useReadContract({
    address: router ?? ZERO_ADDRESS,
    abi: strikelineViewsAbi,
    functionName: 'tauNow',
    args: [maturity ?? 0],
    chainId: options.chainId ?? aquaFork.id,
    query: {
      enabled: !!router && maturity !== undefined,
      refetchInterval: options.refetchInterval ?? 8_000,
      retry: false,
    },
  });
  return { tauWad: query.data, isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}

// ---------------------------------------------------------------------------
// The theta band
// ---------------------------------------------------------------------------

export interface ThetaBand {
  /** Smallest risky input that clears, in normalised WAD. Zero when the curve has not moved. */
  minRiskyIn: bigint;
  /** Smallest stable input that clears, in normalised WAD. */
  minStableIn: bigint;
  /** Where the curve says the stable reserve should be at the live risky reserve. */
  yOnCurveWad: bigint;
  /** Where it says the risky reserve should be at the live stable reserve. */
  xOnCurveWad: bigint;
}

/**
 * The gap decay has opened between the stale reserve point and the current curve.
 *
 * With liquidity fixed and no invariant offset, reserves sit exactly on the curve at ship time and
 * the curve then moves away from them in both directions as `tau` falls. A trade only clears once
 * it is large enough to close that gap, so the gap *is* the premium: whoever crosses it pays the
 * accrued theta. Publishing it is what lets the UI shade it and an arbitrageur size analytically
 * instead of probing with reverting calls.
 */
export function useThetaBand(
  router: Address | undefined,
  params:
    | {
        strikeWad: bigint;
        sigmaWad: bigint;
        maturity: number;
        liquidityWad: bigint;
        xWad: bigint;
        yWad: bigint;
      }
    | undefined,
  options: { chainId?: SupportedChainId; refetchInterval?: number | false } = {},
) {
  const query = useReadContract({
    address: router ?? ZERO_ADDRESS,
    abi: strikelineViewsAbi,
    functionName: 'bandFor',
    args: params
      ? [params.strikeWad, params.sigmaWad, params.maturity, params.liquidityWad, params.xWad, params.yWad]
      : [BigInt(0), BigInt(0), 0, BigInt(0), BigInt(0), BigInt(0)],
    chainId: options.chainId ?? aquaFork.id,
    query: { enabled: !!router && !!params, refetchInterval: options.refetchInterval ?? 8_000, retry: false },
  });

  const band = useMemo<ThetaBand | undefined>(() => {
    if (!query.data || !params) return undefined;
    const [minRiskyIn, minStableIn] = query.data;
    return {
      minRiskyIn,
      minStableIn,
      yOnCurveWad: params.yWad + minStableIn,
      xOnCurveWad: params.xWad + minRiskyIn,
    };
  }, [query.data, params]);

  return { band, isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}

// ---------------------------------------------------------------------------
// Deliverable depth
// ---------------------------------------------------------------------------

/**
 * `min(balanceOf(maker), allowance(maker, AQUA))` per token, straight from the router.
 *
 * This is the number `Coverage` enforces inside the same call that prices a trade, which is why a
 * fill on one leg shrinks what its siblings can deliver in the same block. Reading the published
 * figure rather than recomputing `balanceOf ^ allowance` here keeps the screen and the guard on one
 * definition, haircut included.
 */
export function useCoverage(
  router: Address | undefined,
  maker: Address | undefined,
  tokens: readonly Address[],
  options: { chainId?: SupportedChainId; refetchInterval?: number | false } = {},
) {
  const chainId = options.chainId ?? aquaFork.id;
  const key = tokens.map((t) => t.toLowerCase()).join(',');
  const list = useMemo(() => (key ? (key.split(',') as Address[]) : []), [key]);

  const query = useReadContracts({
    contracts: list.map(
      (token) =>
        ({
          address: router ?? ZERO_ADDRESS,
          abi: strikelineViewsAbi,
          functionName: 'coverage',
          args: [maker ?? ZERO_ADDRESS, token],
          chainId,
        }) as const,
    ),
    allowFailure: false,
    query: {
      enabled: !!router && !!maker && list.length > 0,
      refetchInterval: options.refetchInterval ?? 4_000,
      retry: false,
    },
  });

  const free = useMemo<Record<string, bigint>>(() => {
    if (!query.data) return {};
    const out: Record<string, bigint> = {};
    list.forEach((token, i) => {
      out[token.toLowerCase()] = query.data[i] as bigint;
    });
    return out;
  }, [query.data, list]);

  return { free, isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}

// ---------------------------------------------------------------------------
// Fills
// ---------------------------------------------------------------------------

export interface LegFill {
  transactionHash: Hex;
  blockNumber: bigint;
  logIndex: number;
  /** Token the taker received, and how much (raw units). */
  outToken: Address;
  outAmount: bigint;
  /** Token the taker paid, and how much. Absent for a one-sided push. */
  inToken?: Address;
  inAmount: bigint;
  /** Virtual reserves immediately after this transaction, raw units, keyed by lowercase token. */
  reservesAfter: Record<string, bigint>;
}

export interface LegLedger {
  /** Virtual reserves as `ship` set them, raw units. */
  opening: Record<string, bigint>;
  fills: LegFill[];
}

/**
 * The reserve point's whole history, replayed from Aqua's ledger events.
 *
 * `Aqua.pull` decrements and `Aqua.push` increments the strategy's virtual balance on every fill,
 * so the curve's reserve point walks across fills by itself with no maker transaction and no
 * keeper. `ship` emits a `Pushed` for each opening balance, so the same replay yields both the
 * opening point and every point after it.
 *
 * None of Aqua's event arguments are indexed, so the filter is client-side.
 */
export function useLegFills(
  params: {
    aqua?: Address;
    app?: Address;
    maker?: Address;
    strategyHash?: Hex;
    fromBlock?: bigint;
  },
  options: { chainId?: SupportedChainId; refetchInterval?: number | false } = {},
) {
  const chainId = options.chainId ?? aquaFork.id;
  const client = usePublicClient({ chainId });
  const { aqua, app, maker, strategyHash, fromBlock } = params;
  const enabled = !!client && !!aqua && !!app && !!maker && !!strategyHash;

  const query = useQuery({
    queryKey: ['legFills', chainId, aqua, app, maker, strategyHash, fromBlock?.toString()],
    enabled,
    refetchInterval: options.refetchInterval ?? 5_000,
    queryFn: async (): Promise<LegLedger> => {
      if (!client || !aqua || !app || !maker || !strategyHash) throw new Error('not ready');
      return readLegLedger(client as PublicClient, {
        aqua,
        app,
        maker,
        strategyHash,
        fromBlock: fromBlock ?? BigInt(0),
      });
    },
  });

  return {
    opening: query.data?.opening ?? {},
    fills: query.data?.fills ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Framework-free replay, so a script or a test can call it without React. */
export async function readLegLedger(
  client: PublicClient,
  params: { aqua: Address; app: Address; maker: Address; strategyHash: Hex; fromBlock: bigint },
): Promise<LegLedger> {
  const shared = { address: params.aqua, fromBlock: params.fromBlock, toBlock: 'latest' as const, strict: true as const };
  const [pushed, pulled] = await Promise.all([
    client.getLogs({ ...shared, event: PUSHED_EVENT }),
    client.getLogs({ ...shared, event: PULLED_EVENT }),
  ]);

  type Entry = {
    kind: 'push' | 'pull';
    token: Address;
    amount: bigint;
    blockNumber: bigint;
    logIndex: number;
    transactionHash: Hex;
  };

  const entries: Entry[] = [];
  for (const [kind, logs] of [
    ['push', pushed],
    ['pull', pulled],
  ] as const) {
    for (const log of logs) {
      const a = log.args;
      if (!same(a.app, params.app) || !same(a.maker, params.maker) || a.strategyHash !== params.strategyHash) {
        continue;
      }
      entries.push({
        kind,
        token: a.token,
        amount: a.amount,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        transactionHash: log.transactionHash,
      });
    }
  }

  entries.sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
  );

  const reserves: Record<string, bigint> = {};
  const opening: Record<string, bigint> = {};
  const fills: LegFill[] = [];
  let openingTaken = false;
  let openingTx: Hex | undefined;

  for (const entry of entries) {
    const key = entry.token.toLowerCase();
    reserves[key] = (reserves[key] ?? BigInt(0)) + (entry.kind === 'push' ? entry.amount : -entry.amount);

    // The `ship` transaction is the one that emits pushes before any pull has been seen.
    if (!openingTaken) {
      if (entry.kind === 'push' && (openingTx === undefined || openingTx === entry.transactionHash)) {
        openingTx = entry.transactionHash;
        opening[key] = reserves[key];
        continue;
      }
      openingTaken = true;
    }

    if (entry.kind === 'pull') {
      fills.push({
        transactionHash: entry.transactionHash,
        blockNumber: entry.blockNumber,
        logIndex: entry.logIndex,
        outToken: entry.token,
        outAmount: entry.amount,
        inAmount: BigInt(0),
        reservesAfter: { ...reserves },
      });
      continue;
    }

    // A push after the opening is the taker's side of the fill immediately before it.
    const last = fills.at(-1);
    if (last && last.transactionHash === entry.transactionHash) {
      last.inToken = entry.token;
      last.inAmount = entry.amount;
      last.reservesAfter = { ...reserves };
    }
  }

  return { opening, fills };
}

/** Taken from the shipped ABI, not retyped, so a change upstream is a type error rather than a bug. */
const PUSHED_EVENT = getAbiItem({ abi: aquaAbi, name: 'Pushed' });
const PULLED_EVENT = getAbiItem({ abi: aquaAbi, name: 'Pulled' });

// ---------------------------------------------------------------------------
// Scrubbing
// ---------------------------------------------------------------------------

/**
 * Trailing value of `value`, settled `delay` ms after it stops changing.
 *
 * The time scrubber drives a multicall, and a drag produces sixty position changes a second. The
 * debounce is what keeps a drag to a handful of round trips; react-query's cache does the rest,
 * because a scrub position that has already been sampled never has to be sampled again.
 */
export function useDebounced<T>(value: T, delay = 120): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
