'use client';

/**
 * The diagnostics page's own wallet control, and it lives here rather than in `components/`.
 *
 * The product's wallet UI is the three controls in `components/sell/WalletButton.tsx` and there is
 * exactly one of it. This is a debugging surface where seeing every connector id and the raw
 * connection status is the point, so it keeps its own plain-HTML control instead of dressing the
 * product one up — and keeping it inside `app/dev/` means it leaves the tree with the route.
 */
import { useMemo } from 'react';
import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from 'wagmi';
import { aquaFork, BURNER_CONNECTOR_ID, FORK_CHAIN_ID, type SupportedChainId } from '@/lib/chain';

export function shortAddress(address: string, size = 4): string {
  return `${address.slice(0, 2 + size)}…${address.slice(-size)}`;
}

export interface ConnectWalletProps {
  className?: string;
  /** Chain to connect to / switch to (default: the local fork). */
  chainId?: SupportedChainId;
}

export function ConnectWallet({ className, chainId = FORK_CHAIN_ID }: ConnectWalletProps) {
  const { address, chain, chainId: connectedChainId, connector, status } = useConnection();
  const connectors = useConnectors();
  const { mutate: connect, isPending: isConnecting, error: connectError } = useConnect();
  const { mutate: disconnect } = useDisconnect();
  const { mutate: switchChain, isPending: isSwitching, error: switchError } = useSwitchChain();

  const { burner, wallets } = useMemo(
    () => ({
      burner: connectors.find((c) => c.id === BURNER_CONNECTOR_ID),
      wallets: connectors.filter((c) => c.id !== BURNER_CONNECTOR_ID),
    }),
    [connectors],
  );

  const wrongChain = !!address && connectedChainId !== chainId;
  const error = connectError ?? switchError;

  return (
    <div className={className ?? 'flex flex-col gap-2 text-sm'}>
      {address ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono" title={address}>
            {shortAddress(address)}
          </span>
          <span className="opacity-70">
            via {connector?.name ?? 'unknown'} on {chain?.name ?? `chain ${connectedChainId ?? '?'}`}
            {connectedChainId === FORK_CHAIN_ID ? '' : ' (not the fork)'}
          </span>
          {wrongChain && (
            <button type="button" onClick={() => switchChain({ chainId })} disabled={isSwitching} className="border px-2 py-0.5">
              {isSwitching ? 'switching…' : `switch to ${aquaFork.name}`}
            </button>
          )}
          <button type="button" onClick={() => disconnect()} className="border px-2 py-0.5">
            disconnect
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {wallets.length === 0 && <span className="opacity-70">no browser wallet detected</span>}
          {wallets.map((c) => (
            <button
              key={c.uid}
              type="button"
              onClick={() => connect({ connector: c, chainId })}
              disabled={isConnecting}
              className="border px-2 py-0.5"
            >
              connect {c.name}
            </button>
          ))}
          {burner && (
            <button
              key={burner.uid}
              type="button"
              onClick={() => connect({ connector: burner, chainId })}
              disabled={isConnecting}
              className="border px-2 py-0.5"
              title="Signs locally with NEXT_PUBLIC_DEMO_PRIVATE_KEY (anvil #1 by default) — no extension needed"
            >
              demo mode (burner key)
            </button>
          )}
          <span className="opacity-60">status: {status}</span>
        </div>
      )}
      {error && <p className="text-red-600">{error.message}</p>}
    </div>
  );
}
