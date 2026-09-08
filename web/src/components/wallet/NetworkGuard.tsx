'use client';

import { useConnection, useSwitchChain } from 'wagmi';
import type { SupportedChainId } from '@/lib/chain';
import { Button, Callout, describeError } from '@/components/ui';
import { useDeploymentChain } from '@/components/shell/useDeploymentChain';
import { useIsHydrated } from '@/components/shell/useIsHydrated';

export interface NetworkGuardProps {
  className?: string;
}

/**
 * Wrong-network notice, as a banner rather than a modal.
 *
 * The terminal reads Aqua from the chain the deployment manifest names, not from the wallet's
 * chain, so a maker on the wrong network can still read their own book — every number on screen is
 * still a real chain read from the right chain. Blocking the page with a modal would hide exactly
 * what they came to look at in order to tell them about a problem that only affects writing. So the
 * guard states the mismatch, names both chains, and offers the one control that fixes it.
 *
 * Renders nothing while disconnected: there is no wrong network to be on.
 */
export function NetworkGuard({ className }: NetworkGuardProps) {
  const hydrated = useIsHydrated();
  const { address, chainId, chain } = useConnection();
  const deployment = useDeploymentChain();
  const { mutate: switchChain, isPending, error } = useSwitchChain();

  // Nothing on the server: wallet state does not exist there, and rendering a banner the client
  // then removes would be a hydration mismatch as well as a flash.
  if (!hydrated || !address || deployment.isLoading) return null;
  if (chainId === deployment.chainId) return null;

  const walletChain = chain?.name ?? `chain ${chainId ?? 'unknown'}`;
  const described = error ? describeError(error) : undefined;

  return (
    <div className={className}>
      <Callout
        tone="warning"
        title={`Your wallet is on ${walletChain}`}
        action={
          deployment.isConfigured ? (
            <Button
              size="sm"
              variant="secondary"
              loading={isPending}
              loadingLabel={`Switching to ${deployment.name}`}
              onClick={() => switchChain({ chainId: deployment.chainId as SupportedChainId })}
            >
              Switch to {deployment.name}
            </Button>
          ) : undefined
        }
      >
        {deployment.isConfigured ? (
          <>
            The numbers on this page are read from {deployment.name}, so they are correct.
            Publishing an offer, taking one down or trading will fail until the wallet is on the same
            chain.
          </>
        ) : (
          <>
            The deployment manifest names chain {deployment.chainId}, which this app is not
            configured to connect to. Add it to the wagmi config, or point the manifest at a
            configured chain.
          </>
        )}
        {described && !described.rejected ? (
          <span className="mt-2 block text-neg">{described.message}</span>
        ) : null}
      </Callout>
    </div>
  );
}
