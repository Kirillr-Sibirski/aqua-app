/**
 * How much of what an offer promises its wallet could hand over right now.
 *
 * The one arithmetic on the positions strip, and it is here rather than inline in the row so that
 * the two things that make it easy to get wrong are pinned by a test: it takes bigints from the
 * chain, and it must never divide by zero or exceed one.
 *
 *   `written` is what the offer advertises — its whole virtual reserve of the delivery token.
 *   `open`    is what the `Coverage` guard itself reported when the offer was probed for that
 *             whole amount, or `min(coverage, reserve)` when the probe cleared.
 *
 * The division happens in bigint space and lands in a float only at the last step, at four decimal
 * places, which is three more than a nine-cell meter can show. Doing it as
 * `Number(open) / Number(written)` would be the same picture until a token with eighteen decimals
 * and a large reserve pushed a numerator past `Number.MAX_SAFE_INTEGER`.
 */
const ZERO = BigInt(0);
const SCALE = BigInt(10_000);

/**
 * `open / written`, clamped to `[0, 1]`.
 *
 * An offer with nothing written is fully backed by definition — there is nothing to back — and
 * returning 1 keeps a fully-taken row from drawing an empty meter that reads as a shortfall.
 */
export function backingRatio(open: bigint, written: bigint): number {
  if (written <= ZERO) return 1;
  if (open <= ZERO) return 0;
  if (open >= written) return 1;
  return Number((open * SCALE) / written) / Number(SCALE);
}
