#!/usr/bin/env node
/**
 * Contrast audit for the OKLCH design tokens in src/app/globals.css.
 *
 * Converts every `oklch(L C H)` token to sRGB (clipping out-of-gamut channels the way a display
 * does), then reports WCAG 2.1 contrast ratios for the pairs that carry text or meaning.
 *
 * The palette is LIGHT. That inverts which pair is tightest: on a dark theme the risk is a dim
 * tertiary grey, here it is a *saturated* colour, because a hue legible as a fill on white has to
 * be dark, and a hue dark enough to read as text on white is nearly black by the time it is also
 * usable as a button ground. Every semantic colour in this file is therefore a dark tint, and the
 * light washes (`*-soft`) exist only as backgrounds behind dark text -- never as text themselves.
 *
 * A pair may name an ALPHA VARIANT (`accent/70`), which is composited over its background before
 * the ratio is taken, because that is what a component actually renders. Backgrounds may be a
 * stack (`surface/80 over bg`) for the same reason.
 *
 * Run: node scripts/contrast.mjs
 * Exit code is 1 if any pair marked `min` fails its floor, so this can gate CI.
 */

// --- tokens (keep in sync with :root in src/app/globals.css) ---------------
const TOKENS = {
  // Ground. The page is a faint cool paper; the card is the only pure white in
  // the system, so the one card on the landing screen is the brightest thing on
  // screen without needing a shadow to say so.
  bg: [0.972, 0.004, 215],
  surface: [1.0, 0.0, 215],
  'surface-2': [0.962, 0.006, 215],
  'surface-3': [0.935, 0.008, 215],
  line: [0.905, 0.008, 215],
  'line-strong': [0.82, 0.01, 215],

  // Text. Cool near-black rather than pure black: #000 on white is a glare edge.
  ink: [0.24, 0.014, 215],
  'ink-2': [0.43, 0.014, 215],
  'ink-3': [0.515, 0.012, 215],
  'ink-inverse': [0.99, 0.002, 215],

  // Accent: deep petrol. Dark enough to carry white text as a filled button and
  // to read as link text on white, and far enough off 245 to not be a default blue.
  accent: [0.48, 0.083, 212],
  'accent-ink': [0.99, 0.002, 212],
  'accent-hover': [0.42, 0.072, 212],
  'accent-soft': [0.945, 0.03, 212],
  'accent-dim': [0.76, 0.07, 212],

  // Money. Earned saturation, never decoration. Dark tints, legible on white.
  pos: [0.5, 0.125, 150],
  'pos-soft': [0.945, 0.038, 150],
  neg: [0.52, 0.185, 27],
  'neg-soft': [0.95, 0.024, 27],
  warn: [0.52, 0.105, 70],
  'warn-soft': [0.95, 0.045, 85],

  // Not shipped. Mantine's default primary (blue.6, #228be6), kept only so the
  // REJECTED table below can measure what we declined rather than assert it.
  'mantine-blue-6': [0.63, 0.147, 250],
};

/** Pairs to audit: [foreground, background, floor, note] */
const PAIRS = [
  // Text on each of the three grounds.
  ['ink', 'bg', 4.5, 'primary text on page'],
  ['ink', 'surface', 4.5, 'primary text on the card'],
  ['ink', 'surface-2', 4.5, 'primary text in an input well'],
  ['ink-2', 'bg', 4.5, 'secondary text on page'],
  ['ink-2', 'surface', 4.5, 'secondary text on the card'],
  ['ink-2', 'surface-2', 4.5, 'secondary text in an input well'],
  ['ink-3', 'bg', 4.5, 'tertiary text / axis labels on page'],
  ['ink-3', 'surface', 4.5, 'tertiary text on the card'],
  ['ink-3', 'surface-2', 4.5, 'tertiary text in an input well'],
  ['ink-3', 'surface-3', 4.5, 'tertiary text on a hovered row'],
  ['ink-3', 'accent-soft', 4.5, 'tertiary text on a tinted chip'],

  // The accent, as text and as a fill.
  ['accent', 'bg', 4.5, 'accent as link text on page'],
  ['accent', 'surface', 4.5, 'accent as link text on the card'],
  ['accent', 'accent-soft', 4.5, 'accent text on its own tinted chip'],
  ['accent-ink', 'accent', 4.5, 'label on the primary button'],
  // Mantine's `filled` variant paints its label with `--mantine-color-white`, which
  // theme.ts sets to --surface (pure white), not --accent-ink. Both are audited
  // because both actually render: accent-ink on our own controls, white on Mantine's.
  ['surface', 'accent', 4.5, "white label on the primary button (Mantine's filled variant)"],
  ['surface', 'neg', 4.5, 'white label on a destructive Mantine button'],
  ['accent-ink', 'accent-hover', 4.5, 'label on the primary button, hovered'],

  // Money figures, on every ground they land on.
  ['pos', 'surface', 4.5, 'gain figure on the card'],
  ['pos', 'bg', 4.5, 'gain figure on page'],
  ['pos', 'pos-soft', 4.5, 'gain figure on its own tinted chip'],
  ['neg', 'surface', 4.5, 'loss figure on the card'],
  ['neg', 'bg', 4.5, 'loss figure on page'],
  ['neg', 'neg-soft', 4.5, 'loss figure on its own tinted chip'],
  ['warn', 'surface', 4.5, 'warning figure on the card'],
  ['warn', 'bg', 4.5, 'warning figure on page'],
  ['warn', 'warn-soft', 4.5, 'warning text on its own tinted chip'],
  ['ink-inverse', 'neg', 4.5, 'label on a destructive button'],

  // Non-text: hairlines and chart furniture. WCAG has no floor for these; the
  // 1.2 is a house rule that catches a border going invisible.
  ['line', 'bg', 1.2, 'hairline on page (non-text)'],
  ['line', 'surface', 1.2, 'card border against the card (non-text)'],
  ['line-strong', 'surface', 1.2, 'table header rule (non-text)'],
  ['accent-dim', 'surface', 1.2, 'chart band edge (non-text)'],
  ['bg', 'surface', 1.05, 'page ground against the card it holds (non-text)'],

  // Composited, because this is what the components actually render.
  ['ink-3', 'surface/80 over bg', 4.5, 'table scroll cue over a card'],
  ['ink', 'surface-2/60 over surface', 4.5, 'text over a translucent input well'],
  ['ink-2', 'accent/8 over surface', 4.5, 'secondary text on a selected row'],
];

/**
 * Combinations that were measured and MUST NOT come back. Reported, never gated: they are here so
 * the number that justified removing them is in the repo rather than in a review comment.
 */
const REJECTED = [
  ['mantine-blue-6', 'surface', 4.5, "Mantine's default primary as link text on white"],
  ['mantine-blue-6', 'bg', 4.5, "the same, on the page ground"],
  ['ink-inverse', 'mantine-blue-6', 4.5, "white label on Mantine's default primary button"],
  ['accent-dim', 'surface', 4.5, 'accent-dim is chart furniture, never text'],
  ['accent/70', 'surface', 4.5, 'a dimmed accent; alpha on text always loses the floor'],
];

// --- OKLCH -> sRGB ---------------------------------------------------------

function oklchToLinearSrgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const encode = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const decode = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

const fromChannels = (clipped) => {
  const [r, g, b] = clipped.map(decode);
  return {
    hex: '#' + clipped.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join(''),
    luminance: 0.2126 * r + 0.7152 * g + 0.0722 * b,
    channels: clipped,
  };
};

/**
 * Resolve a pair entry: a token name, `token/alpha`, or `token/alpha over base` (recursively).
 * Compositing is done on the encoded sRGB channels, which is where a browser blends an alpha
 * colour over an opaque backdrop.
 */
function resolveSpec(spec) {
  const [layerSpec, ...rest] = spec.split(' over ');
  const base = rest.length > 0 ? resolveSpec(rest.join(' over ')) : undefined;
  const [name, alphaText] = layerSpec.trim().split('/');
  const layer = resolve(name.trim());
  if (alphaText === undefined) return { ...layer, name: spec };

  const a = Number(alphaText) / 100;
  const under = base ?? resolve('bg');
  const mixed = layer.channels.map((c, i) => c * a + under.channels[i] * (1 - a));
  return { ...fromChannels(mixed), name: spec, css: `${layer.css} at ${alphaText}%`, outOfGamut: layer.outOfGamut };
}

/** Gamut-clip the way a display does: encode, clamp to [0,1], keep that as the shown color. */
function resolve(name) {
  const [L, C, H] = TOKENS[name];
  const lin = oklchToLinearSrgb(L, C, H);
  const clipped = lin.map((c) => clamp01(encode(c)));
  const outOfGamut = lin.some((c) => encode(c) < -0.0005 || encode(c) > 1.0005);
  return { name, ...fromChannels(clipped), outOfGamut, css: `oklch(${L} ${C} ${H})` };
}

const ratio = (a, b) => {
  const [hi, lo] = a.luminance >= b.luminance ? [a, b] : [b, a];
  return (hi.luminance + 0.05) / (lo.luminance + 0.05);
};

// --- report ----------------------------------------------------------------

const resolved = Object.fromEntries(Object.keys(TOKENS).map((n) => [n, resolve(n)]));

console.log('\nTOKEN          OKLCH                        sRGB      relL');
console.log('-'.repeat(64));
for (const t of Object.values(resolved)) {
  console.log(
    `${t.name.padEnd(14)} ${t.css.padEnd(28)} ${t.hex}   ${t.luminance.toFixed(4)}${
      t.outOfGamut ? '  (clipped to sRGB gamut)' : ''
    }`,
  );
}

console.log('\nPAIR                                    RATIO   FLOOR  RESULT  NOTE');
console.log('-'.repeat(104));
let failures = 0;
for (const [fg, bg, floor, note] of PAIRS) {
  const r = ratio(resolveSpec(fg), resolveSpec(bg));
  const ok = r >= floor;
  if (!ok) failures += 1;
  console.log(
    `${`${fg} on ${bg}`.padEnd(39)} ${r.toFixed(2).padStart(5)}   ${floor.toFixed(2).padStart(4)}  ${
      ok ? 'PASS  ' : 'FAIL  '
    }  ${note}`,
  );
}

console.log('\nREJECTED (reported, never gated)');
console.log('-'.repeat(104));
for (const [fg, bg, floor, note] of REJECTED) {
  const r = ratio(resolveSpec(fg), resolveSpec(bg));
  console.log(
    `${`${fg} on ${bg}`.padEnd(39)} ${r.toFixed(2).padStart(5)}   ${floor.toFixed(2).padStart(4)}  ${
      r >= floor ? 'would pass' : 'below floor'
    }  ${note}`,
  );
}

console.log(
  failures === 0
    ? `\nAll ${PAIRS.length} pairs pass.\n`
    : `\n${failures} of ${PAIRS.length} pairs FAIL.\n`,
);
process.exit(failures === 0 ? 0 : 1);
