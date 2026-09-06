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
  /** Seconds between the feed's `updatedAt` and the moment this answer was fetched. */
  ageSeconds: number;
  /** ageSeconds > staleAfter (default 3600). Fork clocks drift, so this is informational. */
  stale: boolean;
}

export interface UseOraclePriceOptions {
  chainId?: SupportedChainId;
  /** ms, or false to disable polling (default 10000). */
  refetchInterval?: number | false;
  /** Age (seconds) beyond which `stale` flips (default 3600). */
  staleAfter?: number;
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

  const fetchedAt = query.dataUpdatedAt;

  const data = useMemo<OraclePrice | undefined>(() => {
    if (!feed || !query.data) return undefined;
    const [round, dec, desc] = query.data;
    if (round?.status !== 'success') return undefined;
    const [roundId, answer, , updatedAt] = round.result as readonly [bigint, bigint, bigint, bigint, bigint];
    const decimals = dec?.status === 'success' ? Number(dec.result) : 8;
    // react-query's fetch timestamp — reading it keeps the render pure (no `Date.now()` here).
    const fetchedAtSeconds = Math.floor(fetchedAt / 1000);
    const ageSeconds = fetchedAtSeconds > 0 ? fetchedAtSeconds - Number(updatedAt) : 0;
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
      ageSeconds,
      stale: ageSeconds > (options.staleAfter ?? 3600),
    };
  }, [feed, query.data, fetchedAt, options.staleAfter]);

  const error = query.error ?? (query.data?.[0]?.status === 'failure' ? query.data[0].error : undefined);

  return { price: data, isLoading: query.isLoading, error, refetch: query.refetch };
}

export type UseOraclePriceReturn = ReturnType<typeof useOraclePrice>;
