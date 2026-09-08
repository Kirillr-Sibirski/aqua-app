/**
 * What the card is holding while an offer is being drafted.
 *
 * A `SizedOffer` is deliberately only ever built from a reserve the chain has returned. Everything
 * that decides the strategy hash — the price, the volatility, the date, the notional, the salt — is
 * plain data until `stableFor` has answered, because an offer built from a reserve that has not
 * been read back is an offer that might be one wei off the curve.
 */
import type { Address, Hex } from 'viem';
import type { RmmArgs } from '@/components/curve';
import type { Order } from '@/lib/swapvm';

/** The two tokens an offer is written between: the one being sold, and the one it is priced in. */
export interface OfferPair {
  risky: { address: Address; symbol: string; decimals: number };
  stable: { address: Address; symbol: string; decimals: number };
  /** Chainlink feed for the asset being sold: today's price, and the volatility default. */
  feed: Address;
  /** True when the asset being sold is the token with the lower address, i.e. `tokenA`. */
  riskyIsTokenA: boolean;
}

/** An offer after the chain has told us where the curve is. Everything needed to publish it. */
export interface SizedOffer {
  rmm: RmmArgs;
  program: Hex;
  order: Order;
  strategyHash: Hex;
  /** The amount on offer, normalised. Exactly what the person typed. */
  xWad: bigint;
  /** The stable reserve the curve requires there, from `stableFor`, after decimal rounding. */
  yWad: bigint;
  /** What a taker pays on top of the price to be assigned the whole amount. From the chain. */
  earnedWad: bigint;
  /** Where the curve sits at expiry, `K*(L - x)`. From the chain's settlement branch. */
  settlementWad: bigint;
  /** `K + earned/x`: what the sale actually works out at per unit. */
  effectivePriceWad: bigint;
  /** Raw token amounts. */
  riskyRaw: bigint;
  stableRaw: bigint;
  /** Aqua's own `(tokenA, tokenB)` order, and the amounts in it. */
  tokens: readonly [Address, Address];
  amounts: readonly [bigint, bigint];
}
