/**
 * Closed-form RMM-01, in the two places a bot actually needs it: where the reserves *should* sit at a
 * given spot, and what the router will return for a given input.
 *
 * THE POINT OF THIS FILE IS THAT NOTHING HERE IS A SEARCH.
 *
 * The naive arbitrage bot binary-searches `quote()` for the size that moves the marginal price to spot.
 * A `RmmSwap` quote costs 657-667k gas, so a 40-iteration bisection is ~26M gas against a 30M block limit
 * -- it does not fit in a block, and off-chain it is 40 round trips per leg per tick. It is also
 * unnecessary, because RMM-01 inverts in closed form:
 *
 *     marginal price at reserve X   p(X) = K * exp(z*s - s^2/2),   z = Phi^-1(1 - X/L),  s = sigma*sqrt(tau)
 *     set p(X) = S                  =>    z = d1 = (ln(S/K) + s^2/2) / s
 *                                   =>    X* = L * (1 - Phi(d1))          <- one Phi, no iteration
 *
 * From `X*` everything else is one `eth_call` into the router's own views (`stableFor` / `riskyFor`), so
 * the target point sits on the curve *as the chain computes it*, with the chain's approximated `Phi`,
 * not ours. `predictExactIn` then reproduces `RmmSwap.exec` in bigint arithmetic, wei for wei, including
 * the maker-favouring `EPS` guard band and the raw/normalised rate division. The bot prints its
 * prediction next to the router's `quote()` every time, and they are equal or the bot stops.
 */
import { normalCdf } from './gauss.ts';

export const WAD = 10n ** 18n;
export const YEAR_SECONDS = 365n * 24n * 60n * 60n;
/** `RmmSwap.TAU_FLOOR`. */
export const TAU_FLOOR_SECONDS = 3600n;
/** `RmmSwap.EPS` = `2e-6 * 1e18`, absolute in normalised units. */
export const EPS_WAD = 2_000_000_000_000n;

export interface CurveParams {
  /** `K`, WAD, normalised stable per risky. */
  strikeWad: bigint;
  /** Annualised implied vol, WAD. */
  sigmaWad: bigint;
  maturity: number;
  /** `L`, WAD, risky units. */
  liquidityWad: bigint;
  /** `10 ** (18 - decimals)` for each side. */
  rateRisky: bigint;
  rateStable: bigint;
}

/** `RmmSwap.tauOf` -- integer for integer. */
export function tauWad(maturity: number, nowSeconds: number | bigint): bigint {
  const now = BigInt(nowSeconds);
  const m = BigInt(maturity);
  if (now >= m) return 0n;
  let remaining = m - now;
  if (remaining < TAU_FLOOR_SECONDS) remaining = TAU_FLOOR_SECONDS;
  return (remaining * WAD) / YEAR_SECONDS;
}

/** `s = sigma*sqrt(tau)` as a float. Used only to choose where on the curve to aim. */
export function sigmaSqrtTau(p: CurveParams, nowSeconds: number | bigint): number {
  const tau = Number(tauWad(p.maturity, nowSeconds)) / 1e18;
  if (tau <= 0) return 0;
  return (Number(p.sigmaWad) / 1e18) * Math.sqrt(tau);
}

/**
 * Which asset the taker is paying in.
 * `riskyIn`: taker sells the risky asset into the leg (maker receives risky, pays stable).
 * `stableIn`: taker buys the risky asset from the leg (maker receives stable, pays risky).
 */
export type Side = 'riskyIn' | 'stableIn';

/**
 * The no-arbitrage risky reserve at spot `S`, in normalised WAD.
 *
 * After maturity `s = 0` and the curve is the constant-sum order `Y = K*(L - X)`: its marginal price is
 * `K` everywhere, so the target is a corner -- all risky below the strike, all stable above it.
 */
export function targetRiskyWad(spotWad: bigint, p: CurveParams, nowSeconds: number | bigint): bigint {
  const L = p.liquidityWad;
  const s = sigmaSqrtTau(p, nowSeconds);
  const S = Number(spotWad) / 1e18;
  const K = Number(p.strikeWad) / 1e18;
  if (s <= 0) return S >= K ? 0n : L;
  const d1 = (Math.log(S / K) + (s * s) / 2) / s;
  const fraction = 1 - normalCdf(d1); // in [0, 1]
  const scaled = BigInt(Math.round(fraction * 1e18));
  const clamped = scaled < 0n ? 0n : scaled > WAD ? WAD : scaled;
  return (L * clamped) / WAD;
}

/** The marginal price the curve quotes at risky reserve `X`, for printing the mispricing. */
export function marginalPriceWad(riskyWad: bigint, p: CurveParams, nowSeconds: number | bigint): bigint {
  const s = sigmaSqrtTau(p, nowSeconds);
  const K = Number(p.strikeWad) / 1e18;
  if (s <= 0) return p.strikeWad;
  const L = Number(p.liquidityWad) / 1e18;
  const x = Number(riskyWad) / 1e18;
  const ratio = Math.min(Math.max(1 - x / L, 1e-15), 1 - 1e-15);
  const z = inverseNormalCdf(ratio);
  return BigInt(Math.round(K * Math.exp(z * s - (s * s) / 2) * 1e18));
}

/**
 * `Phi^-1` by bisection on {@link normalCdf}.
 *
 * Only ever used for the *display* of a marginal price. The bot never inverts anything to size a trade --
 * that is the whole argument of this module -- and no shipped reserve is ever derived from this.
 */
function inverseNormalCdf(p: number): number {
  let lo = -12;
  let hi = 12;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (normalCdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * `RmmSwap`'s guard band in the units of whichever reserve leaves the leg.
 * Solidity: `epsOut = ceilDiv((riskyIn ? L*K/WAD : L) * EPS, WAD)`.
 */
export function epsOutWad(p: CurveParams, side: Side): bigint {
  const base = side === 'riskyIn' ? (p.liquidityWad * p.strikeWad) / WAD : p.liquidityWad;
  return ceilDiv(base * EPS_WAD, WAD);
}

export function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

export interface ExactInInputs {
  /** Normalised reserve of the token going in (`virtual * rateIn`). */
  balanceInWad: bigint;
  /** Normalised reserve of the token going out. */
  balanceOutWad: bigint;
  /** `stableOf(newIn)` or `riskyOf(newIn)`, read from the router at the block we are pricing at. */
  newOutWad: bigint;
  epsOutWad: bigint;
  /** `10 ** (18 - decimals)` of the outgoing token. */
  rateOut: bigint;
}

export interface ExactInPrediction {
  /** Raw units of the outgoing token, or `0n` when the trade is inside the band. */
  amountOut: bigint;
  /** Set when the curve would revert `RmmInsideSpread(shortfall)`. */
  insideSpreadShortfall?: bigint;
}

/**
 * `RmmSwap.exec`, exact-in branch, reproduced in bigint:
 *
 * ```solidity
 * uint256 newOut = riskyIn ? stableOf(newIn, ...) : riskyOf(newIn, ...);
 * if (newOut + epsOut > balanceOut) revert RmmInsideSpread(newOut + epsOut - balanceOut);
 * ctx.swap.amountOut = (balanceOut - newOut - epsOut) / rateOut;
 * ```
 */
export function predictExactIn(i: ExactInInputs): ExactInPrediction {
  const needed = i.newOutWad + i.epsOutWad;
  if (needed > i.balanceOutWad) return { amountOut: 0n, insideSpreadShortfall: needed - i.balanceOutWad };
  return { amountOut: (i.balanceOutWad - needed) / i.rateOut };
}

/**
 * The largest exact-in trade whose output the maker can actually deliver.
 *
 * `Coverage` reverts rather than clamping, so a bot that wants to be filled has to clamp itself. It does
 * that the same way it sizes anything else: pick the output (the coverage bound), ask the router which
 * reserve point that corresponds to, and read the input off the curve. One extra `eth_call`, no search.
 *
 * Returns the normalised reserve the outgoing side must land on; the caller passes it to `riskyFor` /
 * `stableFor` to get the required input.
 */
export function reserveOutForCappedAmount(balanceOutWad: bigint, capRaw: bigint, rateOut: bigint, eps: bigint): bigint {
  const capWad = capRaw * rateOut;
  const target = balanceOutWad - capWad - eps;
  return target > 0n ? target : 0n;
}
