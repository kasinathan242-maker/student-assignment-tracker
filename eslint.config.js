import { createConfig } from '@sat/eslint-config';

export default createConfig({
  nodeFiles: ['apps/api/**/*.ts', 'packages/**/*.ts', 'scripts/**/*.{ts,mjs}'],
  browserFiles: ['apps/web/src/**/*.{ts,tsx}', 'apps/web/public/**/*.js'],
  ignores: ['apps/web/playwright-report/**', 'apps/web/test-results/**', '.data/**'],
});
