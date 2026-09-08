'use client';

/**
 * One offer, assembled from the chain and nothing else.
 *
 * There is no database row behind this screen. `Aqua.ship` takes the strategy whole "for data
 * availability", so the `Shipped` log carries the entire program and the 62 argument bytes of its
 * `RmmSwap` instruction hold the price, the date, the size and the volatility in the clear. This
 * hook finds that log by strategy hash, decodes it exactly as `RmmSwap.parse` decodes it at fill
 * time, and attaches the live virtual reserves Aqua records against the same hash.
 *
 * Every derived number below is arithmetic on those bytes -- a rate multiply, a subtraction of two
 * unix seconds. None of it is option maths. The curve, the band and the deliverable depth are all
 * read from the router, in the hooks beside this one.
 */
import { useMemo } from 'react';
import { type Address, type Hex } from 'viem';
import { useBlock } from 'wagmi';
import {
  FLAG_POST_EXPIRY_ONE_WAY,
  FLAG_POST_EXPIRY_OUT_IS_RISKY,
  FLAG_RISKY_IS_TOKEN_A,
  decodeRmmSwapArgs,
  findRmmArgs,
  type RmmArgs,
} from '@/components/curve';
import { useDeployments, useShippedStrategies } from '@/hooks';
import { aquaFork } from '@/lib/chain';
import { tokenInfo, type ShippedStrategy, type TokenInfo } from '@/lib/contracts';

export type Deployments = NonNullable<ReturnType<typeof useDeployments>['deployments']>;

/**
 * Which way round a taker takes this offer.
 *
 * Not inferred from a price feed. The maker declared it when they set the one-way settlement flags,
 * and those flags are what the instruction enforces in the assignment window, so they are also the
 * honest thing to put in a sentence: `call` means the taker buys the risky asset out of the offer,
 * `put` means the taker sells it in.
 */
export type OfferKind = 'call' | 'put' | 'two-way';

export interface Offer {
  strategy: ShippedStrategy;
  rmm: RmmArgs;
  kind: OfferKind;
  /** The asset on offer: WETH on a call. */
  risky: TokenInfo;
  /** What it is priced in: USDC. */
  stable: TokenInfo;
  riskyToken: Address;
  stableToken: Address;
  /** Live virtual reserves in raw token units, as Aqua's ledger currently records them. */
  riskyRaw: bigint;
  stableRaw: bigint;
  /** The same pair lifted into the normalised WAD space the curve works in. */
  xWad: bigint;
  yWad: bigint;
  /** Both reserves keyed by lowercase token address, for the fill replay. */
  rawByToken: Record<string, bigint>;
  /** Whichever token leaves the offer when somebody takes it. */
  outToken: Address;
  inToken: Address;
  /** True when the taker pays tokenA and receives tokenB. */
  isAToB: boolean;
  strikeWad: bigint;
  liquidityWad: bigint;
  sigmaWad: bigint;
  maturity: number;
  /** The chain's clock, never the browser's: the demo fork is time-warped on purpose. */
  chainNow?: number;
  /** Seconds until the date on the offer, floored at zero. */
  remainingSeconds?: number;
  expired: boolean;
  withdrawn: boolean;
}

export interface UseOfferResult {
  offer?: Offer;
  deployments?: Deployments;
  /** The strategy was found but carries no `RmmSwap` instruction: a program, not an offer. */
  notAnOffer?: ShippedStrategy;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useOffer(hash: string): UseOfferResult {
  const { deployments } = useDeployments();
  const strategies = useShippedStrategies(undefined, { all: true });
  const block = useBlock({ chainId: aquaFork.id, watch: true, query: { staleTime: 4_000 } });
  const chainNow = block.data ? Number(block.data.timestamp) : undefined;

  const strategy = useMemo(
    () => strategies.strategies.find((s) => s.strategyHash.toLowerCase() === hash.toLowerCase()),
    [strategies.strategies, hash],
  );

  const offer = useMemo<Offer | undefined>(() => {
    if (!strategy || !deployments) return undefined;
    const args = findRmmArgs(strategy.program);
    if (!args) return undefined;
    const rmm = decodeRmmSwapArgs(args);

    // Which token is the risky one is a flag in the program, not a guess from a symbol.
    const riskyIsTokenA = (rmm.flags & FLAG_RISKY_IS_TOKEN_A) !== 0;
    const riskyToken = riskyIsTokenA ? strategy.tokens[0] : strategy.tokens[1];
    const stableToken = riskyIsTokenA ? strategy.tokens[1] : strategy.tokens[0];

    const rawByToken: Record<string, bigint> = {};
    for (const b of strategy.balances) rawByToken[b.token.toLowerCase()] = b.balance;
    const riskyRaw = rawByToken[riskyToken.toLowerCase()] ?? BigInt(0);
    const stableRaw = rawByToken[stableToken.toLowerCase()] ?? BigInt(0);

    const kind: OfferKind =
      rmm.flags & FLAG_POST_EXPIRY_ONE_WAY
        ? rmm.flags & FLAG_POST_EXPIRY_OUT_IS_RISKY
          ? 'call'
          : 'put'
        : 'two-way';

    // On a call the taker buys the risky asset out of the offer; on a put they sell it in. A
    // two-way leg has no gate at its date, and the direction that matters is still the one the
    // reserves are heavy in, which for every leg this app writes is the risky side.
    const outToken = kind === 'put' ? stableToken : riskyToken;
    const inToken = kind === 'put' ? riskyToken : stableToken;

    return {
      strategy,
      rmm,
      kind,
      risky: tokenInfo(riskyToken, deployments),
      stable: tokenInfo(stableToken, deployments),
      riskyToken,
      stableToken,
      riskyRaw,
      stableRaw,
      xWad: riskyRaw * rmm.rateRisky,
      yWad: stableRaw * rmm.rateStable,
      rawByToken,
      outToken,
      inToken,
      isAToB: inToken.toLowerCase() === strategy.tokens[0].toLowerCase(),
      strikeWad: rmm.strikeWad,
      liquidityWad: rmm.liquidityWad,
      sigmaWad: rmm.sigmaWad,
      maturity: rmm.maturity,
      chainNow,
      remainingSeconds: chainNow === undefined ? undefined : Math.max(rmm.maturity - chainNow, 0),
      expired: chainNow !== undefined && chainNow >= rmm.maturity,
      withdrawn: strategy.docked,
    };
  }, [strategy, deployments, chainNow]);

  return {
    offer,
    deployments,
    notAnOffer: strategy && !offer ? strategy : undefined,
    isLoading: strategies.isLoading,
    error: (strategies.error as Error | null) ?? null,
    refetch: () => void strategies.refetch(),
  };
}

/** The strategy hash as it appears in a URL, normalised so a mixed-case link still resolves. */
export function normaliseHash(hash: string): Hex {
  return (hash.startsWith('0x') ? hash.toLowerCase() : `0x${hash.toLowerCase()}`) as Hex;
}
