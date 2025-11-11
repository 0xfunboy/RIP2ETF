import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  dts: true,
  target: 'es2022',
  platform: 'node',
  splitting: false,
  treeshake: true,
  sourcemap: false,
  clean: true,
  skipNodeModulesBundle: true,
  minify: false,
  external: [
    '@elizaos/core',
    '@elizaos/api-client',
    '@elizaos/plugin-sql',
    '@elizaos/client',
    '@elizaos/types',
    '@electric-sql/pglite',
    '@electric-sql/pglite/vector',
    '@electric-sql/pglite/contrib/fuzzystrmatch'
  ],
});
