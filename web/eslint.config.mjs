import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Vendored KTX2 (Basis) transcoder copied from three/examples.
    'public/basis/**',
    // Playwright output (traces and attachments of the last e2e run).
    'test-results/**',
    'playwright-report/**',
  ]),
]);

export default eslintConfig;
