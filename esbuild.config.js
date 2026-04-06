import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/standalone/memex.mjs',
  // Native addons and CJS-only packages must stay external
  external: ['better-sqlite3', 'commander'],
  sourcemap: true,
  minify: false,
});

console.log('Built standalone bundle: dist/standalone/memex.mjs');
console.log('Note: better-sqlite3 and commander must be available at runtime (npm install).');
