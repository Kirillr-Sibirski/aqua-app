/**
 * What the writer is holding while a book is being drafted.
 *
 * A draft is deliberately not a partially-built `Order`. Everything that decides the strategy hash
 * — the strike, the vol, the maturity, the liquidity, the salt — is kept as plain data until the
 * moment the chain has returned the reserve to ship, because an order built from a reserve that
 * has not been read back is an order that might be one wei off the curve.
 */
import type { Address, Hex } from 'viem';
import type { LegKind, RmmArgs } from '@/components/curve';
import type { Order } from '@/lib/swapvm';

/** The pair a book is written against: one risky asset, one stable. */
export interface WritePair {
  risky: { address: Address; symbol: string; decimals: number };
  stable: { address: Address; symbol: string; decimals: number };
  /** Chainlink feed for the risky asset, used for spot and for realised vol. */
  feed: Address;
  /** True when the risky token is the one with the lower address, i.e. `tokenA`. */
  riskyIsTokenA: boolean;
}

/** One leg of the ladder, as the maker is editing it. */
export interface LegDraft {
  /** Stable across edits, so React keys and the salt do not move under the row. */
  id: string;
  /** Moneyness offset the chip carried, kept so the row can say `+10%` after spot moves. */
  offset: number;
  /** Strike in stable per risky, as a display number. `strikeWad` is what ships. */
  strike: number;
  strikeWad: bigint;
  kind: LegKind;
  /** `L` in risky units, as the maker typed it. */
  notional: string;
  liquidityWad: bigint;
  /** Maker-owned monotonic nonce, fixed when the leg is added so the hash stops moving. */
  salt: bigint;
}

/** A leg after the chain has told us where the curve is. Everything needed to ship it. */
export interface SizedLeg {
  draft: LegDraft;
  rmm: RmmArgs;
  program: Hex;
  order: Order;
  strategyHash: Hex;
  /** Normalised reserves that will actually be shipped, after decimal rounding. */
  xWad: bigint;
  yWad: bigint;
  /** Raw token amounts, in the order's own `(tokenA, tokenB)` order. */
  tokens: readonly [Address, Address];
  amounts: readonly [bigint, bigint];
  /** The same amounts named, for the margin preview. */
  riskyRaw: bigint;
  stableRaw: bigint;
}

/** The steps of the wizard, in order. */
export const WRITE_STEPS = ['strikes', 'review', 'ship'] as const;
export type WriteStep = (typeof WRITE_STEPS)[number];
