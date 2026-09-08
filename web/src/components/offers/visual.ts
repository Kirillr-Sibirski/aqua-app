/**
 * The one visual convention the positions view repeats, in a single place so it cannot drift.
 *
 * A hatched fill means **written but not simultaneously deliverable**: the part of a claim that
 * sits beyond what the wallet can hand over right now. It is used at both scales — across the whole
 * backing bar and inside a single row's depth bar — and it survives greyscale, which is why it is
 * a hatch and not a lighter shade of the same blue.
 */
import { colorMix } from '@/lib/ui';

const ZERO = BigInt(0);

/** 45-degree hairlines in the dim accent. Applied as `backgroundImage` over any surface. */
export const HATCH = `repeating-linear-gradient(45deg, ${colorMix('accent-dim', 70)} 0 3px, transparent 3px 7px)`;

/**
 * `value / span` as a percentage, clamped to the bar and never overstated: the ratio truncates at
 * 1e-6, so a segment can only ever be drawn slightly short of the value it stands for.
 */
export function pct(value: bigint, span: bigint): number {
  if (span === ZERO) return 0;
  const scaled = Number((value * BigInt(1_000_000)) / span) / 1_000_000;
  return Math.min(100, Math.max(0, scaled * 100));
}
