import { defineConfig } from 'vite';
import { contentSecurityPolicy } from './vite.csp.ts';
import { resolve } from 'node:path';

// Served at https://antonsoo.github.io/ghostchars/
export default defineConfig({
  base: '/ghostchars/',
  plugins: [contentSecurityPolicy()],
  resolve: {
    // ../src/core imports acorn, and a bare import there would be looked up
    // from the repository root. Resolving it from web/ keeps this app
    // buildable with only its own install.
    dedupe: ['acorn'],
  },
  server: {
    fs: {
      // The app imports the core library straight from ../src (no publish
      // step, no duplication) -- allow Vite's dev server to read outside web/.
      allow: [resolve(import.meta.dirname, '..')],
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
