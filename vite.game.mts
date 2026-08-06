import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/* The renderer, compiled to one script for the game page to swallow.
 *
 * Not a page and not a module — an IIFE, minified, with no imports and no exports, because
 * build.js pastes the text of it straight into template.html alongside the simulation. That is
 * the only shape that survives being a single file served from anywhere. */
export default defineConfig({
  build: {
    outDir: 'dist/game',
    emptyOutDir: true,
    target: 'es2018',
    lib: {
      entry: resolve(import.meta.dirname, 'src/game/entry.ts'),
      name: 'SortieGLBundle',
      formats: ['iife'],
      fileName: () => 'sortiegl.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
