#!/usr/bin/env node
/**
 * Contrast audit for the OKLCH design tokens in src/app/globals.css.
 *
 * Converts every `oklch(L C H)` token to sRGB (clipping out-of-gamut channels the way a display
 * does), then reports WCAG 2.1 contrast ratios for the pairs that carry text or meaning.
 *
 * The palette is DARK. That decides which pair is tightest: the risk here is a dim tertiary grey on
 * a lifted surface, not a saturated hue, because every semantic colour is a light tint that clears
 * 4.5:1 on near-black with room to spare. The `*-soft` values are the inverse — dark grounds that
 * exist only behind those light tints, never as text themselves. `ink-3` on `surface-3` and on
 * `accent-soft` are the two pairs that set the floor for the whole system.
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
  // Ground. Near-black, barely cool. Surfaces lift by luminance alone, never by
  // shadow, so the whole page is four flat planes and a hairline.
  bg: [0.155, 0.006, 240],
  surface: [0.192, 0.007, 240],
  'surface-2': [0.228, 0.008, 240],
  'surface-3': [0.268, 0.009, 240],
  line: [0.3, 0.01, 240],
  'line-strong': [0.4, 0.012, 240],

  // Text. Not pure white: #fff on near-black blooms at small sizes. `ink-3` is
  // 0.66 rather than 0.615 because 0.615 measured 4.08:1 on `surface-3` (a hovered
  // row) and 3.87:1 on `accent-soft` (a chip) -- both under the floor, and both
  // combinations the terminal actually renders.
  ink: [0.965, 0.004, 240],
  'ink-2': [0.755, 0.008, 240],
  'ink-3': [0.66, 0.01, 240],
  'ink-inverse': [0.16, 0.008, 240],

  // Accent: cool cyan at hue 195, off the 245-250 every component library ships.
  // Bright, because on a dark ground an accent has to carry dark text as a fill
  // and read as a figure against near-black, and only the light end does both.
  accent: [0.8, 0.115, 195],
  'accent-ink': [0.16, 0.02, 195],
  'accent-hover': [0.86, 0.115, 195],
  'accent-soft': [0.28, 0.045, 195],
  'accent-dim': [0.42, 0.06, 195],

  // Money. Earned saturation, never decoration. Light tints on near-black.
  pos: [0.78, 0.145, 152],
  'pos-soft': [0.27, 0.05, 152],
  neg: [0.685, 0.175, 22],
  'neg-soft': [0.27, 0.06, 22],
  warn: [0.8, 0.115, 78],
  'warn-soft': [0.28, 0.05, 78],

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
  // Mantine's `filled` variant picks its own label through `autoContrast`, from
  // theme.black (= --bg) and theme.white (= --ink). On the bright primary fill it
  // picks the dark one, so both labels that can land on the accent are audited:
  // --accent-ink on our own controls, --bg on Mantine's.
  ['bg', 'accent', 4.5, "the label autoContrast picks on the primary button"],
  ['ink', 'neg-soft', 4.5, 'primary text on a destructive tint (Alert, light variant)'],
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
 * Combinations that were measured and MUST NOT come back. Reported, never gated, and two of them
 * now clear the floor -- which is the point of printing the number rather than asserting the rule.
 * Mantine's default blue is legible on near-black; it is rejected because it is the blue every
 * component library ships, not because of its ratio.
 */
const REJECTED = [
  ['mantine-blue-6', 'surface', 4.5, "Mantine's default primary as link text on a card"],
  ['mantine-blue-6', 'bg', 4.5, 'the same, on the page ground'],
  ['ink', 'mantine-blue-6', 4.5, "a light label on Mantine's default primary button"],
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
