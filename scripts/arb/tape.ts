/**
 * The price tape: a REAL Chainlink ETH/USD series captured from Base, replayed against the fork clock.
 *
 * Why this file exists at all. An arbitrage bot that trades our curve against a price WE move is a puppet
 * show, and a technical judge discounts it entirely. So the bot never sees a slider. It sees a tape of
 * rounds Chainlink actually published on Base (`capture.ts` reads them at the pinned fork block), replayed
 * one-to-one against the fork's own clock: warp the fork three days and the tape advances three real days.
 *
 * The tape is also what the fork's ETH/USD feed reports. `scripts/story` writes each replayed answer into the
 * mock aggregator installed at the real Chainlink proxy address, so the bot's reference price is an
 * `eth_call` into a feed at the canonical address rather than a number this process made up. Nothing in the
 * pricing path reads it -- `RmmSwap` is oracle-free -- it is only how the arbitrageur decides what is
 * mispriced, which is exactly the job an oracle does for a real arbitrageur.
 *
 * Storage format: round ids on this feed are consecutive, so a tick is just `[updatedAt, answer]` and the id
 * is `firstRoundId + index`. `capture.ts` asserts that before writing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Address } from 'viem';

const HERE = dirname(fileURLToPath(import.meta.url)); // scripts/arb

export const SERIES_PATH = resolve(HERE, 'series/base-ethusd.json');

/** One Chainlink round exactly as the aggregator published it: `[updatedAt, answer]`. */
export type PriceTick = readonly [t: number, answer: string];

export interface PriceSeries {
  description: string;
  chainId: number;
  feed: Address;
  feedDescription: string;
  decimals: number;
  phaseId: number;
  readAtBlock: number;
  /** Proxy round id of `ticks[0]`; ids are consecutive, so `ticks[i]` is `firstRoundId + i`. */
  firstRoundId: string;
  firstTimestamp: number;
  lastTimestamp: number;
  ticks: PriceTick[];
}

/** Where the fork clock sits on the tape: fork second `forkTs` is tape second `seriesTs`. */
export interface TapeAnchor {
  forkTs: number;
  seriesTs: number;
}

export interface TapeReading {
  /** Tape time the fork clock currently maps to. */
  seriesTs: number;
  /** Raw answer in feed decimals. */
  answer: bigint;
  /** Answer scaled to WAD (18 decimals), which is the unit the curve works in. */
  priceWad: bigint;
  /** Human price, for printing only. */
  priceUsd: number;
  roundId: string;
  /** Publication time of the round in force; `seriesTs - roundTs` is how stale the tape is. */
  roundTs: number;
  /** Index into `series.ticks`. */
  index: number;
  /** The fork clock has run past the end of the captured window. */
  beyondTape: boolean;
}

export function loadSeries(path: string = SERIES_PATH): PriceSeries {
  if (!existsSync(path)) {
    throw new Error(`price tape ${path} not found -- run \`make tape\` (tsx scripts/arb/capture.ts)`);
  }
  const series = JSON.parse(readFileSync(path, 'utf8')) as PriceSeries;
  if (!series.ticks?.length) throw new Error(`price tape ${path} has no rounds`);
  return series;
}

export class Tape {
  private readonly wadScale: bigint;

  constructor(
    readonly series: PriceSeries,
    readonly anchor: TapeAnchor,
  ) {
    this.wadScale = 10n ** BigInt(18 - series.decimals);
  }

  /** Fork second -> tape second. One-to-one: the demo replays real time at real speed. */
  seriesTimeFor(forkTs: number | bigint): number {
    return this.anchor.seriesTs + (Number(forkTs) - this.anchor.forkTs);
  }

  /** The round in force at tape time `t` (the last one published at or before it). */
  at(forkTs: number | bigint): TapeReading {
    const seriesTs = this.seriesTimeFor(forkTs);
    const ticks = this.series.ticks;
    let lo = 0;
    let hi = ticks.length - 1;
    if (seriesTs < ticks[0][0]) hi = 0;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ticks[mid][0] <= seriesTs) lo = mid;
      else hi = mid - 1;
    }
    const [roundTs, rawAnswer] = ticks[lo];
    const answer = BigInt(rawAnswer);
    return {
      seriesTs,
      answer,
      priceWad: answer * this.wadScale,
      priceUsd: Number(answer) / 10 ** this.series.decimals,
      roundId: (BigInt(this.series.firstRoundId) + BigInt(lo)).toString(),
      roundTs,
      index: lo,
      beyondTape: seriesTs > this.series.lastTimestamp,
    };
  }

  /** Human summary of where the tape came from, printed once per scene so the claim is auditable. */
  provenance(): string {
    const s = this.series;
    const days = ((s.lastTimestamp - s.firstTimestamp) / 86_400).toFixed(2);
    return (
      `${s.ticks.length} real Chainlink ${s.feedDescription} rounds from Base ` +
      `(feed ${s.feed}, phase ${s.phaseId}, read at block ${s.readAtBlock}), ` +
      `${days} days: ${new Date(s.firstTimestamp * 1000).toISOString()} -> ${new Date(s.lastTimestamp * 1000).toISOString()}`
    );
  }
}

/** Default anchor: the demo's first second is the tape's first second, so the whole window is ahead of us. */
export function anchorAtStart(forkTs: number | bigint, series: PriceSeries): TapeAnchor {
  return { forkTs: Number(forkTs), seriesTs: series.firstTimestamp };
}
