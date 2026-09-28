import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // SSRF rule (guide「SSRF 规则」): the only outbound fetcher is ingest/safe-fetch.ts.
    files: ['src/lib/ingest/**', 'src/lib/covers/**', 'src/lib/inbox/**'],
    ignores: ['src/lib/ingest/safe-fetch.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [{ name: 'undici', message: 'Use safeFetch from ingest/safe-fetch.' }] }],
      'no-restricted-globals': ['error', { name: 'fetch', message: 'Use safeFetch from ingest/safe-fetch.' }],
    },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'drizzle/**', 'playwright-report/**', 'test-results/**']),
]);

export default eslintConfig;
