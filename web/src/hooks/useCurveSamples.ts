/**
 * The curve, sampled from the chain.
 *
 * Every point returned here is `StrikelineViews.stableFor(K, sigma, T, L, x)` — the router's own
 * trading function, evaluated with the router's own approximated `Phi`, rounded the way the
 * instruction rounds it. Nothing is modelled and nothing is interpolated in TypeScript beyond the
 * straight line the renderer draws between two measured points.
 *
 * That is the whole reason this hook exists rather than a `stableOf()` port. A wei-exact
 * reimplementation of A&S erf plus a bisected inverse CDF is the single most likely way to make an
 * on-screen curve disagree with the chain, and the disagreement would show up as a chart that
 * refuses trades it says are fine. Sampling costs one multicall.
 *
 * `maturity` is a parameter rather than a fact, which is what makes the time scrubber honest: to
 * see the curve at `tau = 2 days` you ask the chain for the curve of a leg maturing in two days,
 * and to see the settlement line you ask for one that has already matured — the `tau == 0` branch
 * then returns the closed form `Y = K*(L - X)` without touching the Gaussian at all.
 */
import { useMemo } from 'react';
import { formatUnits, type Address } from 'viem';
import { useReadContracts } from 'wagmi';
import { aquaFork, type SupportedChainId } from '@/lib/chain';
import { strikelineViewsAbi } from '@/components/curve/rmm';

/** One measured point on the trading function, in normalised WAD units and as floats to draw with. */
export interface CurveSample {
  /** Risky reserve, WAD. */
  xWad: bigint;
  /** Stable reserve the curve requires there, WAD, as the router rounds it. */
  yWad: bigint;
  /** The same pair as doubles, for the d3 scales. Display only. */
  x: number;
  y: number;
}

export interface UseCurveSamplesParams {
  /** The Strikeline router. `StrikelineViews` is a mixin on it, not a separate contract. */
  router?: Address;
  strikeWad?: bigint;
  sigmaWad?: bigint;
  /** Unix seconds. Pass a synthetic value to sample the curve at a different `tau`. */
  maturity?: number;
  liquidityWad?: bigint;
  /**
   * Points across `x in [0, L]`. Each one is an `eth_call` inside a single multicall, and each call
   * runs a 40-step bisection of `Phi`, so this trades gas for smoothness. 48 draws a clean curve at
   * any width a terminal uses.
   */
  samples?: number;
  chainId?: SupportedChainId;
  enabled?: boolean;
}

export interface UseCurveSamplesResult {
  samples: CurveSample[];
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
}

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/** `x` values to ask for: evenly spaced across the domain, both endpoints included. */
function grid(liquidityWad: bigint, samples: number): bigint[] {
  const n = Math.max(2, Math.min(256, Math.floor(samples)));
  const out: bigint[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    // Integer arithmetic throughout, and the last point is L exactly: `stableOf` reverts
    // `RmmOutOfDomain` above L, and a float step would eventually land one wei past it.
    out[i] = i === n - 1 ? liquidityWad : (liquidityWad * BigInt(i)) / BigInt(n - 1);
  }
  return out;
}

export function useCurveSamples({
  router,
  strikeWad,
  sigmaWad,
  maturity,
  liquidityWad,
  samples = 48,
  chainId = aquaFork.id,
  enabled = true,
}: UseCurveSamplesParams): UseCurveSamplesResult {
  const ready =
    enabled &&
    !!router &&
    strikeWad !== undefined &&
    sigmaWad !== undefined &&
    maturity !== undefined &&
    liquidityWad !== undefined &&
    liquidityWad > BigInt(0);

  const xs = useMemo(
    () => (liquidityWad !== undefined && liquidityWad > BigInt(0) ? grid(liquidityWad, samples) : []),
    [liquidityWad, samples],
  );

  const contracts = useMemo(
    () =>
      xs.map(
        (xWad) =>
          ({
            address: router ?? ZERO_ADDRESS,
            abi: strikelineViewsAbi,
            functionName: 'stableFor',
            args: [
              strikeWad ?? BigInt(0),
              sigmaWad ?? BigInt(0),
              maturity ?? 0,
              liquidityWad ?? BigInt(0),
              xWad,
            ],
            chainId,
          }) as const,
      ),
    [xs, router, strikeWad, sigmaWad, maturity, liquidityWad, chainId],
  );

  const query = useReadContracts({
    contracts,
    allowFailure: false,
    query: {
      enabled: ready && contracts.length > 0,
      // A curve at a fixed maturity is a pure function of its parameters, so once a scrub position
      // has been sampled it never has to be sampled again.
      staleTime: Infinity,
      gcTime: 5 * 60_000,
      retry: false,
    },
  });

  const result = useMemo<CurveSample[]>(() => {
    if (!query.data) return [];
    return xs.map((xWad, i) => {
      const yWad = query.data[i] as bigint;
      return {
        xWad,
        yWad,
        x: Number(formatUnits(xWad, 18)),
        y: Number(formatUnits(yWad, 18)),
      };
    });
  }, [query.data, xs]);

  return {
    samples: result,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: (query.error as Error | null) ?? null,
    refetch: () => {
      void query.refetch();
    },
  };
}
