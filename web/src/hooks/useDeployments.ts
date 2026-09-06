import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { DEPLOYMENTS_URL, getContracts, loadDeployments } from '@/lib/contracts';

export const DEPLOYMENTS_QUERY_KEY = ['deployments', DEPLOYMENTS_URL] as const;

/**
 * Loads `/deployments/local.json` once (env fallback inside `loadDeployments`) and derives typed
 * contract handles. `refetch()` after re-running the bootstrap.
 */
export function useDeployments() {
  const query = useQuery({
    queryKey: DEPLOYMENTS_QUERY_KEY,
    queryFn: () => loadDeployments(),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  const contracts = useMemo(() => (query.data ? getContracts(query.data.deployments) : undefined), [query.data]);
  return {
    deployments: query.data?.deployments,
    contracts,
    source: query.data?.source,
    fileError: query.data?.fileError,
    url: query.data?.url ?? DEPLOYMENTS_URL,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export type UseDeploymentsReturn = ReturnType<typeof useDeployments>;
