'use client';

import { useMemo } from 'react';
import { useChains } from 'wagmi';
import { chains as configuredChains, FORK_CHAIN_ID } from '@/lib/chain';
import { useDeployments } from '@/hooks';

export interface DeploymentChain {
  /** The chain the terminal reads Aqua from — the manifest's chain, not the wallet's. */
  chainId: number;
  /** Display name; falls back to the id when the chain is not in the wagmi config. */
  name: string;
  /** False when the manifest names a chain wagmi is not configured for, so `switchChain` cannot target it. */
  isConfigured: boolean;
  /** The manifest is still loading; `chainId` is the fork default until it arrives. */
  isLoading: boolean;
}

/**
 * Which chain the app's data lives on.
 *
 * The manifest (`/deployments/local.json`) is the authority, because that is where the router was
 * actually deployed; the fork id is only the placeholder while it loads. Everything that compares a
 * wallet's chain against "the right one" reads this, so there is a single answer on screen.
 */
export function useDeploymentChain(): DeploymentChain {
  const { deployments, isLoading } = useDeployments();
  const chains = useChains();

  return useMemo(() => {
    const chainId = deployments?.chainId ?? FORK_CHAIN_ID;
    const match = chains.find((c) => c.id === chainId) ?? configuredChains.find((c) => c.id === chainId);
    return {
      chainId,
      name: match?.name ?? `Chain ${chainId}`,
      isConfigured: Boolean(match),
      isLoading,
    };
  }, [chains, deployments?.chainId, isLoading]);
}
