import { defineConfig } from 'vite';
import { contentSecurityPolicy } from './vite.csp.ts';
import { resolve } from 'node:path';

// Served at https://antonsoo.github.io/ghostchars/
export default defineConfig({
  base: '/ghostchars/',
  plugins: [contentSecurityPolicy()],
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
