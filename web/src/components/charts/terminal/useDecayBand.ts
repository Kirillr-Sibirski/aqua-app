'use client';

/**
 * `bandFor` across the leg's remaining life, in one multicall.
 *
 * With liquidity fixed and no invariant offset, a leg's reserves sit exactly ON its curve the
 * moment it is published. Time then moves the curve away from them in both directions at once, and
 * a trade only clears once it is big enough to close that distance. The distance IS the premium:
 * whoever crosses it hands it to the maker, and nobody signed anything to open it.
 *
 * Each point asks the router what the smallest clearing trade would be on a leg with the same
 * `K`, `sigma`, `L` and the same reserves but that much less time left — which is exactly the leg
 * this one becomes if nobody touches it. The reserves are deliberately held fixed: a trade in
 * between moves the reserve point back onto the curve and resets the gap to nothing, which is the
 * mechanism the view is about.
 *
 * This mirrors the offer screen's own `useBandSeries` read — same call, same arguments, same
 * caching — and lives here so the terminal chart depends on nothing outside `src/hooks`,
 * `src/lib` and its own directory.
 */
import { useMemo } from 'react';
import { formatUnits, type Address } from 'viem';
import { useReadContracts } from 'wagmi';
import { strikelineReadAbi } from '@/components/curve/rmm';
import { aquaFork, type SupportedChainId } from '@/lib/chain';
import { decayGrid, snapAnchor, type DecayGridPoint } from './decay';

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

export interface DecayPoint extends DecayGridPoint {
  /** Smallest risky input that clears at that point, normalised WAD. */
  minRiskyInWad: bigint;
  /** Smallest stable input that clears, normalised WAD. */
  minStableInWad: bigint;
  /** The same two as doubles, for the scales. Display only. */
  risky: number;
  stable: number;
}

export interface UseDecayBandParams {
  router?: Address;
  strikeWad?: bigint;
  sigmaWad?: bigint;
  liquidityWad?: bigint;
  maturity?: number;
  /** The live reserve point, normalised WAD. Held fixed across the series on purpose. */
  xWad?: bigint;
  yWad?: bigint;
  /** The chain's clock, seconds. */
  nowSeconds?: number;
  /** Points across the remaining life. Each is one `eth_call` inside one multicall. */
  samples?: number;
  chainId?: SupportedChainId;
  enabled?: boolean;
}

export interface UseDecayBandResult {
  points: DecayPoint[];
  isLoading: boolean;
  error: Error | null;
}

export function useDecayBand({
  router,
  strikeWad,
  sigmaWad,
  liquidityWad,
  maturity,
  xWad,
  yWad,
  nowSeconds,
  samples = 25,
  chainId = aquaFork.id,
  enabled = true,
}: UseDecayBandParams): UseDecayBandResult {
  const grid = useMemo(() => {
    if (nowSeconds === undefined || maturity === undefined) return [];
    return decayGrid(maturity, snapAnchor(nowSeconds), samples);
  }, [nowSeconds, maturity, samples]);

  const ready =
    enabled &&
    !!router &&
    strikeWad !== undefined &&
    sigmaWad !== undefined &&
    liquidityWad !== undefined &&
    liquidityWad > BigInt(0) &&
    xWad !== undefined &&
    yWad !== undefined &&
    grid.length > 0;

  const contracts = useMemo(
    () =>
      grid.map(
        (point) =>
          ({
            address: router ?? ZERO_ADDRESS,
            abi: strikelineReadAbi,
            functionName: 'bandFor',
            args: [
              strikeWad ?? BigInt(0),
              sigmaWad ?? BigInt(0),
              point.maturity,
              liquidityWad ?? BigInt(0),
              xWad ?? BigInt(0),
              yWad ?? BigInt(0),
            ],
            chainId,
          }) as const,
      ),
    [grid, router, strikeWad, sigmaWad, liquidityWad, xWad, yWad, chainId],
  );

  const query = useReadContracts({
    contracts,
    allowFailure: false,
    query: {
      enabled: ready,
      // The anchor is snapped to ten minutes, so the key survives a block; the poll is what keeps
      // the live end of the series honest as the chain clock walks toward the next anchor.
      staleTime: 30_000,
      refetchInterval: 60_000,
      gcTime: 5 * 60_000,
      retry: false,
    },
  });

  const points = useMemo<DecayPoint[]>(() => {
    if (!query.data) return [];
    return grid.map((point, i) => {
      const [minRiskyInWad, minStableInWad] = query.data[i] as readonly [bigint, bigint];
      return {
        ...point,
        minRiskyInWad,
        minStableInWad,
        risky: Number(formatUnits(minRiskyInWad, 18)),
        stable: Number(formatUnits(minStableInWad, 18)),
      };
    });
  }, [query.data, grid]);

  return { points, isLoading: query.isLoading, error: (query.error as Error | null) ?? null };
}
