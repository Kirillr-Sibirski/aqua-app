'use client';

/**
 * Trailing realised volatility, computed from the price feed on chain.
 *
 * The maker picks the implied vol; that is the whole point of the product. But picking it against
 * nothing is how a book gets written at 40% into a market realising 90%, so the writer defaults the
 * field to what the asset has actually been doing and turns the field red when the number typed is
 * below it. Selling vol under realised is not forbidden here — it is a position, and a maker may
 * hold it deliberately — but it should never be the accident of leaving a default alone.
 *
 * There are two ways to get a price history out of a chain, and this asks for both in order.
 *
 *  1. **The feed's own rounds.** `latestRoundData()` then `getRoundData(roundId - i)` walked
 *     backwards over one multicall. This is the canonical source and the one a real Chainlink proxy
 *     answers. Round ids are `(phaseId << 64) | aggregatorRoundId`, so decrementing stays inside the
 *     current phase and simply starts failing at its edge; failures are dropped rather than retried,
 *     because a phase boundary is not an error.
 *
 *  2. **The chain's own blocks.** Some aggregators keep no retrievable round history — the
 *     `MockAggregatorV3` the fork installs at the Chainlink proxy address is one: its `getRoundData`
 *     returns the current answer whatever id it is handed. But the *chain* remembers, because every
 *     block it mined has its own state. So `latestRoundData()` is called at a ladder of past block
 *     numbers, which returns the answer that was in force at each one along with the `updatedAt` it
 *     reported then. That is a price history read from the chain, not a file beside the app.
 *
 * Both produce the same thing — timestamped prices — and both go through the same estimator.
 *
 * Rounds arrive at irregular intervals (a deviation-threshold feed only updates when it has to, and
 * a fork mines when it is told to), so the estimator is realised variance over elapsed time,
 * `sum(r^2) / sum(dt) * secondsPerYear`, rather than a per-sample standard deviation that would
 * silently assume a fixed bar width. That form is also invariant to how finely the series is
 * sampled: reading a feed that moved twice at forty blocks adds thirty-eight zero returns, which
 * change neither the numerator nor the span.
 *
 * When neither source has usable history this returns `undefined` and says why. It never falls back
 * to a plausible-looking number.
 */
import { useMemo } from 'react';
import { formatUnits, type Address, type PublicClient } from 'viem';
import { useQuery } from '@tanstack/react-query';
import { usePublicClient, useReadContracts } from 'wagmi';
import { aquaFork, type SupportedChainId } from '@/lib/chain';
import { aggregatorV3Abi } from '@/lib/contracts';
// Straight from the module, not the barrel: this file is a data path, and pulling the curve
// barrel in for one constant would drag every chart component into anything that imports it.
import { YEAR_SECONDS } from '@/components/curve/rmm';

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/**
 * Fewer than this many price *changes* is not an estimate, it is a rumour.
 *
 * Counted on moves rather than on observations, because a series sampled finer than the feed
 * updates is mostly zeroes and would otherwise pass the gate while carrying four real numbers.
 */
const MIN_MOVES = 6;

/** Where the history came from, so the screen can say so rather than implying a single source. */
export type RealisedVolSource = 'rounds' | 'blocks';

export interface RealisedVol {
  /** Annualised, as a ratio: `0.63` is 63%. */
  sigma: number;
  /** How many price changes went into it. */
  moves: number;
  /** How many observations were read to find them. */
  observations: number;
  /** Seconds of history the estimate spans. */
  spanSeconds: number;
  source: RealisedVolSource;
  /** The feed it came from. */
  feed: Address;
}

/** One timestamped price. The unit of both sources and the only input the estimator takes. */
export interface PriceObservation {
  /** Unix seconds. */
  at: number;
  price: number;
}

export interface RealisedVolEstimate {
  sigma: number;
  moves: number;
  observations: number;
  spanSeconds: number;
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
  /** Blocks to reach back over when the feed keeps no round history. */
  blockLookback?: number;
  /** Points to sample across that span. Each is one archive `eth_call`. */
  blockSamples?: number;
  chainId?: SupportedChainId;
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// The estimator
// ---------------------------------------------------------------------------

/**
 * Annualised realised volatility from a set of timestamped prices.
 *
 * Pure, so it can be tested against a series whose answer is known rather than only against
 * whatever a chain happens to be doing. Observations arrive in any order and may repeat a
 * timestamp; the first of a repeated instant wins, since a second reading at the same second
 * carries no elapsed time to attribute a return to.
 */
export function estimateRealisedVol(
  observations: readonly PriceObservation[],
  minMoves = MIN_MOVES,
): { vol?: RealisedVolEstimate; unavailable?: string } {
  const seen = new Set<number>();
  const clean: PriceObservation[] = [];
  for (const o of [...observations].sort((a, b) => a.at - b.at)) {
    if (!Number.isFinite(o.price) || o.price <= 0 || !Number.isFinite(o.at) || o.at <= 0) continue;
    if (seen.has(o.at)) continue;
    seen.add(o.at);
    clean.push(o);
  }

  let sumSquares = 0;
  let sumDt = 0;
  let moves = 0;
  for (let i = 1; i < clean.length; i += 1) {
    const dt = clean[i].at - clean[i - 1].at;
    if (dt <= 0) continue;
    const r = Math.log(clean[i].price / clean[i - 1].price);
    if (!Number.isFinite(r)) continue;
    sumSquares += r * r;
    sumDt += dt;
    if (r !== 0) moves += 1;
  }

  if (moves < minMoves || sumDt <= 0) {
    return {
      unavailable:
        clean.length <= 1
          ? 'This feed has published only one price, so there is no history to measure.'
          : `Only ${moves} price ${moves === 1 ? 'change is' : 'changes are'} readable from this feed, which is too few to annualise.`,
    };
  }

  const sigma = Math.sqrt((sumSquares / sumDt) * YEAR_SECONDS);
  if (!Number.isFinite(sigma) || sigma <= 0) {
    return { unavailable: 'The feed history produced no usable variance.' };
  }

  return { vol: { sigma, moves, observations: clean.length, spanSeconds: sumDt } };
}

// ---------------------------------------------------------------------------
// Reading a history off the chain's blocks
// ---------------------------------------------------------------------------

/** Evenly spaced block numbers ending at `head`, oldest first, never below zero. */
export function blockLadder(head: bigint, span: number, samples: number): bigint[] {
  const n = Math.max(2, Math.min(128, Math.floor(samples)));
  const reach = BigInt(Math.max(1, Math.floor(span)));
  const from = head > reach ? head - reach : BigInt(0);
  const width = head - from;
  const out: bigint[] = [];
  for (let i = 0; i < n; i += 1) {
    const at = from + (width * BigInt(i)) / BigInt(n - 1);
    if (out.at(-1) !== at) out.push(at);
  }
  return out;
}

/**
 * `latestRoundData()` at each of a ladder of past blocks.
 *
 * A call that reverts is dropped, not retried: reaching back past the fork point lands on whatever
 * the upstream node is willing to serve, and a node that declines an archive read is a shorter
 * history rather than a failure. Callers get an honest count either way.
 */
export async function readBlockHistory(
  client: PublicClient,
  feed: Address,
  decimals: number,
  blocks: readonly bigint[],
): Promise<PriceObservation[]> {
  const readings = await Promise.all(
    blocks.map(async (blockNumber) => {
      try {
        const round = (await client.readContract({
          address: feed,
          abi: aggregatorV3Abi,
          functionName: 'latestRoundData',
          blockNumber,
        })) as readonly [bigint, bigint, bigint, bigint, bigint];
        return { at: Number(round[3]), price: Number(formatUnits(round[1], decimals)) };
      } catch {
        return undefined;
      }
    }),
  );
  return readings.filter((r): r is PriceObservation => r !== undefined);
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/**
 * Where the volatility field opens before the feed's history has been read.
 *
 * The one figure on the card that is not a chain read, so it does not get to pass for one: when the
 * feed has enough history the measurement replaces it, and *Details* always says which of the two
 * the field is showing. Someone who types their own number owns it from that keystroke on. 60% is
 * the level the project's own replay is written at, and the level its vol sweep brackets on both
 * sides, so it is a disclosed starting point rather than a guess.
 *
 * It lives here rather than in the card because *Details* names it too, in the affordance that
 * takes a typed number back to it, and two literals would drift.
 */
export const FALLBACK_VOL = '60';

/**
 * How much history a measurement needs before it is allowed to set the default.
 *
 * `estimateRealisedVol` annualises `sum(r^2)/sum(dt)`, which is arithmetic that works on any span
 * at all -- and that is the problem. Two hours of a feed annualises to whatever those two hours
 * did; on the warped demo fork, where the price is moved deliberately, it reads 141%, and a week's
 * offer priced off it would put a spread in front of itself that nobody ever crosses. A day is the
 * shortest window that is a measurement of the asset rather than of the morning.
 */
export const MIN_VOL_SPAN_SECONDS = 86_400;

export function useRealisedVol(
  feed: Address | undefined,
  {
    lookback = 48,
    blockLookback = 4_096,
    blockSamples = 40,
    chainId = aquaFork.id,
    enabled = true,
  }: UseRealisedVolOptions = {},
): UseRealisedVolResult {
  const client = usePublicClient({ chainId });

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

  /** The rounds the feed itself will hand over, as observations. */
  const fromRounds = useMemo<PriceObservation[] | undefined>(() => {
    if (!head.data || decimals === undefined) return undefined;
    if (roundIds.length > 0 && history.isLoading) return undefined;

    const out: PriceObservation[] = [];
    const push = (answer: bigint, updatedAt: bigint) => {
      out.push({ at: Number(updatedAt), price: Number(formatUnits(answer, decimals)) });
    };

    const latest = head.data[0] as readonly bigint[];
    push(latest[1], latest[3]);
    for (const entry of history.data ?? []) {
      if (entry.status !== 'success') continue;
      const round = entry.result as readonly bigint[];
      push(round[1], round[3]);
    }
    return out;
  }, [head.data, history.data, history.isLoading, decimals, roundIds.length]);

  const roundEstimate = useMemo(
    () => (fromRounds ? estimateRealisedVol(fromRounds) : undefined),
    [fromRounds],
  );

  /**
   * The block ladder only runs when the rounds did not answer, so a real Chainlink proxy — which
   * does keep its history — never pays for forty archive calls.
   */
  const needBlocks = Boolean(roundEstimate && !roundEstimate.vol);

  const blocks = useQuery({
    // No block number in the key on purpose: the head is read inside the function, so a new block
    // does not invalidate a forty-call read of a series that moves on the scale of hours.
    queryKey: ['realisedVolBlocks', chainId, feed, blockLookback, blockSamples],
    enabled: enabled && !!feed && !!client && decimals !== undefined && needBlocks,
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<PriceObservation[]> => {
      if (!client || !feed || decimals === undefined) throw new Error('not ready');
      const headBlock = await client.getBlockNumber();
      return readBlockHistory(
        client as PublicClient,
        feed,
        decimals,
        blockLadder(headBlock, blockLookback, blockSamples),
      );
    },
  });

  const result = useMemo<Pick<UseRealisedVolResult, 'vol' | 'unavailable'>>(() => {
    if (!feed) return { unavailable: 'No price feed is configured for this pair.' };
    if (!roundEstimate) return {};

    if (roundEstimate.vol) {
      return { vol: { ...roundEstimate.vol, source: 'rounds', feed } };
    }

    if (!needBlocks || blocks.isLoading) return {};
    if (blocks.data) {
      const fromBlocks = estimateRealisedVol(blocks.data);
      if (fromBlocks.vol) return { vol: { ...fromBlocks.vol, source: 'blocks', feed } };
      return {
        unavailable: `${roundEstimate.unavailable} Reading the price back at ${blocks.data.length} past blocks did not find more: ${lowerFirst(fromBlocks.unavailable ?? '')}`,
      };
    }

    return { unavailable: roundEstimate.unavailable };
  }, [feed, roundEstimate, needBlocks, blocks.isLoading, blocks.data]);

  return {
    ...result,
    isLoading: head.isLoading || history.isLoading || (needBlocks && blocks.isLoading),
    error: ((head.error ?? history.error ?? blocks.error) as Error | null) ?? null,
    refetch: () => {
      void head.refetch();
      void history.refetch();
      void blocks.refetch();
    },
  };
}

/** Join one sentence onto another without a capital letter appearing mid-sentence. */
function lowerFirst(sentence: string): string {
  return sentence.charAt(0).toLowerCase() + sentence.slice(1);
}
