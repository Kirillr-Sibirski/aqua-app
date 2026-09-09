/**
 * Axis labels, and the one thing an axis must never do: print the same label twice.
 *
 * The values below are the real ones. A strike of 1 against a spot of 2,442 makes the payoff view's
 * y-domain degenerate — every gridline within a part in a thousand of `x*L` — and the axis printed
 * `10.4M` four times, as four separate labels on one chart, while the ticket beside it correctly
 * refused the input. The chart now refuses too, but the formatter is fixed independently: a
 * degenerate domain can arrive from any view and a repeated label is a lie about the scale.
 */
import { describe, expect, it } from 'vitest';
import { tickFormatter } from '../format';

describe('tickFormatter', () => {
  it('keeps compact labels distinct by spending more significant figures', () => {
    const ticks = [10_400_000, 10_400_100, 10_400_200, 10_400_300];
    const at = tickFormatter(ticks);
    const labels = ticks.map(at);
    expect(new Set(labels).size).toBe(4);
    expect(labels[0]).not.toBe(labels[1]);
  });

  it('spells the numbers out when even six figures cannot separate them', () => {
    const ticks = [10_400_000, 10_400_000.5];
    const labels = ticks.map(tickFormatter(ticks));
    expect(new Set(labels).size).toBe(2);
    expect(labels[0]).toContain(',');
  });

  it('still compacts an ordinary wide axis to three figures', () => {
    const ticks = [0, 500_000, 1_000_000, 1_500_000];
    expect(ticks.map(tickFormatter(ticks))).toEqual(['0', '500K', '1M', '1.5M']);
  });

  it('gives every tick on one axis the same fraction digits', () => {
    const ticks = [2400, 2450.5, 2500];
    expect(ticks.map(tickFormatter(ticks))).toEqual(['2,400.0', '2,450.5', '2,500.0']);
  });

  it('does not chase distinctness through a single tick', () => {
    expect([1_000_000].map(tickFormatter([1_000_000]))).toEqual(['1M']);
  });
});
