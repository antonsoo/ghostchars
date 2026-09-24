// Bundles the CLI into a single dependency-free dist/cli.js. Committed (see
// README "Why dist/ is committed") because `npx github:antonsoo/ghostchars`
// and the GitHub Action both need to run without a build step.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/cli/index.ts'],
  outfile: 'dist/cli.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  legalComments: 'none',
  minify: false,
});

console.log('Built dist/cli.js');
