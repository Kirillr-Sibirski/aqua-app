'use client';

import { Wallet } from 'lucide-react';
import { useState } from 'react';
import { useConnection } from 'wagmi';
import { Button, Skeleton } from '@/components/ui';
import { useIsHydrated } from '@/components/shell/useIsHydrated';
import { useDeploymentChain } from '@/components/shell/useDeploymentChain';
import type { SupportedChainId } from '@/lib/chain';
import { WalletDialog } from './WalletDialog';
import { WalletMenu } from './WalletMenu';

/**
 * The wallet corner of the top bar: a Connect button, or the connected account and its menu.
 *
 * wagmi's connection state is browser-only — the connectors have not announced themselves when the
 * HTML is generated, and the cookie the config reconnects from is read on mount. Rendering either
 * branch during SSR would therefore emit markup the hydration render disagrees with, and React
 * responds to a mismatch by discarding the whole server tree. The placeholder below is what both
 * renders emit instead: identical bytes, exactly the final control's size, so nothing jumps when
 * the real state arrives one commit later.
 */
export function WalletCluster({ className }: { className?: string }) {
  const hydrated = useIsHydrated();
  const { address } = useConnection();

  if (!hydrated) {
    return <Skeleton radius="control" className="h-8 w-36" />;
  }

  return address ? <WalletMenu className={className} /> : <ConnectButton className={className} />;
}

export interface ConnectButtonProps {
  className?: string;
  /** Chain to connect on. Defaults to the chain the deployment manifest names. */
  chainId?: SupportedChainId;
  size?: 'sm' | 'md';
}

/**
 * Opens the wallet picker. Kept separate from the cluster so an empty state can offer connecting as
 * its single action without also rendering a second account menu.
 */
export function ConnectButton({ className, chainId, size = 'sm' }: ConnectButtonProps) {
  const [open, setOpen] = useState(false);
  const deployment = useDeploymentChain();
  const target = chainId ?? (deployment.isConfigured ? (deployment.chainId as SupportedChainId) : undefined);

  return (
    <>
      <Button
        variant="primary"
        size={size}
        icon={Wallet}
        onClick={() => setOpen(true)}
        className={className}
      >
        Connect wallet
      </Button>
      <WalletDialog open={open} onClose={() => setOpen(false)} chainId={target} />
    </>
  );
}
