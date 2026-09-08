/**
 * How long, in the two units a person steers by.
 *
 * `6d 4h`, `4h 12m`, `38m`. Three units is a stopwatch and one is a rounding; two is a decision.
 *
 * It lived in `TimeScrubber` while that component existed. The scrubber is now `components/offer`
 * and this is used by the writer as well, so it sits on its own rather than being imported through
 * a component that has nothing else to do with it.
 */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return 'matured';
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}
