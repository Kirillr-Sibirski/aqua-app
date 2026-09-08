'use client';

/**
 * The read layer, assembled.
 *
 * Three sources, and the screen says which one answered:
 *
 *   1. **the subgraph** — preferred, because Aqua's events carry no indexed parameters and a direct
 *      scan cannot push the filter into the node;
 *   2. **the logs** — the same `Shipped` events read straight through viem and decoded with the same
 *      byte offsets, so the demo never waits on external infrastructure;
 *   3. **`SurfaceLens`** — a single `eth_call` that prices whatever the first two found.
 *
 * The first two are alternatives; the third enriches either. Everything the surface itself needs —
 * strike, implied vol, expiry, liquidity, reserves — is decoded rather than computed, so the chart
 * is complete even when the lens is unreachable. The mark, the premium and the theta band are what
 * the lens adds, and they are simply absent when it is not there rather than guessed at.
 *
 * The lens read is pinned to the same block as the log read, so a fill and the depth it consumed
 * are never shown one block apart.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { Address, Hex, PublicClient } from 'viem';
import { useBlock, useConnection, usePublicClient } from 'wagmi';
import { aquaFork } from '@/lib/chain';
import { useDeployments, useShippedStrategies } from '@/hooks';
import { censusOf, decodeSurface, groupSurface } from './decode';
import { pricingOf, readBook } from './lens';
import { SUBGRAPH_URL, fetchSubgraphSurface } from './subgraph';
import type { SurfaceCensus, SurfaceLeg, SurfacePoint, SurfaceSource } from './types';

/** Legs per `book()` call. At ~343k gas a leg, twenty sits an order of magnitude under any cap. */
const LENS_BATCH = 20;

export interface UseSurfaceOptions {
  /** ms between refreshes of the leg set. Legs change on a ship or a dock, not per block. */
  refetchInterval?: number | false;
  enabled?: boolean;
}

export interface UseSurfaceReturn {
  legs: SurfaceLeg[];
  points: SurfacePoint[];
  census: SurfaceCensus;
  source: SurfaceSource;
  /** How the lens was reached, or why it was not. */
  lensVia?: 'deployed' | 'deployless';
  lensError?: Error;
  /** True once at least one leg carries chain pricing. */
  priced: boolean;
  /** The block every number on the screen was read at. */
  blockNumber?: bigint;
  /** The chain's own clock, which is what a warped fork moves. Never `Date.now()`. */
  nowSeconds?: number;
  /** Set when the subgraph was configured but did not answer; the logs took over. */
  subgraphError?: Error;
  /** How far the index has caught up, when the subgraph answered. */
  indexedBlock?: bigint;
  isLoading: boolean;
  isFetching: boolean;
  error?: Error;
  refetch: () => void;
}

export function useSurface(options: UseSurfaceOptions = {}): UseSurfaceReturn {
  const enabled = options.enabled ?? true;
  const client = usePublicClient({ chainId: aquaFork.id });
  const { address } = useConnection();
  const { deployments, isLoading: deploymentsLoading, error: deploymentsError } = useDeployments();

  // One clock for the whole screen, and it is the chain's. A countdown drawn from `Date.now()`
  // walks away from the curve the moment a fork's time is warped, and the curve reads
  // `block.timestamp`. It also pins the lens read, so a fill and the depth it consumed are never
  // shown one block apart.
  const { data: block } = useBlock({ chainId: aquaFork.id, watch: true, query: { enabled } });
  const blockNumber = block?.number;
  const nowSeconds = block ? Number(block.timestamp) : undefined;

  // ---- source 1: the subgraph
  const subgraphQuery = useQuery({
    queryKey: ['surface', 'subgraph', SUBGRAPH_URL, address ?? 'anon'],
    queryFn: ({ signal }) => fetchSubgraphSurface(SUBGRAPH_URL as string, address, { signal }),
    enabled: enabled && !!SUBGRAPH_URL,
    refetchInterval: options.refetchInterval ?? 8000,
    retry: false,
  });

  // ---- source 2: the logs. Always armed, so a subgraph that stops answering is a non-event.
  const logsQuery = useShippedStrategies(undefined, {
    all: true,
    refetchInterval: subgraphQuery.data ? false : (options.refetchInterval ?? 8000),
  });

  const fromLogs = useMemo(() => {
    const { legs, skipped } = decodeSurface(logsQuery.strategies, address);
    const strategies = new Map<string, Hex>();
    for (const s of logsQuery.strategies) strategies.set(s.strategyHash.toLowerCase(), s.strategy);
    return { legs, strategies, foreign: skipped['no-rmm'] + skipped.malformed };
  }, [logsQuery.strategies, address]);

  const useSubgraph = !!subgraphQuery.data;
  const source: SurfaceSource = useSubgraph ? 'subgraph' : 'logs';
  const baseLegs = useSubgraph ? subgraphQuery.data!.legs : fromLogs.legs;
  const strategies = useSubgraph ? subgraphQuery.data!.strategies : fromLogs.strategies;

  // ---- source 3: the lens, pinned to the watched block
  const lensAddress = resolveLensAddress(deployments?.extra);
  const hashes = useMemo(() => baseLegs.map((l) => l.strategyHash.toLowerCase()).join(','), [baseLegs]);

  const lensQuery = useQuery({
    queryKey: ['surface', 'lens', deployments?.router, lensAddress, blockNumber?.toString(), hashes],
    queryFn: async () => {
      if (!client || !deployments) throw new Error('not ready');
      const payloads: Hex[] = [];
      const order: Hex[] = [];
      for (const leg of baseLegs) {
        const bytes = strategies.get(leg.strategyHash.toLowerCase());
        if (!bytes) continue;
        payloads.push(bytes);
        order.push(leg.strategyHash);
      }
      return priceBook(client as PublicClient, {
        aqua: deployments.aqua,
        app: deployments.router,
        address: lensAddress,
        blockNumber,
        payloads,
        order,
      });
    },
    enabled: enabled && !!client && !!deployments && baseLegs.length > 0,
    retry: false,
    // The mark moves with the block clock even when nothing trades, so this follows the block
    // rather than a timer: `blockNumber` is in the key.
    staleTime: Infinity,
  });

  const legs = useMemo(() => {
    const priced = lensQuery.data?.pricing;
    if (!priced) return baseLegs;
    return baseLegs.map((leg) => {
      const pricing = priced.get(leg.strategyHash.toLowerCase());
      return pricing ? { ...leg, pricing } : leg;
    });
  }, [baseLegs, lensQuery.data]);

  const points = useMemo(() => groupSurface(legs), [legs]);
  const census = useMemo(
    () => censusOf(legs, useSubgraph ? 0 : fromLogs.foreign),
    [legs, useSubgraph, fromLogs.foreign],
  );

  const fatal = deploymentsError ?? (useSubgraph ? undefined : (logsQuery.error as Error | undefined));

  return {
    legs,
    points,
    census,
    source,
    lensVia: lensQuery.data?.via,
    lensError: lensQuery.error as Error | undefined,
    priced: !!lensQuery.data && lensQuery.data.pricing.size > 0,
    blockNumber,
    nowSeconds,
    subgraphError: SUBGRAPH_URL && subgraphQuery.error ? (subgraphQuery.error as Error) : undefined,
    indexedBlock: subgraphQuery.data?.indexedBlock,
    isLoading: deploymentsLoading || (useSubgraph ? subgraphQuery.isLoading : logsQuery.isLoading),
    isFetching: subgraphQuery.isFetching || logsQuery.isFetching || lensQuery.isFetching,
    error: fatal ?? undefined,
    refetch: () => {
      void subgraphQuery.refetch();
      void logsQuery.refetch();
      void lensQuery.refetch();
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** A deployed lens, if the manifest or the environment names one. */
function resolveLensAddress(extra: Record<string, unknown> | undefined): Address | undefined {
  const fromEnv = process.env.NEXT_PUBLIC_SURFACE_LENS;
  const candidate = typeof extra?.surfaceLens === 'string' ? extra.surfaceLens : fromEnv;
  if (!candidate || !/^0x[0-9a-fA-F]{40}$/.test(candidate)) return undefined;
  return candidate as Address;
}

interface PriceBookParams {
  aqua: Address;
  app: Address;
  address?: Address;
  blockNumber?: bigint;
  payloads: Hex[];
  order: Hex[];
}

/** Price every leg, in batches, all at the one block the rest of the screen is reading. */
async function priceBook(client: PublicClient, params: PriceBookParams) {
  const pricing = new Map<string, NonNullable<SurfaceLeg['pricing']>>();
  let via: 'deployed' | 'deployless' = params.address ? 'deployed' : 'deployless';

  for (let i = 0; i < params.payloads.length; i += LENS_BATCH) {
    const slice = params.payloads.slice(i, i + LENS_BATCH);
    const result = await readBook(client, {
      aqua: params.aqua,
      app: params.app,
      address: params.address,
      blockNumber: params.blockNumber,
      strategies: slice,
    });
    via = result.via;
    result.legs.forEach((row, j) => {
      const priced = pricingOf(row);
      if (priced) pricing.set(params.order[i + j].toLowerCase(), priced);
    });
  }

  return { pricing, via };
}
