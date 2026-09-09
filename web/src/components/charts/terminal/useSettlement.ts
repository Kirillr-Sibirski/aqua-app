'use client';

/**
 * The two settlement reads the payoff view is drawn from, in one multicall.
 *
 * Both are `stableFor` at a maturity that has already passed, which puts `RmmSwap.stableOf` in its
 * closed-form branch: `Y = K*(L - X)`, with no `Phi`, no `tau` and therefore no block dependence at
 * all. That is what makes this the one query in the chart that is genuinely immutable — the same
 * five arguments return the same answer at every block forever — so it is asked once per leg and
 * pinned, rather than polled.
 *
 *   cap        = stableFor(K, sigma, matured, L, 0)  = K*L
 *   settlement = stableFor(K, sigma, matured, L, x)  = K*(L - x)
 *
 * `MATURED_MATURITY` is shared with `useCurveSamples` for the same reason it exists there: passing
 * the live block timestamp would change the query key every block and re-fetch a line that cannot
 * move.
 */
import { useMemo } from 'react';
import type { Address } from 'viem';
import { useReadContracts } from 'wagmi';
import { strikelineReadAbi } from '@/components/curve/rmm';
import { MATURED_MATURITY } from '@/hooks/useCurveSamples';
import { aquaFork, type SupportedChainId } from '@/lib/chain';

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

export interface UseSettlementParams {
  router?: Address;
  strikeWad?: bigint;
  sigmaWad?: bigint;
  liquidityWad?: bigint;
  /** The risky reserve the settlement line is read at. */
  xWad?: bigint;
  chainId?: SupportedChainId;
  enabled?: boolean;
}

export interface UseSettlementResult {
  /** `K*L`, WAD: the whole leg once assigned. */
  capWad?: bigint;
  /** `K*(L - x)`, WAD: the settlement line above the reserve point. */
  settlementWad?: bigint;
  isLoading: boolean;
  error: Error | null;
}

export function useSettlement({
  router,
  strikeWad,
  sigmaWad,
  liquidityWad,
  xWad,
  chainId = aquaFork.id,
  enabled = true,
}: UseSettlementParams): UseSettlementResult {
  const ready =
    enabled &&
    !!router &&
    strikeWad !== undefined &&
    sigmaWad !== undefined &&
    liquidityWad !== undefined &&
    liquidityWad > BigInt(0) &&
    xWad !== undefined;

  const contracts = useMemo(() => {
    const head = [
      strikeWad ?? BigInt(0),
      sigmaWad ?? BigInt(0),
      MATURED_MATURITY,
      liquidityWad ?? BigInt(0),
    ] as const;
    return [
      {
        address: router ?? ZERO_ADDRESS,
        abi: strikelineReadAbi,
        functionName: 'stableFor',
        args: [...head, BigInt(0)] as const,
        chainId,
      } as const,
      {
        address: router ?? ZERO_ADDRESS,
        abi: strikelineReadAbi,
        functionName: 'stableFor',
        args: [...head, xWad ?? BigInt(0)] as const,
        chainId,
      } as const,
    ];
  }, [router, strikeWad, sigmaWad, liquidityWad, xWad, chainId]);

  const query = useReadContracts({
    contracts,
    allowFailure: false,
    query: {
      enabled: ready,
      // The settlement branch has no `tau` in it. Nothing about this answer can change.
      staleTime: Infinity,
      gcTime: Infinity,
      refetchInterval: false,
      retry: false,
    },
  });

  const data = query.data as readonly [bigint, bigint] | undefined;

  return {
    capWad: data?.[0],
    settlementWad: data?.[1],
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
  };
}
