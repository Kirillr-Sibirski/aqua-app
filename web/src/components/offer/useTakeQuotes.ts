'use client';

/**
 * What it costs to take this offer, asked of the router rather than worked out here.
 *
 * Two reads, both `router.quote(order, amount, takerTraitsAndData)` over one multicall each:
 *
 *   useQuoteLadder    a ladder of sizes, priced. This is the price curve in the sense a person
 *                     means it -- what you pay per WETH for a trade of this size, right now.
 *   useSmallestFill   the smallest trade that actually clears, MEASURED. `bandFor` publishes the
 *                     number; this asks the router to fill it and reports what came back.
 *
 * The second one exists because a published minimum and a minimum that clears are two different
 * claims. `RmmSwap.exec` does not clear a trade *at* the curve: it requires the new output reserve
 * to sit a guard band (`EPS`, 2e-6 of the leg) inside what the leg holds, so a UI that printed the
 * curve gap alone would print a number that reverts. `StrikelineViews.bandFor` was corrected to
 * include that guard, and this hook is how the screen knows it stayed corrected: it quotes the
 * published figure and the raw unit below it, and if the published figure is refused it walks a
 * ladder upward and prints the first amount the router agreed to fill. Never the one that reverts.
 *
 * `quote` is a view here — `quoteWithStrikelineErrorsAbi` types it that way so it goes out as a
 * plain `eth_call` — and it carries both instructions' custom errors, so a refusal comes back as
 * `RmmInsideSpread` or `NotCovered(needed, free)` rather than an undecoded blob. On this product a
 * refusal is usually the answer.
 */
import { useMemo } from 'react';
import { type Address, type Hex } from 'viem';
import { useReadContracts } from 'wagmi';
import { aquaFork, type SupportedChainId } from '@/lib/chain';
import { buildTakerTraits, type Order } from '@/lib/swapvm';
import { ceilDiv, decodeRevert, quoteWithStrikelineErrorsAbi } from '@/hooks/strikeline';

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/**
 * Who the quote is asked as.
 *
 * `quote` reads the MAKER's wallet through `Coverage`, never the taker's, so the answer does not
 * depend on this address having any tokens — which is what lets a disconnected visitor see the
 * price. It is still sent as a real `from`, because `takerTraits` carries the taker and the router
 * checks the two agree.
 */
const PROBE_TAKER: Address = '0x000000000000000000000000000000000000dEaD';

export interface QuoteRow {
  /** What was asked for: an output size when `isExactIn` is false. */
  request: bigint;
  amountIn?: bigint;
  amountOut?: bigint;
  /** Decoded custom error name when the router refused. */
  refusedAs?: string;
  /** `NotCovered(needed, free)` / `RmmExceedsReserve(requested, available)` arguments. */
  refusedArgs?: bigint[];
}

function takerTraitsFor(taker: Address, isAToB: boolean, isExactIn: boolean): Hex {
  return buildTakerTraits({
    taker,
    isExactIn,
    isAToB,
    // The Aqua path: the router pulls tokenIn from the taker and pushes it into Aqua, which is the
    // shape every fill in this app takes. A quote priced under different traits is a quote for a
    // trade nobody is going to send.
    useTransferFromAndAquaPush: true,
  });
}

function rowsFrom(
  amounts: readonly bigint[],
  data: readonly { status: 'success' | 'failure'; result?: unknown; error?: unknown }[] | undefined,
): QuoteRow[] {
  if (!data) return [];
  return amounts.map((request, i) => {
    const entry = data[i];
    if (!entry) return { request };
    if (entry.status === 'success') {
      const [amountIn, amountOut] = entry.result as readonly [bigint, bigint, Hex];
      return { request, amountIn, amountOut };
    }
    const decoded = decodeRevert(entry.error);
    return {
      request,
      refusedAs: decoded?.name ?? 'refused',
      ...(decoded?.args ? { refusedArgs: decoded.args } : {}),
    };
  });
}

// ---------------------------------------------------------------------------
// The price ladder
// ---------------------------------------------------------------------------

export interface UseQuoteLadderParams {
  router?: Address;
  order?: Order;
  /** True when the taker pays tokenA and receives tokenB. */
  isAToB?: boolean;
  /** Largest output the ladder should ask for, in raw units of the token that leaves. */
  maxOut?: bigint;
  /** How many rungs. Each is one `eth_call` inside a single multicall. */
  steps?: number;
  taker?: Address;
  chainId?: SupportedChainId;
  enabled?: boolean;
  refetchInterval?: number | false;
}

export interface UseQuoteLadderResult {
  rows: QuoteRow[];
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
}

/**
 * `quote()` at evenly spaced sizes, exact-OUT.
 *
 * Exact-out because the question a person asks is "what does five WETH cost", not "what does 14,000
 * USDC buy". The answer comes back as `amountIn`, and `amountIn / amountOut` is the price per unit
 * the row prints — a division of two chain-returned integers, not a model.
 *
 * Rungs that revert are kept rather than dropped: `NotCovered` at the top of the ladder is the
 * shared wallet saying how much of the advertised size it can really deliver, which is a more
 * interesting number than a shorter line.
 */
export function useQuoteLadder({
  router,
  order,
  isAToB,
  maxOut,
  steps = 8,
  taker = PROBE_TAKER,
  chainId = aquaFork.id,
  enabled = true,
  refetchInterval = 12_000,
}: UseQuoteLadderParams): UseQuoteLadderResult {
  const amounts = useMemo<bigint[]>(() => {
    if (maxOut === undefined || maxOut <= BigInt(0)) return [];
    const n = Math.max(2, Math.min(24, Math.floor(steps)));
    const out: bigint[] = [];
    for (let i = 1; i <= n; i += 1) {
      const value = (maxOut * BigInt(i)) / BigInt(n);
      if (value > BigInt(0) && out.at(-1) !== value) out.push(value);
    }
    return out;
  }, [maxOut, steps]);

  const traits = useMemo(
    () => (isAToB === undefined ? undefined : takerTraitsFor(taker, isAToB, false)),
    [isAToB, taker],
  );

  const query = useReadContracts({
    contracts: amounts.map(
      (amount) =>
        ({
          address: router ?? ZERO_ADDRESS,
          abi: quoteWithStrikelineErrorsAbi,
          functionName: 'quote',
          args: [order as Order, amount, traits ?? '0x'],
          account: taker,
          chainId,
        }) as const,
    ),
    allowFailure: true,
    query: {
      enabled: enabled && !!router && !!order && !!traits && amounts.length > 0,
      refetchInterval,
      retry: false,
      gcTime: 60_000,
    },
  });

  return {
    rows: rowsFrom(amounts, query.data),
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: (query.error as Error | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// The smallest trade that clears
// ---------------------------------------------------------------------------

/**
 * The ladder of candidate inputs, in raw units of the token the taker pays.
 *
 * One below the published figure, the published figure, and then a geometric walk upward. The walk
 * exists for the case the published figure is refused: it is what turns "this reverts" into "this
 * is what clears", and its rungs are wide enough to cross a guard band (2e-6 of the leg, so ~450
 * ppm of a typical band) several times over before they get expensive.
 *
 * All integer arithmetic on a number the chain returned. Nothing here computes a curve.
 */
export function fillProbeAmounts(published: bigint): bigint[] {
  if (published <= BigInt(0)) return [];
  const out: bigint[] = [];
  if (published > BigInt(1)) out.push(published - BigInt(1));
  out.push(published);
  for (const ppm of [10, 100, 1_000, 10_000, 100_000, 1_000_000] as const) {
    const next = published + ceilDiv(published * BigInt(ppm), BigInt(1_000_000)) + BigInt(1);
    if (out.at(-1) !== next) out.push(next);
  }
  return out;
}

export interface SmallestFill {
  /** What `bandFor` published, converted to raw units by ceiling. */
  published: bigint;
  /** The smallest probed amount the router actually filled. Undefined when none of them did. */
  clears?: bigint;
  /** What that trade buys. Near dust at the threshold: the whole trade is the accrued decay. */
  buys?: bigint;
  /** True when the published figure itself cleared. */
  publishedClears: boolean;
  /** True when one raw unit below the published figure was refused — the bound is tight. */
  oneBelowRefused: boolean;
  /** Why the amount below was refused, decoded. */
  refusedAs?: string;
  rows: QuoteRow[];
}

export interface UseSmallestFillParams {
  router?: Address;
  order?: Order;
  isAToB?: boolean;
  /** `bandFor`'s minimum on the side the taker pays, already in raw units. */
  published?: bigint;
  taker?: Address;
  chainId?: SupportedChainId;
  enabled?: boolean;
  refetchInterval?: number | false;
}

export function useSmallestFill({
  router,
  order,
  isAToB,
  published,
  taker = PROBE_TAKER,
  chainId = aquaFork.id,
  enabled = true,
  refetchInterval = 12_000,
}: UseSmallestFillParams): {
  fill?: SmallestFill;
  isLoading: boolean;
  error: Error | null;
} {
  const amounts = useMemo(
    () => (published === undefined ? [] : fillProbeAmounts(published)),
    [published],
  );

  const traits = useMemo(
    () => (isAToB === undefined ? undefined : takerTraitsFor(taker, isAToB, true)),
    [isAToB, taker],
  );

  const query = useReadContracts({
    contracts: amounts.map(
      (amount) =>
        ({
          address: router ?? ZERO_ADDRESS,
          abi: quoteWithStrikelineErrorsAbi,
          functionName: 'quote',
          args: [order as Order, amount, traits ?? '0x'],
          account: taker,
          chainId,
        }) as const,
    ),
    allowFailure: true,
    query: {
      enabled: enabled && !!router && !!order && !!traits && amounts.length > 0,
      refetchInterval,
      retry: false,
      gcTime: 60_000,
    },
  });

  const fill = useMemo<SmallestFill | undefined>(() => {
    if (published === undefined || !query.data) return undefined;
    const rows = rowsFrom(amounts, query.data);
    const cleared = rows.find((r) => r.amountOut !== undefined);
    const publishedRow = rows.find((r) => r.request === published);
    const belowRow = rows.find((r) => r.request === published - BigInt(1));
    return {
      published,
      ...(cleared?.request === undefined ? {} : { clears: cleared.request }),
      ...(cleared?.amountOut === undefined ? {} : { buys: cleared.amountOut }),
      publishedClears: publishedRow?.amountOut !== undefined,
      oneBelowRefused: belowRow !== undefined && belowRow.amountOut === undefined,
      ...(belowRow?.refusedAs ? { refusedAs: belowRow.refusedAs } : {}),
      rows,
    };
  }, [published, query.data, amounts]);

  return { fill, isLoading: query.isLoading, error: (query.error as Error | null) ?? null };
}
