import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { viteSingleFile } from 'vite-plugin-singlefile';

/* One self-contained page out the other end. The artifact CSP blocks every external host and
   GitHub Pages serves a single file today, so inlining is not an optimisation here — it is the
   delivery format. */
export default defineConfig({
  root: 'src',
  plugins: [viteSingleFile()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4000,
    rollupOptions: { input: resolve(import.meta.dirname, 'src/theatre.html') },
  },
});
