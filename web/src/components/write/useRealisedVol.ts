'use client';

/**
 * Trailing realised volatility, computed from the price feed's own round history.
 *
 * The maker picks the implied vol; that is the whole point of the product. But picking it against
 * nothing is how a book gets written at 40% into a market realising 90%, so the writer defaults the
 * field to what the asset has actually been doing and turns the field red when the number typed is
 * below it. Selling vol under realised is not forbidden here — it is a position, and a maker may
 * hold it deliberately — but it should never be the accident of leaving a default alone.
 *
 * The history is read on chain: `latestRoundData()` then `getRoundData(roundId - i)` walked
 * backwards over one multicall. Chainlink round ids are `(phaseId << 64) | aggregatorRoundId`, so
 * decrementing stays inside the current phase and simply starts failing at its edge; failures are
 * dropped rather than retried, because the phase boundary is not an error.
 *
 * Rounds arrive at irregular intervals (a deviation-threshold feed only updates when it has to), so
 * the estimator is realised variance over elapsed time, `sum(r^2) / sum(dt) * secondsPerYear`,
 * rather than a per-sample standard deviation that would silently assume a fixed bar width.
 *
 * When the feed has no usable history — a freshly installed mock on a fork has exactly one round —
 * this returns `undefined` and says why. It never falls back to a plausible-looking number.
 */
import { useMemo } from 'react';
import { formatUnits, type Address } from 'viem';
import { useReadContracts } from 'wagmi';
import { aquaFork, type SupportedChainId } from '@/lib/chain';
import { aggregatorV3Abi } from '@/lib/contracts';
import { YEAR_SECONDS } from '@/components/curve';

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/** Fewer than this many usable log returns is not an estimate, it is a rumour. */
const MIN_RETURNS = 8;

export interface RealisedVol {
  /** Annualised, as a ratio: `0.63` is 63%. */
  sigma: number;
  /** How many log returns went into it. */
  returns: number;
  /** Seconds of history the estimate spans. */
  spanSeconds: number;
  /** The feed it came from. */
  feed: Address;
}

export interface UseRealisedVolResult {
  vol?: RealisedVol;
  /** Why there is no estimate, in one sentence. Present only when `vol` is undefined. */
  unavailable?: string;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export interface UseRealisedVolOptions {
  /** Rounds to walk back. Each is one call inside a single multicall. */
  lookback?: number;
  chainId?: SupportedChainId;
  enabled?: boolean;
}

type Round = { at: number; price: number };

export function useRealisedVol(
  feed: Address | undefined,
  { lookback = 48, chainId = aquaFork.id, enabled = true }: UseRealisedVolOptions = {},
): UseRealisedVolResult {
  const head = useReadContracts({
    contracts: [
      { address: feed ?? ZERO_ADDRESS, abi: aggregatorV3Abi, functionName: 'latestRoundData', chainId } as const,
      { address: feed ?? ZERO_ADDRESS, abi: aggregatorV3Abi, functionName: 'decimals', chainId } as const,
    ],
    allowFailure: false,
    query: { enabled: enabled && !!feed, staleTime: 60_000, retry: false },
  });

  const latestRoundId = head.data ? (head.data[0] as readonly bigint[])[0] : undefined;
  const decimals = head.data ? Number(head.data[1]) : undefined;

  const roundIds = useMemo(() => {
    if (latestRoundId === undefined) return [];
    const out: bigint[] = [];
    for (let i = 1; i <= lookback; i += 1) {
      const id = latestRoundId - BigInt(i);
      if (id <= BigInt(0)) break;
      out.push(id);
    }
    return out;
  }, [latestRoundId, lookback]);

  const history = useReadContracts({
    contracts: roundIds.map(
      (id) =>
        ({
          address: feed ?? ZERO_ADDRESS,
          abi: aggregatorV3Abi,
          functionName: 'getRoundData',
          args: [id],
          chainId,
        }) as const,
    ),
    // A phase boundary makes `getRoundData` revert; that is the end of the history, not a failure.
    allowFailure: true,
    query: { enabled: enabled && !!feed && roundIds.length > 0, staleTime: 60_000, retry: false },
  });

  const result = useMemo<Pick<UseRealisedVolResult, 'vol' | 'unavailable'>>(() => {
    if (!feed) return { unavailable: 'No price feed is configured for this pair.' };
    if (!head.data || decimals === undefined) return {};

    const rounds: Round[] = [];
    const push = (answer: bigint, updatedAt: bigint) => {
      const price = Number(formatUnits(answer, decimals));
      const at = Number(updatedAt);
      if (Number.isFinite(price) && price > 0 && at > 0) rounds.push({ at, price });
    };

    const latest = head.data[0] as readonly bigint[];
    push(latest[1], latest[3]);

    for (const entry of history.data ?? []) {
      if (entry.status !== 'success') continue;
      const round = entry.result as readonly bigint[];
      push(round[1], round[3]);
    }

    rounds.sort((a, b) => a.at - b.at);

    let sumSquares = 0;
    let sumDt = 0;
    let used = 0;
    for (let i = 1; i < rounds.length; i += 1) {
      const dt = rounds[i].at - rounds[i - 1].at;
      if (dt <= 0) continue;
      const r = Math.log(rounds[i].price / rounds[i - 1].price);
      if (!Number.isFinite(r)) continue;
      sumSquares += r * r;
      sumDt += dt;
      used += 1;
    }

    if (used < MIN_RETURNS || sumDt <= 0) {
      return {
        unavailable:
          used === 0
            ? 'This feed has published only one round, so there is no history to measure.'
            : `Only ${used} price ${used === 1 ? 'update' : 'updates'} are readable from this feed, which is too few to annualise.`,
      };
    }

    const sigma = Math.sqrt((sumSquares / sumDt) * YEAR_SECONDS);
    if (!Number.isFinite(sigma) || sigma <= 0) {
      return { unavailable: 'The feed history produced no usable variance.' };
    }

    return { vol: { sigma, returns: used, spanSeconds: sumDt, feed } };
  }, [feed, head.data, history.data, decimals]);

  return {
    ...result,
    isLoading: head.isLoading || history.isLoading,
    error: ((head.error ?? history.error) as Error | null) ?? null,
    refetch: () => {
      void head.refetch();
      void history.refetch();
    },
  };
}
