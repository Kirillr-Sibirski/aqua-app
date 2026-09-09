/**
 * The arithmetic behind every moving figure on this screen, and none of the React.
 *
 * Two decisions are worth stating, because both are the reason this file exists rather than a
 * dependency.
 *
 * **The tween is over the chain's own integer, not over a float.** Every figure on this terminal
 * arrives as a bigint in a token's smallest unit and is rendered by `formatUnits` at that token's
 * fixed precision. A number ticker that takes a JS `number` would have to be handed
 * `Number(formatUnits(...))` — a float of a value the whole app is careful never to hold as one —
 * and would then re-implement the grouping and the decimal convention that
 * `components/token/registry` owns. `lerpBigInt` interpolates the integer instead, so every frame
 * of a transition is a real quantity in the token's own units and the existing formatter prints it.
 * The last frame is the target exactly, by construction rather than by rounding.
 *
 * **The duration is read from the CSS token, not written here.** `--duration-base` lives in
 * `globals.css` beside `--duration-fast` and `--duration-slow`, and the reduced-motion block at the
 * bottom of that file collapses all three to 1ms. A tween that reads the token therefore inherits
 * the same reduced-motion branch the transitions have, from the same declaration, instead of
 * carrying a second copy of the policy that can drift from it.
 */

/** The curve the whole app eases on: `--ease-out-quart`, as a function. */
export function easeOutQuart(t: number): number {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return 1 - (1 - clamped) ** 4;
}

/** Fixed-point denominator for the bigint interpolation: six places is far below one wei of any
 *  quantity this app prints, and keeps the multiply inside a range bigints handle exactly.
 *  Written as a call rather than a literal because this app compiles below ES2020, which is also
 *  why every other bigint constant in it is spelled `BigInt(0)`. */
const SCALE_UNITS = 1_000_000;
const SCALE = BigInt(SCALE_UNITS);

/**
 * A point between two integers, exact at both ends.
 *
 * `t >= 1` returns `to` itself rather than an arithmetic approximation of it, which is what makes
 * "the figure lands on the number the chain returned" true rather than nearly true.
 */
export function lerpBigInt(from: bigint, to: bigint, t: number): bigint {
  if (t <= 0) return from;
  if (t >= 1) return to;
  const scaled = BigInt(Math.round(easeOutQuart(t) * SCALE_UNITS));
  return from + ((to - from) * scaled) / SCALE;
}

/** The same, for the one quantity on the screen that is genuinely a ratio: backing. */
export function lerpNumber(from: number, to: number, t: number): number {
  if (t <= 0) return from;
  if (t >= 1) return to;
  return from + (to - from) * easeOutQuart(t);
}

/** Fallbacks for the three duration tokens, used only where no document can be read. */
const FALLBACK_MS: Record<DurationToken, number> = {
  '--duration-fast': 140,
  '--duration-base': 170,
  '--duration-slow': 200,
};

export type DurationToken = '--duration-fast' | '--duration-base' | '--duration-slow';

/** `170ms` / `0.17s` / `1ms` -> milliseconds. Anything unparseable is not a duration. */
export function parseDuration(value: string): number | undefined {
  const text = value.trim();
  if (text.endsWith('ms')) {
    const ms = Number.parseFloat(text.slice(0, -2));
    return Number.isFinite(ms) ? ms : undefined;
  }
  if (text.endsWith('s')) {
    const s = Number.parseFloat(text.slice(0, -1));
    return Number.isFinite(s) ? s * 1000 : undefined;
  }
  return undefined;
}

/**
 * How long a state change takes, in milliseconds, from the stylesheet rather than from here.
 *
 * Under `prefers-reduced-motion: reduce` `globals.css` sets these to 1ms, so this returns 1 and
 * every tween in the app finishes on its first frame — the same branch, taken once, in one file.
 */
export function durationMs(token: DurationToken = '--duration-base'): number {
  if (typeof document === 'undefined') return FALLBACK_MS[token];
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token);
  return parseDuration(raw) ?? FALLBACK_MS[token];
}
