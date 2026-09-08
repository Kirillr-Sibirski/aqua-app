/**
 * What a surface is made of.
 *
 * One shape for both read paths. The subgraph and the direct log read produce the same `SurfaceLeg`,
 * so nothing downstream knows or cares which one answered, and the two can be diffed against each
 * other when both are available.
 */
import type { Address, Hex } from 'viem';

/** Where a leg's terms came from. Shown on screen, never inferred silently. */
export type SurfaceSource = 'subgraph' | 'logs';

/** The chain-priced half of a leg. Absent until `SurfaceLens` answers; never modelled in the app. */
export interface LegPricing {
  /** Time to maturity in years, WAD, as the curve itself sees it (floored at one hour, 0 once matured). */
  tauWad: bigint;
  /** The curve's own marginal price, stable per risky, normalised WAD. Equals K once matured. */
  markWad: bigint;
  /** `X/L` — the leg's delta, in risky per unit of liquidity. Read off the reserve, not modelled. */
  deltaWad: bigint;
  /** `C_BS` per unit of liquidity, measured as `S - V/L`. Signed: a clamp would hide the error bar. */
  premiumWad: bigint;
  /** `V = S*X + Y`, the leg's mark-to-market in normalised stable units. */
  valueWad: bigint;
  /** The accrued theta band: the smallest trade that clears, raw token units, rounded up. */
  minRiskyIn: bigint;
  minStableIn: bigint;
  /** `min(balanceOf, allowance)` of the maker's wallet. Shared with every leg that maker wrote. */
  freeRisky: bigint;
  freeStable: bigint;
  /** `min(reserve, free)`: the largest fill this leg can honour right now. */
  deliverableRisky: bigint;
  deliverableStable: bigint;
  matured: boolean;
}

/** One option, decoded from the bytes its maker shipped. */
export interface SurfaceLeg {
  /** Aqua's strategy hash: `keccak256(strategy)`, and also `SwapVM.hash(order)`. */
  strategyHash: Hex;
  maker: Address;
  app: Address;
  tokenRisky: Address;
  tokenStable: Address;
  riskyIsTokenA: boolean;

  /** K, WAD, normalised stable per risky. */
  strikeWad: bigint;
  /** The maker's implied vol, annualised, WAD. The surface's third axis. */
  sigmaWad: bigint;
  /** Expiry, unix seconds. */
  maturity: number;
  /** Fixed L, WAD, risky units: the notional this leg writes. */
  liquidityWad: bigint;
  rateRisky: bigint;
  rateStable: bigint;
  flags: number;
  /** The program wraps the curve in `Coverage`, so its depth is margined rather than advertised. */
  guarded: boolean;

  /** Aqua's virtual reserves, raw token units. */
  reserveRisky: bigint;
  reserveStable: bigint;
  docked: boolean;
  shippedAtBlock: bigint;

  /** The connected wallet wrote this one. */
  mine: boolean;

  pricing?: LegPricing;
}

/**
 * One cell of the surface: every maker's leg on the same pair, at the same strike and expiry.
 *
 * This is the aggregation Aqua has no notion of. A strategy is opaque bytes keyed by its own hash;
 * nothing in the registry relates two makers who wrote the same option, so this grouping only
 * exists once the log has been decoded.
 */
export interface SurfacePoint {
  key: string;
  /** The pair is part of the cell's identity: `strikeWad` is normalised, so 2,800 is not one strike. */
  tokenRisky: Address;
  tokenStable: Address;
  strikeWad: bigint;
  maturity: number;
  legs: SurfaceLeg[];
  /** Live legs only, newest quote first by vol. */
  liveLegs: SurfaceLeg[];
  /** Widest live implied vol here: the maker paying the most theta. */
  maxSigmaWad: bigint;
  minSigmaWad: bigint;
  /** Sum of L over the live legs. */
  liveLiquidityWad: bigint;
  /** At least one live leg is written from the connected wallet. */
  mine: boolean;
}

/** The census the screen prints above the chart. Every figure is a count of decoded facts. */
export interface SurfaceCensus {
  legs: number;
  liveLegs: number;
  makers: number;
  strikes: number;
  expiries: number;
  /** Sum of L across live legs, WAD, in risky units. */
  writtenWad: bigint;
  /** Live legs whose program carries the Coverage wrapper. */
  guarded: number;
  /** Strategies on the router that decoded to something other than a Strikeline leg. */
  foreign: number;
}
