/**
 * The replay's numbers, as the screen sees them.
 *
 * EVERY FIGURE ON `/receipt` COMES FROM THIS MODULE, AND EVERY FIGURE IN IT COMES FROM A FOUNDRY RUN.
 * `contracts/test/markout/MarkoutReplay.t.sol` writes `replay.json`, `sweep-sigma.json` and
 * `sweep-window.json` as it executes; `scripts/markout/publish.ts` validates them and copies them into
 * `./data`. Nothing here recomputes a result, models a curve, or fills a gap: if a number is not in those
 * files it does not appear on the screen.
 *
 * That matters more on this screen than on any other in the app. Everywhere else the rule is that a figure
 * must come from a chain read the reader can repeat. Here the figures come from a simulation, which is the
 * one exception DESIGN.md allows and only while it is labelled as one. So the screen labels it in the
 * title, in a banner above the fold, in the chart captions, in the page description and in the file this
 * data ships in.
 *
 * Units are integers throughout: `*6` is millionths (USD micro-dollars, micro-ETH), `*Bps` is basis points
 * of a ratio. Nothing exceeds 2^53, which `publish.ts` re-checks, so JSON carries every figure exactly and
 * no float rounding happens between the EVM and the pixel.
 */
import replayData from './data/replay.json';
import sigmaSweepData from './data/sweep-sigma.json';
import windowSweepData from './data/sweep-window.json';
import { formatPercent, formatUnits, formatUsd } from '@/lib/ui/format';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface ReplaySeries {
  /** Unix seconds of each recorded point, roughly hourly. */
  t: number[];
  /** ETH price on the tape, micro-dollars. */
  spot6: number[];
  /** Mark of the Strikeline book, micro-dollars. */
  strikeline6: number[];
  /** Mark of 10.4 WETH + 24,850 USDC held untouched. */
  hodl6: number[];
  /** Mark of a constant-product position at the low fee tier. */
  cpLow6: number[];
  /** The same at the high fee tier. */
  cpHigh6: number[];
  /** Cumulative markout of the fills, micro-dollars. Negative against an arbitrage-only taker. */
  markout6: number[];
  /** Cumulative price effect of the inventory the book traded. */
  upside6: number[];
  /** WETH the maker's wallet held, micro-ETH. */
  weth6: number[];
  /** Cumulative fills. */
  fills: number[];
}

export interface ReplayTotals {
  attempts: number;
  fills: number;
  declinedByTaker: number;
  refusedByCurve: number;
  markout6: number;
  upside6: number;
  start6: number;
  strikeline6: number;
  hodl6: number;
  cpLow6: number;
  cpHigh6: number;
  takerProfit6: number;
  timeValueAtStart6: number;
  endWeth6: number;
  endUsdc6: number;
  advertisedRisky6: number;
  /** Highest and lowest price on any round in the window, not on the thinned record. */
  peakSpot6: number;
  troughSpot6: number;
  impliedVolBps: number;
  realisedVolBps: number;
}

export interface ReplayLegs {
  label: string[];
  /** `'call'` (an offer to sell ETH) or `'put'` (an offer to buy it). */
  kind: string[];
  strike6: number[];
  liquidity6: number[];
  fills: number[];
  markout6: number[];
}

export interface ReplayTape {
  feed: string;
  feedDescription: string;
  chainId: number;
  readAtBlock: number;
  rounds: number;
  firstTimestamp: number;
  lastTimestamp: number;
  source: string;
}

export interface Replay {
  kind: string;
  simulation: boolean;
  disclaimer: string;
  generatedBy: string;
  walletWeth6: number;
  walletUsdc6: number;
  expiryDays: number;
  cpFeeLowBps: number;
  cpFeeHighBps: number;
  tape: ReplayTape;
  legs: ReplayLegs;
  totals: ReplayTotals;
  series: ReplaySeries;
}

export interface SigmaSweep {
  realisedVolBps: number;
  impliedVolBps: number[];
  fills: number[];
  netEth6: number[];
  timeValue6: number[];
  vsHold6: number[];
  vsCpLow6: number[];
  vsCpHigh6: number[];
}

export interface WindowSweep {
  impliedVolBps: number;
  wins: number;
  offsetHours: number[];
  startSpot6: number[];
  endSpot6: number[];
  fills: number[];
  realisedVolBps: number[];
  vsHold6: number[];
  vsCpLow6: number[];
  vsCpHigh6: number[];
}

export const REPLAY = replayData as Replay;
export const SIGMA_SWEEP = sigmaSweepData as SigmaSweep;
export const WINDOW_SWEEP = windowSweepData as WindowSweep;

/**
 * The one guard the screen keeps at runtime.
 *
 * The data is a build-time import, so it cannot be missing, slow or unauthorised — three of the five
 * states a data surface normally ships do not exist here, and pretending otherwise with a spinner would
 * be theatre. What can still happen is that the file is regenerated into a shape the screen does not
 * understand, and that has to render as an error rather than as a chart of nothing.
 */
export function replayIsUsable(replay: Replay): boolean {
  const s = replay.series;
  const n = s.t.length;
  if (n < 2 || replay.kind !== 'strikeline-markout-replay' || !replay.simulation) return false;
  return [s.spot6, s.strikeline6, s.hodl6, s.cpLow6, s.cpHigh6, s.weth6, s.fills].every(
    (series) => series.length === n,
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Micro-dollars to `$49,816.27`. Routed through the app's own formatter, not `toLocaleString`. */
export function usd(micro: number, opts: { sign?: 'auto' | 'always' } = {}): string {
  return formatUsd(BigInt(Math.round(micro)), 6, { sign: opts.sign ?? 'auto' });
}

/** Micro-ETH to `10.7219`. */
export function eth(micro: number, fractionDigits = 4): string {
  return formatUnits(BigInt(Math.round(micro)), 6, {
    significantDigits: 18,
    minFractionDigits: fractionDigits,
    maxFractionDigits: fractionDigits,
    sign: 'auto',
  });
}

/** Basis points of a ratio to `46.57%`. */
export function volPercent(bps: number, fractionDigits = 2): string {
  return formatPercent(bps / 10_000, { fractionDigits });
}

/** A share, already a ratio, as a percentage. */
export function sharePercent(ratio: number, fractionDigits = 1): string {
  return formatPercent(ratio, { fractionDigits });
}

/** Micro-dollars to whole dollars, for a chart scale that works in `number`. */
export function toDollars(micro: number): number {
  return micro / 1e6;
}

/** Days elapsed since the first recorded point, the x axis every chart here uses. */
export function daysFrom(series: ReplaySeries): number[] {
  const t0 = series.t[0];
  return series.t.map((t) => (t - t0) / 86_400);
}

/**
 * One row index per whole day, plus the last point.
 *
 * Chosen by elapsed time rather than by taking every 24th sample, and by the first point at or after each
 * boundary rather than the last one before it. The feed publishes unevenly, so an index stride drifts off
 * the day boundary within a week and silently skips one; taking the point just before a boundary labels
 * it with the previous day and prints two rows called day 0. Both were live in this table.
 */
export function dailyRowIndices(series: ReplaySeries): number[] {
  const t = series.t;
  const t0 = t[0];
  const lastDay = Math.floor((t[t.length - 1] - t0) / 86_400);
  const rows: number[] = [];
  let cursor = 0;
  for (let day = 0; day < lastDay; day++) {
    const want = t0 + day * 86_400;
    while (cursor + 1 < t.length && t[cursor] < want) cursor++;
    rows.push(cursor);
  }
  rows.push(t.length - 1);
  return rows;
}

/**
 * The lowest price the book offered to SELL at.
 *
 * Not the lowest strike in the ladder: the cash-secured put is an offer to buy, and using it as "your
 * price" made the page say ETH never reached $2,300 when the sentence was about the $2,600 call. The
 * kind comes from the data, not from parsing a label.
 */
export function lowestSellStrike6(legs: ReplayLegs): number {
  const calls = legs.strike6.filter((_, i) => legs.kind[i] === 'call');
  return calls.length > 0 ? Math.min(...calls) : Math.min(...legs.strike6);
}

// ---------------------------------------------------------------------------
// Derived, and only ever by subtraction
// ---------------------------------------------------------------------------

/** `a - b`, elementwise, in micro-dollars. */
export function difference(a: readonly number[], b: readonly number[]): number[] {
  return a.map((value, i) => value - b[i]);
}

/** What the whole run comes to, in the order the screen states it. */
export interface Headline {
  versusHold6: number;
  versusCpLow6: number;
  versusCpHigh6: number;
  /** Share of the ladder's time value that the difference from holding represents. */
  capturedOfTimeValue: number;
  /** The book's return over the window, as a share of the capital it started with. */
  returnOnStart: number;
  holdReturnOnStart: number;
  netEth6: number;
}

export function headlineOf(replay: Replay): Headline {
  const t = replay.totals;
  return {
    versusHold6: t.strikeline6 - t.hodl6,
    versusCpLow6: t.strikeline6 - t.cpLow6,
    versusCpHigh6: t.strikeline6 - t.cpHigh6,
    capturedOfTimeValue:
      t.timeValueAtStart6 === 0 ? 0 : (t.strikeline6 - t.hodl6) / t.timeValueAtStart6,
    returnOnStart: (t.strikeline6 - t.start6) / t.start6,
    holdReturnOnStart: (t.hodl6 - t.start6) / t.start6,
    netEth6: t.endWeth6 - replay.walletWeth6,
  };
}
