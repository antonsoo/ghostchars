import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Served at https://antonsoo.github.io/ghostchars/
export default defineConfig({
  base: '/ghostchars/',
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
