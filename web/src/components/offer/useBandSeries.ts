'use client';

/**
 * How the gap grows if nobody trades, sampled from `bandFor` at one synthetic maturity per point.
 *
 * This is the product's own sentence drawn as a line: *the longer nobody takes the offer, the more
 * the taker has to pay.* Each point asks the router what the minimum clearing trade would be on a
 * leg with the same K, sigma, L and the same reserves but that much less time left, which is
 * exactly the leg this one becomes if nobody touches it. Nothing is modelled and nothing is
 * interpolated: one `bandFor` per point, all of them inside a single multicall.
 *
 * The reserves are deliberately held fixed at their current values. That is the assumption the
 * chart is making and the caption says so — a trade in between moves the reserve point back onto
 * the curve and resets the gap to nothing, which is the whole mechanism.
 *
 * WHAT DOES NOT APPEAR HERE: the settlement point. At `tau = 0` the curve degenerates to the
 * constant-sum line and the gap jumps by an order of magnitude in one step, which would flatten
 * every point before it into the axis. The series runs to the tau floor and the caption carries the
 * jump as a number instead of drawing it as a spike.
 */
import { useMemo } from 'react';
import { formatUnits, type Address } from 'viem';
import { useReadContracts } from 'wagmi';
import { TAU_FLOOR_SECONDS, strikelineReadAbi } from '@/components/curve';
import { aquaFork, type SupportedChainId } from '@/lib/chain';

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/**
 * How coarsely the anchor time is snapped before it becomes a query key.
 *
 * `bandFor` reads `block.timestamp`, so a series anchored at the exact chain clock would re-key its
 * multicall on every block and re-fetch a dozen calls for a line whose shape has not visibly
 * changed. Ten minutes on a seven-day span is a quarter of one pixel.
 */
const ANCHOR_SNAP_SECONDS = 600;

export interface BandPoint {
  /** Seconds from now. 0 is the live gap. */
  after: number;
  /** Days from now, for the axis. */
  days: number;
  /** The synthetic maturity this point was read at. */
  maturity: number;
  /** Smallest input that clears, normalised WAD, both sides. */
  minRiskyIn: bigint;
  minStableIn: bigint;
  /** The same two as doubles, for the scales. Display only. */
  risky: number;
  stable: number;
}

export interface UseBandSeriesParams {
  router?: Address;
  strikeWad?: bigint;
  sigmaWad?: bigint;
  liquidityWad?: bigint;
  maturity?: number;
  /** Live reserves, normalised. Held fixed across the series on purpose. */
  xWad?: bigint;
  yWad?: bigint;
  /** The chain's clock. */
  chainNow?: number;
  /** Points across the remaining life. Each is one `eth_call` in one multicall. */
  samples?: number;
  chainId?: SupportedChainId;
  enabled?: boolean;
}

export function useBandSeries({
  router,
  strikeWad,
  sigmaWad,
  liquidityWad,
  maturity,
  xWad,
  yWad,
  chainNow,
  samples = 13,
  chainId = aquaFork.id,
  enabled = true,
}: UseBandSeriesParams): {
  points: BandPoint[];
  isLoading: boolean;
  error: Error | null;
} {
  const anchor =
    chainNow === undefined ? undefined : Math.floor(chainNow / ANCHOR_SNAP_SECONDS) * ANCHOR_SNAP_SECONDS;

  const grid = useMemo<{ after: number; maturity: number }[]>(() => {
    if (anchor === undefined || maturity === undefined) return [];
    // The last point is the tau floor, not the maturity: inside the floor the instruction stops
    // shortening tau, so every point past it would return the same number.
    const span = maturity - anchor - TAU_FLOOR_SECONDS;
    if (span <= 0) return [];
    const n = Math.max(2, Math.min(32, Math.floor(samples)));
    const out: { after: number; maturity: number }[] = [];
    for (let i = 0; i < n; i += 1) {
      const after = Math.floor((span * i) / (n - 1) / 60) * 60;
      const synthetic = maturity - after;
      if (out.at(-1)?.maturity !== synthetic) out.push({ after, maturity: synthetic });
    }
    return out;
  }, [anchor, maturity, samples]);

  const ready =
    enabled &&
    !!router &&
    strikeWad !== undefined &&
    sigmaWad !== undefined &&
    liquidityWad !== undefined &&
    xWad !== undefined &&
    yWad !== undefined &&
    grid.length > 0;

  const query = useReadContracts({
    contracts: grid.map(
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
    allowFailure: false,
    query: {
      enabled: ready,
      staleTime: 30_000,
      refetchInterval: 60_000,
      gcTime: 5 * 60_000,
      retry: false,
    },
  });

  const points = useMemo<BandPoint[]>(() => {
    if (!query.data) return [];
    return grid.map((point, i) => {
      const [minRiskyIn, minStableIn] = query.data[i] as readonly [bigint, bigint];
      return {
        after: point.after,
        days: point.after / 86_400,
        maturity: point.maturity,
        minRiskyIn,
        minStableIn,
        risky: Number(formatUnits(minRiskyIn, 18)),
        stable: Number(formatUnits(minStableIn, 18)),
      };
    });
  }, [query.data, grid]);

  return { points, isLoading: query.isLoading, error: (query.error as Error | null) ?? null };
}
