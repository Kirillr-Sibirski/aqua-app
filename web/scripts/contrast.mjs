#!/usr/bin/env node
/**
 * Contrast audit for the OKLCH design tokens in src/app/globals.css.
 *
 * Converts every `oklch(L C H)` token to sRGB (clipping out-of-gamut channels the way a display
 * does), then reports WCAG 2.1 contrast ratios for the pairs that carry text or meaning.
 *
 * A pair may name an ALPHA VARIANT (`accent/70`), which is composited over its background before
 * the ratio is taken. That is the gap this file used to have: it audited the raw tokens, while
 * components render `text-accent/70`, and the one measured failure in the app was exactly there --
 * `accent/70` on `surface` is 3.68:1, under the 4.5:1 floor, on the bytes that spell out the two
 * custom opcodes. Backgrounds may be a stack (`bg/80 over surface`) for the same reason.
 *
 * Run: node scripts/contrast.mjs
 * Exit code is 1 if any pair marked `min` fails its floor, so this can gate CI later.
 */

// --- tokens (keep in sync with :root in src/app/globals.css) ---------------
const TOKENS = {
  bg: [0.17, 0.008, 240],
  surface: [0.21, 0.009, 240],
  'surface-2': [0.25, 0.01, 240],
  line: [0.32, 0.012, 240],
  'line-strong': [0.4, 0.014, 240],
  ink: [0.97, 0.004, 240],
  'ink-2': [0.78, 0.008, 240],
  'ink-3': [0.64, 0.01, 240], // DESIGN.md ships 0.62; raised to clear 4.5:1 on surface-2
  accent: [0.68, 0.16, 245],
  'accent-ink': [0.16, 0.02, 245],
  'accent-dim': [0.42, 0.09, 245],
  pos: [0.74, 0.15, 155],
  neg: [0.68, 0.17, 25],
  warn: [0.8, 0.14, 85],
};

/** Pairs to audit: [foreground, background, floor, note] */
const PAIRS = [
  ['ink', 'bg', 4.5, 'primary text on page'],
  ['ink-2', 'bg', 4.5, 'secondary text on page'],
  ['ink-3', 'bg', 4.5, 'tertiary text / axis labels on page'],
  ['ink-3', 'surface', 4.5, 'tertiary text on cards and rows'],
  ['ink-2', 'surface-2', 4.5, 'secondary text in inputs / hover rows'],
  ['ink-3', 'surface-2', 4.5, 'tertiary text in inputs / hover rows'],
  ['accent', 'bg', 4.5, 'accent as link text on page'],
  ['accent', 'surface', 4.5, 'accent as link text on cards'],
  ['accent-ink', 'accent', 4.5, 'label on a primary button'],
  ['pos', 'surface', 4.5, 'gain figure on a card'],
  ['neg', 'surface', 4.5, 'loss figure on a card'],
  ['warn', 'surface', 4.5, 'warning figure on a card'],
  ['pos', 'bg', 4.5, 'gain figure on page'],
  ['neg', 'bg', 4.5, 'loss figure on page'],
  ['warn', 'bg', 4.5, 'warning figure on page'],
  ['line', 'bg', 1.2, 'hairline on page (non-text)'],
  ['line-strong', 'surface', 1.2, 'table header rule (non-text)'],
  ['accent-dim', 'bg', 1.2, 'chart band edge (non-text)'],

  // Composited, because this is what the components actually render.
  ['ink-3', 'bg/80 over surface', 4.5, 'table scroll cue over a card'],
  ['ink-3', 'bg/80 over bg', 4.5, 'table scroll cue over the page'],
  ['ink', 'surface-2/60 over surface', 4.5, 'text over a translucent raised block'],
  ['accent', 'accent/15 over surface', 4.5, 'accent text on its own tinted chip'],
];

/**
 * Combinations that were measured and MUST NOT come back. Reported, never gated: they are here so
 * the number that justified removing them is in the repo rather than in a review comment.
 */
const REJECTED = [
  ['accent/70', 'surface', 4.5, 'dimmed opcode bytes in the raw-bytes disclosure (was 3.68:1)'],
  ['accent/70', 'surface-2', 4.5, 'the same, on a raised block'],
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

console.log('\nPAIR                          RATIO   FLOOR  RESULT  NOTE');
console.log('-'.repeat(96));
let failures = 0;
for (const [fg, bg, floor, note] of PAIRS) {
  const r = ratio(resolveSpec(fg), resolveSpec(bg));
  const ok = r >= floor;
  if (!ok) failures += 1;
  console.log(
    `${`${fg} on ${bg}`.padEnd(29)} ${r.toFixed(2).padStart(5)}   ${floor.toFixed(1).padStart(4)}  ${
      ok ? 'PASS  ' : 'FAIL  '
    }  ${note}`,
  );
}

console.log('\nREJECTED (reported, never gated)');
console.log('-'.repeat(96));
for (const [fg, bg, floor, note] of REJECTED) {
  const r = ratio(resolveSpec(fg), resolveSpec(bg));
  console.log(
    `${`${fg} on ${bg}`.padEnd(29)} ${r.toFixed(2).padStart(5)}   ${floor.toFixed(1).padStart(4)}  ${
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
