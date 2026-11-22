import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// Puerto fijo: tauri.conf.json (build.devUrl) apunta acá.
export default defineConfig({
  plugins: [svelte({ compilerOptions: { runes: true } })],
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  build: { outDir: 'dist', emptyOutDir: true, target: 'safari15' }
});
