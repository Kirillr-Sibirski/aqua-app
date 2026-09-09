'use client';

/**
 * How far the feed has moved, over as much history as the chain will actually hand over.
 *
 * The header wants a delta beside the spot, and every ticker in the world writes that delta as
 * "24h". This one refuses to, because on the pinned fork it would be a lie: anvil forks Base at
 * block 50,946,000 and declines every archive read below it, so the readable history is however
 * many blocks have been mined since — minutes, not a day. So the window is measured rather than
 * asserted: the oldest price the chain will serve is found, and the elapsed time between that
 * reading and the current one is printed next to the percentage. A four-minute move says `4m`.
 *
 * The read is `AggregatorV3.latestRoundData()` at a ladder of past block numbers, which is the same
 * technique `useRealisedVol` falls back to when a feed keeps no retrievable round history — and it
 * is that same function, imported rather than copied. A call that reverts is a block the node will
 * not serve, which is a shorter history, not a failure.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBlockNumber, usePublicClient } from 'wagmi';
import type { Address, PublicClient } from 'viem';
import { blockLadder, readBlockHistory, type PriceObservation } from '@/components/sell';
import { aquaFork, type SupportedChainId } from '@/lib/chain';

/** A day of Base blocks at two seconds each. The ceiling, never the promise. */
const MAX_REACH_BLOCKS = 43_200;

/** Points across the readable range. Each is one archive `eth_call`; eight draws the endpoint out. */
const SAMPLES = 8;

/**
 * Re-ask every this many blocks rather than every block. The delta is a claim about minutes; asking
 * eight archive calls twice a second to refine it would be theatre.
 */
const BUCKET = BigInt(16);

export interface SpotWindow {
  /** The oldest reading the chain served, and the one the delta is measured from. */
  from: PriceObservation;
  /** `(now - then) / then`. A ratio: `0.0124` is +1.24%. */
  change: number;
  /** Seconds between the two readings, on the chain's clock. */
  spanSeconds: number;
}

export interface UseSpotWindowParams {
  feed?: Address;
  /** The feed's own `decimals()`, from `useOraclePrice`. */
  decimals?: number;
  /** Today's price and the instant it was published, from the same feed. */
  now?: { price: number; at: number };
  /** The block the fork was taken at; nothing below it is readable. */
  floorBlock?: bigint;
  chainId?: SupportedChainId;
  enabled?: boolean;
}

export interface UseSpotWindowResult {
  window?: SpotWindow;
  isLoading: boolean;
}

export function useSpotWindow({
  feed,
  decimals,
  now,
  floorBlock,
  chainId = aquaFork.id,
  enabled = true,
}: UseSpotWindowParams): UseSpotWindowResult {
  const client = usePublicClient({ chainId });
  const { data: head } = useBlockNumber({ chainId, watch: true, query: { enabled } });

  const bucket = head === undefined ? undefined : head / BUCKET;
  const ready = enabled && !!client && !!feed && decimals !== undefined && bucket !== undefined;

  const query = useQuery({
    queryKey: ['spotWindow', chainId, feed, bucket?.toString(), floorBlock?.toString()],
    enabled: ready,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<PriceObservation[]> => {
      if (!client || !feed || decimals === undefined || head === undefined) throw new Error('not ready');
      const reach = BigInt(MAX_REACH_BLOCKS);
      const floor = floorBlock ?? BigInt(0);
      const from = head > reach && head - reach > floor ? head - reach : floor;
      const span = head > from ? Number(head - from) : 0;
      if (span <= 0) return [];
      return readBlockHistory(
        client as PublicClient,
        feed,
        decimals,
        blockLadder(head, span, SAMPLES),
      );
    },
  });

  const spotWindow = useMemo<SpotWindow | undefined>(() => {
    if (!now || !query.data || query.data.length === 0) return undefined;
    // The oldest reading that is genuinely older than the current one and carries a usable price.
    const oldest = query.data
      .filter((o) => o.price > 0 && o.at > 0 && o.at < now.at)
      .sort((a, b) => a.at - b.at)[0];
    if (!oldest) return undefined;
    return {
      from: oldest,
      change: (now.price - oldest.price) / oldest.price,
      spanSeconds: now.at - oldest.at,
    };
  }, [query.data, now]);

  return { window: spotWindow, isLoading: query.isLoading };
}

/** `4m`, `2h`, `3d`. The window the delta was actually measured over, never a rounded-up claim. */
export function formatSpan(seconds: number): string {
  if (seconds >= 86_400) return `${Math.round(seconds / 86_400)}d`;
  if (seconds >= 3_600) return `${Math.round(seconds / 3_600)}h`;
  if (seconds >= 60) return `${Math.round(seconds / 60)}m`;
  return `${Math.max(1, Math.round(seconds))}s`;
}
