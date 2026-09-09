/**
 * A refusal, in the width of a chart's empty state.
 *
 * `stableFor` reverts `RmmOutOfDomain` when a reserve is asked for outside `[0, L]`, and a quote
 * reverts `NotCovered(needed, free)` when the maker's wallet cannot deliver. Both are answers, not
 * outages, and both arrive decoded because `strikelineReadAbi` carries the error definitions
 * alongside the function ones. Printing viem's generic sentence instead would throw away the only
 * interesting thing on the screen.
 */
import { describeError } from '@/lib/ui/error';

/** `RmmOutOfDomain`, or `NotCovered(6000000000000000000, 5400000000000000000)`. */
export function terminalError(error: unknown): string | undefined {
  if (!error) return undefined;
  const decoded = describeError(error);
  if (!decoded.name) return decoded.message || undefined;
  return decoded.args.length > 0 ? `${decoded.name}(${decoded.args.join(', ')})` : decoded.name;
}
