/**
 * Motion, and the short list of moments that get any.
 *
 * The screen has four: a figure changing, a fill landing on a row, a read settling into the shape
 * held for it, and a control moving between its states. Everything else on this terminal is still —
 * no reveals on load, nothing on scroll, no lift under the pointer, no decorative pulse — because a
 * desk tool that moves when nothing has happened teaches a reader to stop looking.
 *
 * Every export here has a `prefers-reduced-motion` branch, and there are only two of them: the CSS
 * duration tokens, which `globals.css` collapses to 1ms, and `prefersReducedMotion()`, which the
 * tweens read before they start. `Reveal` takes the first; `useTweenedBigInt`, `useTweenedNumber`
 * and every duration this module measures take both.
 */
export { Reveal, type RevealProps } from './Reveal';
export { prefersReducedMotion } from './reducedMotion';
export { durationMs, easeOutQuart, lerpBigInt, lerpNumber, parseDuration, type DurationToken } from './tween';
export { useLandings, type LandingsOptions, type LandingStage } from './useLandings';
export { useTweenedBigInt, useTweenedNumber, type TweenOptions } from './useTweened';
