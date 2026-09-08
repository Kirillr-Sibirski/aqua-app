/**
 * Vitest needs to be told what `@/` means.
 *
 * `tsconfig.json` maps it for the compiler and Next maps it for the bundler, but vitest reads
 * neither, so until now the only testable modules were the ones that import relatively. App code
 * should not have to choose an import style to stay testable, so the alias is declared once here.
 *
 * Nothing else is configured: the default `include` already finds `__tests__` and `*.test.ts`, and
 * no test in this repo needs a DOM.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
