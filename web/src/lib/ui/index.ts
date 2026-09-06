/**
 * UI foundation: class merging, design tokens, and the display formatters.
 *
 * The visual system itself lives in `src/app/globals.css`; this directory is the TypeScript side of
 * it. Nothing here renders — components import from it, never the other way round.
 */
export { cn } from './cn';
export * from './tokens';
export * from './format';
