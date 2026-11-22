// Solo en desarrollo: cuándo cambió por última vez el código (o arrancó el server). Lo usa `+layout.svelte` para
// recargar al volver a la app solo si hubo cambios, en vez de la recarga de Vite cada vez que se corta la conexión.
import { readdir, stat } from 'node:fs/promises';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const started = Date.now();

export const GET: RequestHandler = async () => {
	if (!import.meta.env.DEV) return new Response(null, { status: 404 });
	const files = await readdir('src', { recursive: true, withFileTypes: true });
	const times = await Promise.all(files.filter((f) => f.isFile()).map((f) => stat(`${f.parentPath}/${f.name}`).then((s) => s.mtimeMs, () => 0)));
	return json({ changed: Math.max(started, ...times) });
};
