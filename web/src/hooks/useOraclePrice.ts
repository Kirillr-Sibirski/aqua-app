import { useMemo } from 'react';
import { formatUnits, type Address } from 'viem';
import { useReadContracts } from 'wagmi';
import { aquaFork, type SupportedChainId } from '@/lib/chain';
import { aggregatorV3Abi } from '@/lib/contracts';

export interface OraclePrice {
  feed: Address;
  /** Raw `int256 answer`. */
  answer: bigint;
  decimals: number;
  /** answer formatted with `decimals` (string, no rounding). */
  formatted: string;
  /** Convenience float — display only. */
  price: number;
  roundId: bigint;
  updatedAt: bigint;
  description?: string;
}

/*
 * There is deliberately no `ageSeconds` / `stale` here.
 *
 * Both were computed from react-query's `dataUpdatedAt` -- the browser's wall clock -- against a
 * chain `updatedAt`. On the pinned fork those differ by the fork offset, so `stale` was effectively
 * always true, and it was the one clock in the app that was not the chain's while five other
 * docstrings state the opposite rule. Nothing rendered either field. If an age is wanted, take
 * `nowSeconds` from the watched block, the way `KpiStrip` does for "last fill".
 */

export interface UseOraclePriceOptions {
  chainId?: SupportedChainId;
  /** ms, or false to disable polling (default 10000). */
  refetchInterval?: number | false;
  enabled?: boolean;
}

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/**
 * Chainlink `AggregatorV3.latestRoundData()` + `decimals()` + `description()` in one multicall.
 * Works against the real Base feeds carried by the fork and against the `MockAggregatorV3` that
 * `scripts/fork/oracle.ts` installs at the same proxy address.
 */
export function useOraclePrice(feed: Address | undefined, options: UseOraclePriceOptions = {}) {
  const chainId = options.chainId ?? aquaFork.id;
  const enabled = (options.enabled ?? true) && !!feed;
  const address = feed ?? ZERO_ADDRESS;

  const query = useReadContracts({
    contracts: [
      { address, abi: aggregatorV3Abi, functionName: 'latestRoundData', chainId } as const,
      { address, abi: aggregatorV3Abi, functionName: 'decimals', chainId } as const,
      { address, abi: aggregatorV3Abi, functionName: 'description', chainId } as const,
    ],
    allowFailure: true,
    query: { enabled, refetchInterval: options.refetchInterval ?? 10_000 },
  });

  const data = useMemo<OraclePrice | undefined>(() => {
    if (!feed || !query.data) return undefined;
    const [round, dec, desc] = query.data;
    if (round?.status !== 'success') return undefined;
    const [roundId, answer, , updatedAt] = round.result as readonly [bigint, bigint, bigint, bigint, bigint];
    const decimals = dec?.status === 'success' ? Number(dec.result) : 8;
    const formatted = formatUnits(answer, decimals);
    return {
      feed,
      answer,
      decimals,
      formatted,
      price: Number(formatted),
      roundId,
      updatedAt,
      ...(desc?.status === 'success' ? { description: String(desc.result) } : {}),
    };
  }, [feed, query.data]);

  const error = query.error ?? (query.data?.[0]?.status === 'failure' ? query.data[0].error : undefined);

  return { price: data, isLoading: query.isLoading, error, refetch: query.refetch };
}

export type UseOraclePriceReturn = ReturnType<typeof useOraclePrice>;
