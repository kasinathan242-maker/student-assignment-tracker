import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['test/globalSetup.ts'],
    setupFiles: ['test/setupEnv.ts'],
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: true,
  },
});
