/**
 * The Mantine theme.
 *
 * Mantine is the component vocabulary; `src/app/globals.css` is the palette. This file is the
 * bridge, and it goes one way only: every colour here is read from `lib/ui/tokens`, so there is
 * one set of numbers in the repo and `scripts/contrast.mjs` measures it.
 *
 * Two mechanisms, used for different things:
 *
 *   theme.colors / radius / fontSizes ...  the *scales* Mantine hands to component props
 *                                          (`color="pos"`, `radius="lg"`, `size="sm"`).
 *   cssVariablesResolver                   the *semantic* variables Mantine's own CSS reads
 *                                          (`--mantine-color-text`, `--mantine-color-body`).
 *                                          Without this, Mantine paints its default greys and
 *                                          the app is two palettes wearing one coat.
 *
 * There is no dark branch. `forceColorScheme="light"` is set on the provider and on the
 * ColorSchemeScript, so the `dark` half of every resolver entry is unreachable; it is filled in
 * with the light value rather than left blank, because Mantine's types require the key and a
 * wrong-but-present value would be a trap for whoever removes the force later.
 */
import { createTheme, type CSSVariablesResolver, type MantineColorsTuple } from '@mantine/core';
import { COLOR_SRGB, FONT_STACK, PRIMARY_SHADE, RAMPS, TEXT_PX } from '@/lib/ui/tokens';

/** px -> rem against a 16px root, so the type scale survives a browser font-size change. */
const rem = (px: number) => `${px / 16}rem`;

const tuple = (ramp: readonly string[]) => ramp as unknown as MantineColorsTuple;

export const theme = createTheme({
  // --- colour ------------------------------------------------------------
  primaryColor: 'petrol',
  // 8, not Mantine's default 6. A fill that must also carry white text at 4.5:1
  // has to be dark; petrol.6 measures 3.1:1 under white and petrol.8 measures 5.81:1.
  primaryShade: { light: PRIMARY_SHADE, dark: PRIMARY_SHADE },
  autoContrast: false,
  white: COLOR_SRGB.surface,
  black: COLOR_SRGB.ink,
  colors: {
    petrol: tuple(RAMPS.petrol),
    moss: tuple(RAMPS.moss),
    ember: tuple(RAMPS.ember),
    amber: tuple(RAMPS.amber),
    // Overrides Mantine's own `gray`, which is a warm blue-grey. Every neutral in
    // the app leans 215 instead, so borders and dimmed text match the tokens.
    gray: tuple(RAMPS.slate),
    slate: tuple(RAMPS.slate),
  },

  // --- type --------------------------------------------------------------
  fontFamily: FONT_STACK.sans,
  fontFamilyMonospace: FONT_STACK.mono,
  fontSizes: {
    xs: rem(TEXT_PX.mini), // 12
    sm: rem(TEXT_PX.body), // 14  <- Mantine's component default size
    md: rem(TEXT_PX.lead), // 16
    lg: rem(TEXT_PX.title), // 20
    xl: rem(TEXT_PX.section), // 26
  },
  lineHeights: {
    xs: '1.2',
    sm: '1.35',
    md: '1.45',
    lg: '1.45',
    xl: '1.4',
  },
  fontWeights: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '600',
  },
  headings: {
    fontFamily: FONT_STACK.sans,
    fontWeight: '600',
    textWrap: 'balance',
    sizes: {
      h1: { fontSize: rem(TEXT_PX.display), lineHeight: '1.18' },
      h2: { fontSize: rem(TEXT_PX.section), lineHeight: '1.23' },
      h3: { fontSize: rem(TEXT_PX.title), lineHeight: '1.4' },
      h4: { fontSize: rem(TEXT_PX.lead), lineHeight: '1.5' },
      h5: { fontSize: rem(TEXT_PX.body), lineHeight: '1.45' },
      h6: { fontSize: rem(TEXT_PX.meta), lineHeight: '1.45' },
    },
  },

  // --- shape -------------------------------------------------------------
  // Four radii and only four, matching the CSS tokens: control 8, field 12, card 16.
  radius: { xs: '4px', sm: '6px', md: '8px', lg: '12px', xl: '16px' },
  defaultRadius: 'md',
  spacing: { xs: '0.5rem', sm: '0.75rem', md: '1rem', lg: '1.5rem', xl: '2rem' },
  shadows: {
    xs: '0 1px 2px -1px oklch(0.24 0.014 215 / 0.08)',
    sm: 'var(--shadow-card)',
    md: 'var(--shadow-card)',
    lg: 'var(--shadow-overlay)',
    xl: 'var(--shadow-overlay)',
  },

  // --- behaviour ---------------------------------------------------------
  focusRing: 'auto',
  cursorType: 'pointer',
  // globals.css already collapses every duration under `prefers-reduced-motion`;
  // this makes Mantine's own transitions honour it too.
  respectReducedMotion: true,

  components: {
    Button: { defaultProps: { radius: 'lg' } },
    TextInput: { defaultProps: { radius: 'lg' } },
    NumberInput: { defaultProps: { radius: 'lg' } },
    Select: { defaultProps: { radius: 'lg' } },
    Paper: { defaultProps: { radius: 'xl' } },
    Card: { defaultProps: { radius: 'xl' } },
    Modal: { defaultProps: { radius: 'xl', centered: true } },
    Tooltip: { defaultProps: { radius: 'sm', withArrow: true } },
  },
});

/**
 * Mantine's semantic variables, repointed at our tokens.
 *
 * `variables` is scheme-independent; `light` and `dark` are emitted under the color-scheme
 * selectors. We are light-only, so the two are identical by construction.
 */
const semantic = {
  '--mantine-color-body': 'var(--surface)',
  '--mantine-color-text': 'var(--ink)',
  '--mantine-color-dimmed': 'var(--ink-3)',
  '--mantine-color-bright': 'var(--ink)',
  '--mantine-color-error': 'var(--neg)',
  // Placeholder text is text. Mantine's default is gray.5, which measures 3.06:1
  // on white; ink-3 measures 5.60:1 and is the same grey the rest of the app dims to.
  '--mantine-color-placeholder': 'var(--ink-3)',
  '--mantine-color-anchor': 'var(--accent)',
  '--mantine-color-default': 'var(--surface)',
  '--mantine-color-default-hover': 'var(--surface-2)',
  '--mantine-color-default-color': 'var(--ink)',
  '--mantine-color-default-border': 'var(--line)',
  '--mantine-color-disabled': 'var(--surface-2)',
  '--mantine-color-disabled-color': 'var(--ink-3)',
  '--mantine-color-disabled-border': 'var(--line)',
} as const;

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {
    '--mantine-primary-color-filled': 'var(--accent)',
    '--mantine-primary-color-filled-hover': 'var(--accent-hover)',
    '--mantine-primary-color-light': 'var(--accent-soft)',
    '--mantine-primary-color-contrast': 'var(--accent-ink)',
  },
  light: { ...semantic },
  dark: { ...semantic },
});
