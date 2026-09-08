import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  /*
   * The float guard, made mechanical.
   *
   * `components/sell/moneyness.ts` is the one file allowed to touch a shipped number in floating
   * point, because what it produces is a *choice* — which of a continuum of legitimate offers puts
   * the typed amount on the curve — rather than a price. Its own header says nothing else in the
   * app may import its `Phi`, and until now that was a comment: the sell barrel re-exported `phi`,
   * `d1d2` and `riskyFraction`, so any future screen could have reached a float normal CDF with an
   * ordinary import and started reimplementing the option maths the router is supposed to own.
   *
   * The barrel no longer exports them, and this rule stops the direct path too. `sell/**` and the
   * test may import it; nothing else may.
   */
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/sell/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/sell/moneyness", "**/components/sell/moneyness"],
              message:
                "moneyness.ts is the only floating-point option maths in the app and is private to components/sell. Every curve value and every preview number comes from an on-chain read (stableFor, bandFor, coverage); there is no TypeScript reimplementation and there must not be one.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
