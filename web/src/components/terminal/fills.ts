/**
 * Which offers were filled between two reads of the book.
 *
 * A fill is done by a taker, not by the maker watching this screen, so nothing in the app knows it
 * happened except the next read. This compares that read against the previous one for the same
 * strategy hashes: an offer that is live in both and whose earnings rose, or whose reserves moved,
 * was traded against. A row that only appeared, disappeared or was withdrawn is not a fill, and a
 * change of wallet starts over rather than diffing two different books.
 */

export interface FillSnapshotLeg {
  hash: string;
  maker: string;
  live: boolean;
  /** Earned so far in `earnedSymbol`, or undefined while that read is pending. */
  earned?: bigint;
  earnedSymbol: string;
  earnedDecimals: number;
  reserveRisky: bigint;
  reserveStable: bigint;
  strikeLabel: string;
  kind: 'call' | 'put';
}

export interface DetectedFill {
  hash: string;
  /** How much more this offer has earned since the last read; undefined when only reserves moved. */
  delta?: bigint;
  symbol: string;
  decimals: number;
  strikeLabel: string;
  kind: 'call' | 'put';
}

export function detectFills(
  previous: readonly FillSnapshotLeg[] | undefined,
  next: readonly FillSnapshotLeg[],
): DetectedFill[] {
  if (!previous || previous.length === 0 || next.length === 0) return [];
  const makersBefore = new Set(previous.map((l) => l.maker.toLowerCase()));
  const makersNow = new Set(next.map((l) => l.maker.toLowerCase()));
  const sameWallet = [...makersNow].every((m) => makersBefore.has(m));
  if (!sameWallet) return [];

  const before = new Map(previous.map((l) => [l.hash, l]));
  const fills: DetectedFill[] = [];
  for (const leg of next) {
    const held = before.get(leg.hash);
    if (!held || !held.live || !leg.live) continue;

    const earnedRose =
      held.earned !== undefined &&
      leg.earned !== undefined &&
      held.earnedSymbol === leg.earnedSymbol &&
      leg.earned > held.earned;
    const reservesMoved = held.reserveRisky !== leg.reserveRisky || held.reserveStable !== leg.reserveStable;
    if (!earnedRose && !reservesMoved) continue;

    fills.push({
      hash: leg.hash,
      delta: earnedRose ? leg.earned! - held.earned! : undefined,
      symbol: leg.earnedSymbol,
      decimals: leg.earnedDecimals,
      strikeLabel: leg.strikeLabel,
      kind: leg.kind,
    });
  }
  return fills.slice(0, 3);
}
