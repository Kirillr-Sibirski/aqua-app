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
 *
 * WHAT IS NOT CACHEABLE HERE: the answer, at a fixed `maturity`. `StrikelineViews._sNow` derives
 * `tau` from `block.timestamp`, so the same five arguments return a different curve at a different
 * block — measured on the fork at K 2600, sigma 60%, L 12, x = 0.7L and one fixed maturity:
 * 8,298.2340762776252304 at tau 0.02813984y and 8,478.9856053440663736 at tau 0.01917808y. That
 * drift *is* the product. A curve pinned as immutable would sit still through a time warp and the
 * decay the whole position is built on would never appear on screen. So samples refresh on a clock,
 * and only the settlement line — which is a closed form with no `tau` in it — is asked for once.
 */
import { useMemo } from 'react';
import { formatUnits, type Address } from 'viem';
import { useReadContracts } from 'wagmi';
import { aquaFork, type SupportedChainId } from '@/lib/chain';
import { strikelineReadAbi } from '@/components/curve/rmm';

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
  /**
   * How often to re-ask, in ms. `false` pins the answer forever, which is correct for one curve
   * and one only: the settlement line, whose closed form contains no `tau`. Everything else decays
   * with the block clock and has to be re-read, at the same cadence as the theta band beside it so
   * the wedge and the curve under it never come from two different times.
   */
  refreshMs?: number | false;
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

/**
 * A maturity that has always already passed, for asking the router what the settlement line is.
 *
 * `RmmSwap.tauOf` branches on `block.timestamp >= maturity` and, once it has, the trading function
 * is `Y = K*(L - X)` — a closed form that contains no `tau` at all. So every matured maturity
 * returns the *same* curve at every block, which makes this the one query in the file that is
 * genuinely immutable, and which one is asked for is free. Passing the live block timestamp would
 * be the obvious choice and is the wrong one: the timestamp changes every block, so the query key
 * changes every block, and a line that cannot move would be re-sampled with 48 `eth_call`s a block
 * forever. One is unix second 1, and it never moves.
 */
export const MATURED_MATURITY = 1;

/**
 * `x` values to ask for: evenly spaced across the domain, both endpoints included, no repeats.
 *
 * Integer arithmetic throughout, and the last point is `L` exactly, because `stableOf` reverts
 * `RmmOutOfDomain` above `L` and a float step across the domain eventually lands one wei past it.
 *
 * The duplicate check matters for the same reason the endpoint does: for a leg whose `L` is smaller
 * than the sample count — dust, or a low-decimal token — the spacing rounds to zero and a naive
 * grid asks the router the same question forty-seven times inside one multicall. Fewer points is
 * the right answer there; the curve has nowhere else to be sampled.
 */
export function curveGrid(liquidityWad: bigint, samples: number): bigint[] {
  const n = Math.max(2, Math.min(256, Math.floor(samples)));
  const out: bigint[] = [];
  for (let i = 0; i < n; i += 1) {
    const x = i === n - 1 ? liquidityWad : (liquidityWad * BigInt(i)) / BigInt(n - 1);
    if (out.at(-1) !== x) out.push(x);
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
  refreshMs = 8_000,
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
    () => (liquidityWad !== undefined && liquidityWad > BigInt(0) ? curveGrid(liquidityWad, samples) : []),
    [liquidityWad, samples],
  );

  const contracts = useMemo(
    () =>
      xs.map(
        (xWad) =>
          ({
            address: router ?? ZERO_ADDRESS,
            abi: strikelineReadAbi,
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
      // Stale rather than immutable. A scrub position that has been sampled is served instantly
      // from cache on the way back to it, and refetched underneath, because the curve at a fixed
      // maturity still tightens as the block clock advances. `gcTime` is what keeps a drag across
      // twenty-four positions to twenty-four multicalls rather than one per frame.
      staleTime: refreshMs === false ? Infinity : refreshMs,
      refetchInterval: refreshMs === false ? false : refreshMs,
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
