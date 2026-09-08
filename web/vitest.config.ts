/**
 * Vitest needs to be told what `@/` means.
 *
 * `tsconfig.json` maps it for the compiler and Next maps it for the bundler, but vitest reads
 * neither, so until now the only testable modules were the ones that import relatively. App code
 * should not have to choose an import style to stay testable, so the alias is declared once here.
 *
 * The other setting is `fileParallelism: false`. Three suites talk to the same anvil fork and two of
 * them sign as the manifest's `maker` account; run in parallel workers they interleave transactions
 * from one nonce and `npm test` fails with `nonce too low`. There is one chain, so there is one
 * worker. The offline suites are fast enough that serialising them costs nothing measurable.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    fileParallelism: false,
  },
});
