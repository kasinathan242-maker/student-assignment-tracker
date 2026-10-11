import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    server: 'src/server.ts',
    worker: 'src/worker.ts',
    'scripts/bootstrapPlatformAdmin': 'src/scripts/bootstrapPlatformAdmin.ts',
    'scripts/reconcileStorage': 'src/scripts/reconcileStorage.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  splitting: true,
  // Bundle the workspace package (shipped as TypeScript source); keep npm dependencies external.
  noExternal: ['@sat/shared'],
});
