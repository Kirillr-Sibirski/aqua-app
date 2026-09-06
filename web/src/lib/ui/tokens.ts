/**
 * The design tokens, readable from TypeScript.
 *
 * CSS owns the values (`src/app/globals.css`); this module is the typed handle on them for the
 * places a class name cannot reach: SVG `fill`/`stroke` props, chart scales, `<meta name="theme-color">`,
 * and motion configs. Every entry here has a counterpart custom property, and the two are kept in
 * step by `node scripts/contrast.mjs`, which reads the same numbers.
 *
 * Rule of thumb: reach for a Tailwind class first (`text-ink-2`, `bg-surface`, `rounded-card`).
 * Use `color()` only where a class cannot be applied.
 */

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

export const COLOR_TOKENS = [
  'bg',
  'surface',
  'surface-2',
  'line',
  'line-strong',
  'ink',
  'ink-2',
  'ink-3',
  'accent',
  'accent-ink',
  'accent-dim',
  'pos',
  'neg',
  'warn',
  'scrim',
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

/** Authored OKLCH, for documentation and for the contrast audit. */
export const COLOR_OKLCH: Record<ColorToken, string> = {
  bg: 'oklch(0.17 0.008 240)',
  surface: 'oklch(0.21 0.009 240)',
  'surface-2': 'oklch(0.25 0.010 240)',
  line: 'oklch(0.32 0.012 240)',
  'line-strong': 'oklch(0.40 0.014 240)',
  ink: 'oklch(0.97 0.004 240)',
  'ink-2': 'oklch(0.78 0.008 240)',
  'ink-3': 'oklch(0.64 0.010 240)',
  accent: 'oklch(0.68 0.16 245)',
  'accent-ink': 'oklch(0.16 0.02 245)',
  'accent-dim': 'oklch(0.42 0.09 245)',
  pos: 'oklch(0.74 0.15 155)',
  neg: 'oklch(0.68 0.17 25)',
  warn: 'oklch(0.80 0.14 85)',
  scrim: 'oklch(0.10 0.008 240)',
};

/**
 * The same colors resolved to sRGB. Only for contexts that cannot evaluate `oklch()` or `var()`:
 * `theme-color` meta, OG image generation, `<canvas>`. In the DOM, use `color()`.
 */
export const COLOR_SRGB: Record<ColorToken, `#${string}`> = {
  bg: '#0c1013',
  surface: '#15191c',
  'surface-2': '#1d2226',
  line: '#2d3438',
  'line-strong': '#41494f',
  ink: '#f3f5f7',
  'ink-2': '#b3b8bc',
  'ink-3': '#878d92',
  accent: '#249ff3',
  'accent-ink': '#060e15',
  'accent-dim': '#19517b',
  pos: '#4bc680',
  neg: '#ef6661',
  warn: '#e7b643',
  scrim: '#020405',
};

/** `color('accent')` -> `'var(--accent)'`. */
export function color(token: ColorToken): string {
  return `var(--${token})`;
}

/**
 * A tint of a token, for chart bands and hover washes. Keeps alpha out of component code so the
 * palette stays auditable.
 *
 * @param percent 0-100, how much of the token survives the mix with transparent.
 */
export function colorMix(token: ColorToken, percent: number): string {
  const clamped = Math.min(100, Math.max(0, percent));
  return `color-mix(in oklch, var(--${token}) ${clamped}%, transparent)`;
}

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

export const TEXT_TOKENS = [
  'micro',
  'mini',
  'meta',
  'body',
  'lead',
  'title',
  'section',
  'display',
] as const;

export type TextToken = (typeof TEXT_TOKENS)[number];

/** Font sizes in px, for SVG `font-size` on chart labels. */
export const TEXT_PX: Record<TextToken, number> = {
  micro: 11,
  mini: 12,
  meta: 13,
  body: 14,
  lead: 16,
  title: 20,
  section: 26,
  display: 34,
};

/** The two line-height rhythms: dense numeric rows, and prose. */
export const LEADING = { num: 1.2, prose: 1.45 } as const;

/** Family stacks, for SVG text and canvas where `font-sans` cannot apply. */
export const FONT_STACK = {
  sans: 'var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif',
  mono: 'var(--font-geist-mono), ui-monospace, "SFMono-Regular", monospace',
} as const;

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** 8px base grid; 4px is allowed only inside dense controls. */
export const GRID_PX = 8;
export const CONTENT_MAX_PX = 1280;
export const GUTTER_PX = 24;
/** Table row height, fixed so streaming values never shift the layout. */
export const ROW_HEIGHT_PX = 44;

export const RADIUS_PX = { card: 10, control: 8, pill: 999 } as const;

// ---------------------------------------------------------------------------
// Stacking
// ---------------------------------------------------------------------------

/**
 * The whole stacking order of the app. Portals and libraries that take a numeric z-index read it
 * from here; markup uses the matching `z-modal` / `z-toast` utilities.
 */
export const Z = {
  dropdown: 10,
  sticky: 20,
  modalBackdrop: 30,
  modal: 40,
  toast: 50,
  tooltip: 60,
} as const;

export type ZLayer = keyof typeof Z;

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

export const EASE_OUT_QUART = 'cubic-bezier(0.165, 0.84, 0.44, 1)';

/** The same curve as control points, for animation libraries that take an array. */
export const EASE_OUT_QUART_POINTS = [0.165, 0.84, 0.44, 1] as const;

/** Milliseconds. State changes only; nothing in the app animates longer than `slow`. */
export const DURATION_MS = { fast: 140, base: 170, slow: 200 } as const;

export type DurationStep = keyof typeof DURATION_MS;

/**
 * True when the visitor asked for reduced motion. Returns `false` during SSR and on the first
 * client render, so read it in an effect (or via a hook) rather than during render if the result
 * changes markup.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Duration in ms for a JS-driven animation, already collapsed to 0 under reduced motion. CSS
 * transitions do not need this — `globals.css` neutralises them centrally.
 */
export function duration(step: DurationStep): number {
  return prefersReducedMotion() ? 0 : DURATION_MS[step];
}
