import { useQuery } from '@tanstack/react-query';
import type { Address, PublicClient } from 'viem';
import { usePublicClient } from 'wagmi';
import { aquaFork } from '@/lib/chain';
import { fetchShippedStrategiesDetailed, type ShippedStrategy, type SkippedShippedLog } from '@/lib/contracts';
import { useDeployments } from './useDeployments';

export interface UseShippedStrategiesOptions {
  /** ms, or false to stop polling (default 5000). */
  refetchInterval?: number | false;
  /** Ignore the maker filter and return every strategy shipped to our router. */
  all?: boolean;
}

/**
 * Strategies shipped by `maker` to our router: Aqua `Shipped` logs from the deployment block
 * (no indexed params → filtered client-side), decoded with `decodeOrder()`, with live rawBalances
 * and a `docked` flag. Empty until deployments + a maker are available.
 */
export function useShippedStrategies(maker: Address | undefined, options: UseShippedStrategiesOptions = {}) {
  const client = usePublicClient({ chainId: aquaFork.id });
  const { deployments } = useDeployments();
  const makerKey = options.all ? 'all' : (maker?.toLowerCase() ?? 'none');
  const enabled = !!client && !!deployments && (options.all || !!maker);

  const query = useQuery({
    queryKey: ['shippedStrategies', deployments?.aqua, deployments?.router, deployments?.blockNumber, makerKey],
    queryFn: async () => {
      if (!client || !deployments) throw new Error('not ready');
      return fetchShippedStrategiesDetailed(client as PublicClient, {
        aqua: deployments.aqua,
        app: deployments.router,
        maker: options.all ? undefined : maker,
        fromBlock: BigInt(deployments.blockNumber),
      });
    },
    enabled,
    refetchInterval: options.refetchInterval ?? 5000,
  });

  const strategies: ShippedStrategy[] = query.data?.strategies ?? [];
  const skipped: SkippedShippedLog[] = query.data?.skipped ?? [];

  return {
    strategies,
    skipped,
    fromBlock: query.data?.fromBlock,
    toBlock: query.data?.toBlock,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}
