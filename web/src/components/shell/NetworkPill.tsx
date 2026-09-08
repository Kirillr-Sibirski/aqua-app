'use client';

import { useBlockNumber } from 'wagmi';
import type { SupportedChainId } from '@/lib/chain';
import { cn, formatUnits } from '@/lib/ui';
import { Skeleton, Tooltip } from '@/components/ui';
import { useDeploymentChain } from './useDeploymentChain';
import { useIsHydrated } from './useIsHydrated';

type Health = 'live' | 'connecting' | 'offline' | 'unconfigured';

const HEALTH: Record<Health, { label: string; dot: string; text: string }> = {
  live: { label: 'Live', dot: 'bg-pos', text: 'text-ink-2' },
  connecting: { label: 'Connecting', dot: 'bg-ink-3', text: 'text-ink-3' },
  offline: { label: 'Offline', dot: 'bg-neg', text: 'text-neg' },
  unconfigured: { label: 'Unknown chain', dot: 'bg-warn', text: 'text-warn' },
};

/**
 * Chain identity and liveness for the chain the terminal *reads* — not the wallet's chain, which
 * `NetworkGuard` owns.
 *
 * The block number is pushed by wagmi's watcher (a poll on an HTTP transport), and a slow refetch
 * runs alongside it purely so a dead RPC surfaces as a query error: the watcher swallows its own
 * failures, so without that second path the pill would sit on a stale number and claim everything
 * is fine.
 *
 * Health is a word, never only a dot. The dot is `aria-hidden` decoration on top of the label,
 * because "the green one means it is working" is not something a screenshot, a colour-blind maker
 * or a screen reader can act on.
 */
export function NetworkPill({ className }: { className?: string }) {
  const hydrated = useIsHydrated();
  const { chainId, name, isConfigured } = useDeploymentChain();
  const target = isConfigured ? (chainId as SupportedChainId) : undefined;

  const {
    data: blockNumber,
    status,
    error,
  } = useBlockNumber({
    chainId: target,
    watch: isConfigured,
    query: { enabled: isConfigured, retry: 0, refetchInterval: 10_000 },
  });

  // Wallet and RPC state do not exist during SSR, so the server renders the placeholder and the
  // first client commit swaps in the live pill. Same markup on both sides, no hydration mismatch.
  if (!hydrated) {
    return <Skeleton radius="pill" className={cn('h-8 w-56', className)} />;
  }

  const health: Health = !isConfigured
    ? 'unconfigured'
    : status === 'error'
      ? 'offline'
      : status === 'pending'
        ? 'connecting'
        : 'live';
  const state = HEALTH[health];

  const pill = (
    <div
      className={cn(
        'flex h-8 items-center gap-2 rounded-pill border border-line bg-surface pr-3 pl-2.5',
        className,
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-pill', state.dot)} aria-hidden="true" />
      <span className={cn('text-mini', state.text)} aria-live="polite">
        {state.label}
      </span>

      <Rule />
      <span className="hidden text-mini text-ink-2 md:inline">{name}</span>
      <Rule className="hidden md:block" />

      <span className="font-mono text-mini tnum text-ink-3">
        <span className="sr-only">Latest block </span>
        <span aria-hidden="true">#</span>
        {blockNumber === undefined ? '—' : formatUnits(blockNumber, 0)}
      </span>
    </div>
  );

  if (health === 'offline' && error) {
    return <Tooltip content={error.message}>{pill}</Tooltip>;
  }
  return pill;
}

function Rule({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('h-3 w-px shrink-0 bg-line', className)} />;
}
