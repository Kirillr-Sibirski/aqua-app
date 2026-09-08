'use client';

/**
 * Does this wallet have anything to show on the positions tab?
 *
 * The positions view is a second tab and it is not supposed to exist visually until there is
 * something in it. That gate needs an answer *before* the tab is rendered, on a screen that is not
 * the positions view — so it cannot come out of `useBook`, which is a two-round multicall plus a
 * log replay and is far too much work to hang a nav item on.
 *
 * This is the cheap half: the same `Shipped` log scan `useBook` already runs for discovery, under
 * the same TanStack query key and the same poll interval, so mounting it beside `useBook` costs one
 * extra observer on a query that was going to run anyway and no extra request. It answers only the
 * question the tab asks — *is there at least one live offer* — and every number the tab leads to is
 * still read at a pinned block by `useBook`.
 *
 * "Live" means shipped by this wallet, carrying an `RmmSwap` instruction, and not withdrawn. A
 * wallet whose every offer has been taken down sees the front door, not an empty table.
 */
import { useMemo } from 'react';
import type { Address } from 'viem';
import { useConnection } from 'wagmi';
import { useIsHydrated } from '@/components/shell/useIsHydrated';
import { useShippedStrategies } from '@/hooks';
import { decodeLegProgram } from '@/hooks/strikeline';

/** Matches the discovery poll inside `useBook`, so the two observers share one interval. */
const DISCOVERY_INTERVAL_MS = 8000;

export interface HasOffers {
  /** The connected wallet, once there is one and the client has hydrated. */
  address?: Address;
  /** Live offers: shipped here, an option, not withdrawn. */
  count: number;
  /** Withdrawn offers, which are history and do not open the tab on their own. */
  withdrawnCount: number;
  /** `count > 0`. The one boolean a nav item should read. */
  has: boolean;
  /** True while the log scan is still in flight, so a tab can hold rather than flicker. */
  isLoading: boolean;
}

export function useHasOffers(): HasOffers {
  const hydrated = useIsHydrated();
  const { address } = useConnection();
  const maker = hydrated ? address : undefined;

  const { strategies, isLoading } = useShippedStrategies(maker, {
    refetchInterval: DISCOVERY_INTERVAL_MS,
  });

  return useMemo(() => {
    let count = 0;
    let withdrawnCount = 0;
    for (const strategy of strategies) {
      // A strategy shipped to our router that carries no curve is not an offer to sell at a price,
      // and the tab does not count it.
      if (!decodeLegProgram(strategy.program).rmm) continue;
      if (strategy.docked) withdrawnCount += 1;
      else count += 1;
    }
    return {
      address: maker,
      count,
      withdrawnCount,
      has: count > 0,
      isLoading: !!maker && isLoading,
    };
  }, [strategies, maker, isLoading]);
}
