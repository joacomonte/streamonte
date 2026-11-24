import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// Código compartido con la web: packages/ui/src (alias `$ui`, también en tsconfig `paths`). Vive fuera de este root: `fs.allow`.
const shared = fileURLToPath(new URL('../packages/ui/src', import.meta.url));

// Puerto fijo: tauri.conf.json (build.devUrl) apunta acá.
export default defineConfig({
  plugins: [svelte({ compilerOptions: { runes: true } })],
  // packages/ui tiene su node_modules (workspace): `dedupe` fuerza una sola copia de svelte, la de ui.
  resolve: { alias: { $ui: shared }, dedupe: ['svelte'] },
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: '127.0.0.1', fs: { allow: ['..'] } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'safari15' }
});
