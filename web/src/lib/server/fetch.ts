/** fetch con tope de tiempo. Con `HTTP_FIXTURES=<carpeta>` (solo local, lo pone scripts/scenes.mjs) responde desde
 * respuestas grabadas y graba las que faltan: los contratos web corren sin red y siempre con los mismos datos
 * (el grabador vive en http-fixture.ts y solo se carga si esa variable está puesta). */
export async function get(url: string | URL, init: RequestInit = {}, ms = 12_000): Promise<Response> {
	const dir = process.env.VERCEL ? undefined : process.env.HTTP_FIXTURES;
	if (dir) return (await import('./http-fixture.ts')).fixtureGet(dir, url, init, ms);
	return fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}
