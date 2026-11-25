import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { viteSingleFile } from 'vite-plugin-singlefile';
// VITE_TARGET=claude builds the Claude-page version: same app, syncing through the Supabase connector instead of supabase-js.
const claude = process.env.VITE_TARGET === 'claude';
export default defineConfig({
  base: './',
  // The Claude page is published as one self-contained index.html (plus bank.json), with fonts inlined.
  plugins: claude ? [viteSingleFile({ removeViteModuleLoader: true })] : [],
  resolve: claude ? { alias: [{ find: /^\.\/sync\.js$/, replacement: fileURLToPath(new URL('./src/sync-claude.js', import.meta.url)) }] } : {},
  build: { outDir: claude ? 'dist-claude' : 'dist', target: 'es2020' },
});
