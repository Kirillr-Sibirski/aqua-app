'use client';

/**
 * One offer, priced by the chain.
 *
 * This is the highest-consequence code on the card, so it is worth being explicit about the split:
 *
 *  - **`x` is what the person typed.** The amount field is the amount that goes on offer, in raw
 *    token units, so the risky reserve is exact by construction rather than derived.
 *  - **`L` is chosen here**, in floating point, by `liquidityForRisky`. Choosing it selects which
 *    of a continuum of legitimate offers puts that amount on the curve; a millionth either way is a
 *    slightly differently-priced offer, not a wrong one.
 *  - **`y` is read from the chain.** `StrikelineViews.stableFor(K, sigma, T, L, x)` returns the
 *    stable reserve the curve requires, computed with the router's own approximated `Phi` and
 *    rounded the way the instruction rounds it. One wei low and every quote on the offer reverts
 *    for the rest of its life; one wei high and the surplus goes to the first taker. And because
 *    `Aqua.ship` requires `tokensCount == 0` and `dock` writes `0xff` permanently, an offer shipped
 *    wrong cannot be re-shipped under the same hash. There is no recovery, so there is no float.
 *
 * The same view answers the two numbers under the button, which is why they are chain reads and not
 * a model. `stableFor` with a maturity of zero puts the curve in its settlement branch, where
 * `RmmSwap.stableOf` degenerates in closed form to `K*(L - x)` — the constant-sum order the offer
 * becomes at expiry. So:
 *
 *   what you earn        = stableFor(..., maturity: 0, x) - stableFor(..., maturity, x)
 *   the price you get    = K + earn / x
 *
 * Both terms come out of the same function on the same contract in the same multicall, and neither
 * is reconstructed here.
 */
import { useMemo } from 'react';
import { keccak256, type Address, type Hex } from 'viem';
import { useReadContracts } from 'wagmi';
import {
  ASSIGNMENT_WINDOW_SECONDS,
  FLAG_RISKY_IS_TOKEN_A,
  WAD,
  buildLegProgram,
  expiryFlagsFor,
  rateFor,
  strikelineReadAbi,
  toRawReserve,
  type ProtocolFee,
  type RmmArgs,
} from '@/components/curve';
import { aquaFork, type SupportedChainId } from '@/lib/chain';
import { buildAquaOrder, encodeStrategyForShip } from '@/lib/swapvm';
import { liquidityForRisky, liquidityForStable } from './moneyness';
import type { OfferPair, OfferSide, SizedOffer } from './types';

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/**
 * How coarsely the clock that picks `L` is read.
 *
 * `L` depends on `tau`, so read against the raw block timestamp it would move on every block and
 * take the strategy hash, the reserves and every figure on the card with it. Quantising to a minute
 * holds the card still. It costs nothing: `L` is the choice, and a minute of drift in a choice is
 * another legitimate offer. Everything that must be exact — `y`, and the settlement value — is
 * still read from the chain at the real `block.timestamp` inside the same call.
 */
const CHOICE_BUCKET_SECONDS = 60;

export interface UseOfferParams {
  router?: Address;
  maker?: Address;
  pair?: OfferPair;
  /** `sell` puts the risky asset on offer; `buy` puts the stable asset on offer to buy it with. */
  side?: OfferSide;
  /** How much goes on offer, in raw units of the token that side offers: risky to sell, stable to buy. */
  amountRaw: bigint;
  /** The price, WAD, stable per risky. */
  strikeWad?: bigint;
  /** Annualised volatility, WAD. The maker's choice; no oracle supplies it. */
  sigmaWad?: bigint;
  maturity?: number;
  /** Spot from the price feed. Picks where on the curve the offer starts, and nothing else. */
  spot?: number;
  /** The chain's clock, seconds. */
  nowSeconds?: number;
  /** Maker-owned nonce, fixed while the offer is on screen so the hash stops moving. */
  salt?: bigint;
  /** Protocol fee written into the program; omitted means a fee-less leg. */
  protocolFee?: ProtocolFee;
  chainId?: SupportedChainId;
  enabled?: boolean;
}

export interface UseOfferResult {
  offer?: SizedOffer;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useOffer({
  router,
  maker,
  pair,
  side = 'sell',
  amountRaw,
  strikeWad,
  sigmaWad,
  maturity,
  spot,
  nowSeconds,
  salt,
  protocolFee,
  chainId = aquaFork.id,
  enabled = true,
}: UseOfferParams): UseOfferResult {
  /**
   * The curve's own `tau`, in years, from the quantised clock. `RmmSwap.tauOf` floors the remaining
   * time at one hour and returns zero once matured; mirroring that here keeps the point this picks
   * on the same curve the router is about to price.
   */
  const tau = useMemo(() => {
    if (nowSeconds === undefined || maturity === undefined) return undefined;
    const at = Math.floor(nowSeconds / CHOICE_BUCKET_SECONDS) * CHOICE_BUCKET_SECONDS;
    if (at >= maturity) return 0;
    return Math.max(maturity - at, 3_600) / (365 * 86_400);
  }, [nowSeconds, maturity]);

  /** `x` exactly as it will ship, and the `L` that puts it on the curve at this price. */
  const chosen = useMemo(() => {
    if (!pair || amountRaw <= BigInt(0)) return undefined;
    if (strikeWad === undefined || sigmaWad === undefined || tau === undefined || spot === undefined) {
      return undefined;
    }
    const rateRisky = rateFor(pair.risky.decimals);
    const input = { spot, strike: Number(strikeWad) / 1e18, sigma: Number(sigmaWad) / 1e18, tau };
    if (side === 'buy') {
      // The stable typed is the target; `x` and `L` are chosen to put that much on the curve at spot,
      // and `x` is floored to a whole raw unit of the risky token so it ships exactly.
      const sized = liquidityForStable(amountRaw * rateFor(pair.stable.decimals), input);
      if (!sized) return undefined;
      const riskyRaw = sized.riskyWad / rateRisky;
      if (riskyRaw <= BigInt(0)) return undefined;
      return { xWad: riskyRaw * rateRisky, liquidityWad: sized.liquidityWad, riskyRaw };
    }
    const xWad = amountRaw * rateRisky;
    const liquidityWad = liquidityForRisky(xWad, input);
    return { xWad, liquidityWad, riskyRaw: amountRaw };
  }, [pair, side, amountRaw, strikeWad, sigmaWad, tau, spot]);

  /*
   * A wallet is NOT a precondition for pricing.
   *
   * `StrikelineViews.stableFor` is a view: it takes five numbers and returns a reserve, and no part
   * of it reads an account. The card used to gate this whole query on `maker`, so a first-time
   * visitor saw two em dashes where "what you earn" and "what you give up" belong — on a page that
   * was already printing today's price from the feed and next Friday from the block clock. A DEX
   * quotes you a real rate from the pool before you connect anything, and that live number is what
   * makes you stay; ours showed a form with two blanks and asked for a wallet first.
   *
   * So the reads run either way. Only the identity needs a maker, and `preview` marks the offers
   * that do not have one.
   */
  const ready = enabled && !!router && !!pair && !!chosen && maturity !== undefined && sigmaWad !== undefined;

  const contracts = useMemo(() => {
    const args = [
      strikeWad ?? BigInt(0),
      sigmaWad ?? BigInt(0),
      maturity ?? 0,
      chosen?.liquidityWad ?? BigInt(0),
      chosen?.xWad ?? BigInt(0),
    ] as const;
    return [
      // Where the curve is now: the reserve to ship.
      {
        address: router ?? ZERO_ADDRESS,
        abi: strikelineReadAbi,
        functionName: 'stableFor',
        args,
        chainId,
      } as const,
      // Where the curve is at expiry. A maturity of zero is in the past for any block, so
      // `tauOf` returns zero and the curve is its settlement branch, `Y = K*(L - X)`. The gap
      // between the two is what a taker has to pay on top of the price to be assigned.
      {
        address: router ?? ZERO_ADDRESS,
        abi: strikelineReadAbi,
        functionName: 'stableFor',
        args: [args[0], args[1], 0, args[3], args[4]] as const,
        chainId,
      } as const,
    ];
  }, [router, strikeWad, sigmaWad, maturity, chosen, chainId]);

  const query = useReadContracts({
    contracts,
    allowFailure: false,
    query: {
      enabled: ready,
      // A stale reserve is a wrong reserve, and it can go stale two ways. Usually the query re-keys
      // on its own, because `L` is chosen from a `tau` that shrinks. But between two buckets the
      // arguments stop moving while the answer does not: `StrikelineViews._sNow` reads
      // `block.timestamp`, so `stableFor` returns a different `y` for the same five arguments at a
      // later block. The poll is what closes that second door.
      staleTime: 4_000,
      refetchInterval: 8_000,
      retry: false,
    },
  });

  const offer = useMemo<SizedOffer | undefined>(() => {
    if (!query.data || !pair || !chosen || maturity === undefined) return undefined;
    if (strikeWad === undefined || sigmaWad === undefined) return undefined;

    const [yWanted, ySettlementWanted] = query.data as unknown as readonly [bigint, bigint];
    const rateRisky = rateFor(pair.risky.decimals);
    const rateStable = rateFor(pair.stable.decimals);
    const { raw: stableRaw, normalised: yWad } = toRawReserve(yWanted, rateStable);

    /*
     * What a taker pays on top of the price, and what that makes the sale worth per unit.
     *
     * At expiry the curve is `Y = K*(L - X)`, so taking the whole risky reserve out costs the
     * difference between that line and the stable reserve actually on the offer. Both numbers are
     * the router's; the arithmetic between them is a subtraction and a division, not a curve.
     */
    const earnedWad = ySettlementWanted > yWad ? ySettlementWanted - yWad : BigInt(0);
    /* Sell: the whole `x` goes at `K`, plus the premium spread over it. Buy: assignment brings in the
       `L - x` the offer is still short of, for the stable it holds, so the premium comes off `K`. */
    const effectivePriceWad =
      side === 'buy'
        ? strikeWad - (earnedWad * WAD) / (chosen.liquidityWad - chosen.xWad)
        : strikeWad + (earnedWad * WAD) / chosen.xWad;

    const rmm: RmmArgs = {
      flags: (pair.riskyIsTokenA ? FLAG_RISKY_IS_TOKEN_A : 0) | expiryFlagsFor(side === 'buy' ? 'put' : 'call'),
      sigmaWad,
      maturity,
      strikeWad,
      liquidityWad: chosen.liquidityWad,
      rateRisky,
      rateStable,
    };

    const program = buildLegProgram({
      rmm,
      deadline: maturity + ASSIGNMENT_WINDOW_SECONDS,
      salt: salt ?? BigInt(0),
      protocolFee,
    });

    const tokenA = pair.riskyIsTokenA ? pair.risky.address : pair.stable.address;
    const tokenB = pair.riskyIsTokenA ? pair.stable.address : pair.risky.address;
    // Without a wallet the order is a shape rather than a publishable thing: `preview` says so, and
    // the one surface that renders the hash hides it in that state instead of printing a reference
    // that resolves to nothing.
    const order = buildAquaOrder({ maker: maker ?? ZERO_ADDRESS, tokenA, tokenB, program });
    const strategyHash = keccak256(encodeStrategyForShip(order)) as Hex;

    return {
      side,
      rmm,
      program,
      order,
      strategyHash,
      xWad: chosen.xWad,
      yWad,
      earnedWad,
      settlementWad: ySettlementWanted,
      effectivePriceWad,
      riskyRaw: chosen.riskyRaw,
      stableRaw,
      tokens: [tokenA, tokenB] as const,
      preview: !maker,
      amounts: (pair.riskyIsTokenA
        ? ([chosen.riskyRaw, stableRaw] as const)
        : ([stableRaw, chosen.riskyRaw] as const)) satisfies readonly [bigint, bigint],
    };
  }, [query.data, pair, side, chosen, maker, maturity, strikeWad, sigmaWad, salt, protocolFee]);

  return {
    offer,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: (query.error as Error | null) ?? null,
    refetch: () => {
      void query.refetch();
    },
  };
}
