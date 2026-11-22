import { fileURLToPath } from 'node:url';
import nodeAdapter from '@sveltejs/adapter-node';
import vercelAdapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	// Código compartido con el desktop: packages/ui/src como `$ui` (Vercel sube packages/, ver .vercelignore). `kit.alias` está
	// deprecado en Kit 3; los tipos van por `paths` en tsconfig.json. Queda fuera del root de la web: `fs.allow`.
	resolve: { alias: { $ui: fileURLToPath(new URL('../packages/ui/src', import.meta.url)) } },
	server: { fs: { allow: ['..'] } },
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// En Vercel (VERCEL=1 en su build) usa su adapter; en la Mac sigue el server node.
			adapter: process.env.VERCEL ? vercelAdapter() : nodeAdapter(),
			// Busca versión nueva cada 5 min (y al volver a la app): la instalada en el celu avisa para actualizar.
			version: { pollInterval: 5 * 60 * 1000 }
		})
	]
});
