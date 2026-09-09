/**
 * The one place JavaScript asks the same question the stylesheet asks.
 *
 * `globals.css` ends with a `prefers-reduced-motion: reduce` block that collapses the three
 * duration tokens to 1ms and neutralises every transition and animation on the page. That covers
 * everything CSS drives. It cannot cover a value that is being interpolated in JavaScript, because
 * a tween that runs for 170ms of wall clock does so whether or not any property is transitioning.
 *
 * So this exists, and every JS-driven motion in the app checks it before starting: under the media
 * feature the figure is set to its target on the same commit rather than tweened to it, which is
 * the jump branch. It is a function rather than a hook deliberately — it is read at the moment a
 * transition starts, not subscribed to, so a person who changes the setting mid-session gets the
 * new behaviour on the next figure that moves without every component on the screen re-rendering.
 */
export function prefersReducedMotion(): boolean {
  // No window means the server, where nothing animates and the first paint is the target value.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
