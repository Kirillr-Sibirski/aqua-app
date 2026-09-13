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

/**
 * Which way an offer trades. `sell` is a covered call: WETH on offer, sold as the price rises.
 * `buy` is a cash-secured put: USDC on offer, spent on WETH as the price falls.
 */
export type OfferSide = 'sell' | 'buy';

/** An offer after the chain has told us where the curve is. Everything needed to publish it. */
export interface SizedOffer {
  side: OfferSide;
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
  /** Sell: `K + earned/x`, what the sale works out at. Buy: `K - earned/(L - x)`, what the purchase does. */
  effectivePriceWad: bigint;
  /** Raw token amounts. */
  riskyRaw: bigint;
  stableRaw: bigint;
  /** Aqua's own `(tokenA, tokenB)` order, and the amounts in it. */
  tokens: readonly [Address, Address];
  amounts: readonly [bigint, bigint];
  /**
   * True when this was priced without a wallet attached.
   *
   * `stableFor` is a view and needs no signer, so the card can quote a real offer before anyone
   * connects — which is the thing that makes a swap page worth staying on. Everything numeric is
   * therefore honest in this state. What is NOT honest is the identity: `order.maker` is the zero
   * address, so `strategyHash` is the hash of a program nobody could publish. The flag exists so
   * the one surface that shows the hash and the bytes can decline to show them rather than print a
   * reference that resolves to nothing.
   */
  preview: boolean;
}
