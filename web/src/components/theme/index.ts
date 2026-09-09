/**
 * The Mantine theme, and the CSS-variable bridge from Mantine's semantic names to the
 * tokens in `src/app/globals.css`.
 */
export { theme, cssVariablesResolver } from './theme';

/* `ThemePreview` is deliberately NOT re-exported. It is the palette swatch board behind
   `/dev/theme`, which only exists when `DEV_ROUTES=1`, and this barrel is imported by
   `app/providers.tsx` — which is to say by the one shipped route. A barrel that re-exports a
   dev-only screen puts it one failed tree-shake away from the production bundle. The dev page
   deep-imports it, which is the right shape for something that is not part of the app. */
