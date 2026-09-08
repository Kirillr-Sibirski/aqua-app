/**
 * Guards on the one dataset in this app that no chain read can re-derive.
 *
 * The receipt screen renders a simulation. That is allowed, and it is labelled everywhere, but it means
 * the usual safety net is gone: nothing on the page can be checked against a node. So the committed data
 * is checked here instead, against the arithmetic it claims to satisfy and against the shape the charts
 * need in order to draw a mark at all.
 *
 * Two of these tests exist because of bugs that were live in this feature. `dailyRowIndices` picked rows
 * by an index stride and silently skipped a day; and the whole reason a chart is worth testing at all is
 * that this repo has already shipped a legend advertising a path with a 0x0 bounding box.
 */
import { describe, expect, it } from 'vitest';
import {
  REPLAY,
  SIGMA_SWEEP,
  WINDOW_SWEEP,
  dailyRowIndices,
  daysFrom,
  difference,
  headlineOf,
  replayIsUsable,
} from '../replay';

const DAY = 86_400;

describe('the replay the receipt screen renders', () => {
  it('is a simulation, and says so in the data itself', () => {
    expect(REPLAY.simulation).toBe(true);
    expect(REPLAY.kind).toBe('strikeline-markout-replay');
    expect(REPLAY.disclaimer.toLowerCase()).toContain('not a track record');
    expect(replayIsUsable(REPLAY)).toBe(true);
  });

  it('carries every figure as an exact integer', () => {
    const walk = (node: unknown): void => {
      if (typeof node === 'number') {
        expect(Number.isSafeInteger(node)).toBe(true);
        return;
      }
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === 'object') Object.values(node).forEach(walk);
    };
    walk(REPLAY);
  });

  it('starts all four strategies on the same mark', () => {
    const s = REPLAY.series;
    expect(s.strikeline6[0]).toBe(s.hodl6[0]);
    expect(s.cpLow6[0]).toBe(s.hodl6[0]);
    expect(s.cpHigh6[0]).toBe(s.hodl6[0]);
    expect(s.strikeline6[0]).toBe(REPLAY.totals.start6);
  });

  it('splits the difference from holding into two parts that add up', () => {
    const t = REPLAY.totals;
    const versusHold = t.strikeline6 - t.hodl6;
    // Micro-dollar rounding of two independently truncated sums; a dollar of slack is generous.
    expect(Math.abs(t.markout6 + t.upside6 - versusHold)).toBeLessThan(1_000_000);
  });

  it('reports the arbitrageur taking exactly what the maker gave up on the fills', () => {
    // Against an arbitrage-only taker the maker's cash markout IS minus the taker's profit. If these
    // two ever drift apart, the simulation has grown a source of money that nobody paid.
    expect(REPLAY.totals.markout6).toBe(-REPLAY.totals.takerProfit6);
  });

  it('ends the series on the totals it reports', () => {
    const s = REPLAY.series;
    const last = s.t.length - 1;
    expect(s.strikeline6[last]).toBe(REPLAY.totals.strikeline6);
    expect(s.hodl6[last]).toBe(REPLAY.totals.hodl6);
    expect(s.cpLow6[last]).toBe(REPLAY.totals.cpLow6);
    expect(s.fills[last]).toBe(REPLAY.totals.fills);
  });

  it('covers the whole expiry with an ascending, roughly hourly series', () => {
    const s = REPLAY.series;
    for (let i = 1; i < s.t.length; i++) expect(s.t[i]).toBeGreaterThan(s.t[i - 1]);
    const span = s.t[s.t.length - 1] - s.t[0];
    expect(span).toBeGreaterThan((REPLAY.expiryDays - 1) * DAY);
    expect(span).toBeLessThanOrEqual(REPLAY.expiryDays * DAY);
    expect(s.t.length).toBeGreaterThan(REPLAY.expiryDays * 20);
  });
});

describe('what the charts get to draw', () => {
  it('gives every series a range worth plotting', () => {
    const s = REPLAY.series;
    for (const series of [s.strikeline6, s.hodl6, s.cpLow6, s.cpHigh6, s.spot6]) {
      const span = Math.max(...series) - Math.min(...series);
      // A path whose whole extent is a rounding error is the 0x0 mark this repo has shipped before.
      expect(span / Math.max(...series)).toBeGreaterThan(0.001);
    }
  });

  it('separates the book from holding by more than a hairline at the end', () => {
    const gap = difference(REPLAY.series.strikeline6, REPLAY.series.hodl6);
    const span = Math.max(...REPLAY.series.strikeline6) - Math.min(...REPLAY.series.strikeline6);
    expect(Math.abs(gap[gap.length - 1]) / span).toBeGreaterThan(0.02);
  });

  it('names one row per whole day and never the same day twice', () => {
    const s = REPLAY.series;
    const rows = dailyRowIndices(s);
    const days = daysFrom(s);
    const labels = rows.slice(0, -1).map((i) => Math.floor(days[i]));
    expect(labels).toEqual(labels.map((_, d) => d));
    expect(rows[rows.length - 1]).toBe(s.t.length - 1);
    for (let i = 1; i < rows.length; i++) expect(rows[i]).toBeGreaterThan(rows[i - 1]);
  });

  it('derives the headline by subtraction and nothing else', () => {
    const h = headlineOf(REPLAY);
    const t = REPLAY.totals;
    expect(h.versusHold6).toBe(t.strikeline6 - t.hodl6);
    expect(h.versusCpLow6).toBe(t.strikeline6 - t.cpLow6);
    expect(h.netEth6).toBe(t.endWeth6 - REPLAY.walletWeth6);
  });
});

describe('the sweeps, published whole', () => {
  it('brackets the volatility the tape realised on both sides', () => {
    const implied = SIGMA_SWEEP.impliedVolBps;
    expect(Math.min(...implied)).toBeLessThan(SIGMA_SWEEP.realisedVolBps);
    expect(Math.max(...implied)).toBeGreaterThan(SIGMA_SWEEP.realisedVolBps);
  });

  it('keeps a cell where the book is beaten, rather than only the ones where it wins', () => {
    const beaten = SIGMA_SWEEP.vsCpLow6.some((value) => value < 0);
    expect(beaten).toBe(true);
  });

  it('agrees with the headline run on the cell they share', () => {
    const i = SIGMA_SWEEP.impliedVolBps.indexOf(REPLAY.totals.impliedVolBps);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(SIGMA_SWEEP.fills[i]).toBe(REPLAY.totals.fills);
    expect(SIGMA_SWEEP.vsHold6[i]).toBe(REPLAY.totals.strikeline6 - REPLAY.totals.hodl6);

    const w = WINDOW_SWEEP.offsetHours.indexOf(0);
    expect(w).toBeGreaterThanOrEqual(0);
    expect(WINDOW_SWEEP.fills[w]).toBe(REPLAY.totals.fills);
    expect(WINDOW_SWEEP.realisedVolBps[w]).toBe(REPLAY.totals.realisedVolBps);
  });

  it('counts its own wins correctly', () => {
    const wins = WINDOW_SWEEP.vsHold6.filter((value) => value > 0).length;
    expect(WINDOW_SWEEP.wins).toBe(wins);
    expect(WINDOW_SWEEP.offsetHours.length).toBeGreaterThanOrEqual(4);
  });
});
