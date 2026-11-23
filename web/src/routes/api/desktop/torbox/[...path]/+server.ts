// TorBox para la app de escritorio (2026-11-21, "Usar TorBox de Streamonte"): reenvía a la API de TorBox con la key
// del servidor, que nunca sale de acá. El código de acceso (cookie `code`) ya lo exige hooks.server.js para /api/*.
// Solo lo que usa el desktop (crates/core/src/catalog/torbox.rs): no es un proxy abierto.
import type { RequestHandler } from './$types';
import { get } from '#lib/server/http.ts';
import { keys } from '#lib/server/keys.ts';
import { tracksOf } from '#lib/server/mkv.ts';

const ROOT = 'https://api.torbox.app/v1/api/';
/** Ruta (desde `/v1/api/`) → métodos permitidos. */
const ALLOWED: Record<string, string> = {
	'torrents/checkcached': 'GET',
	'torrents/mylist': 'GET',
	'torrents/requestdl': 'GET',
	'stream/createstream': 'GET',
	'torrents/createtorrent': 'POST',
	// No es de TorBox: pistas del video leídas acá (2026-11-23). El link de `requestdl` trae la key, así que no puede
	// llegar al desktop: el servidor lee el encabezado del MKV y devuelve solo las pistas.
	'streamonte/tracks': 'GET'
};

const plain = (text: string, status: number) => new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

const pass: RequestHandler = async ({ params, url, request }) => {
	const path = params.path;
	if (ALLOWED[path] !== request.method) return plain('No permitido.', 404);
	const key = (await keys()).torbox;
	if (!key) return plain('Falta la key de TorBox en el servidor.', 503);
	if (path === 'streamonte/tracks') return tracks(key, url);
	const target = new URL(ROOT + path);
	for (const [k, v] of url.searchParams) target.searchParams.append(k, v);
	// `requestdl` pide la key también en la URL: la pone el servidor (lo que mande el desktop se pisa).
	if (path === 'torrents/requestdl') target.searchParams.set('token', key);
	const headers: Record<string, string> = { authorization: `Bearer ${key}`, accept: 'application/json' };
	const init: RequestInit = { method: request.method, headers };
	if (request.method === 'POST') {
		// createtorrent es multipart: el cuerpo y su content-type (con el boundary) van tal cual.
		headers['content-type'] = request.headers.get('content-type') ?? '';
		init.body = await request.arrayBuffer();
	}
	const r = await get(target, init, 25_000).catch(() => null);
	if (!r) return plain('TorBox no respondió.', 504);
	const body = await r.text();
	// Nunca reenviar la key (p. ej. si un link firmado la trajera en la URL).
	if (body.includes(key)) return plain('TorBox devolvió algo que no se puede reenviar.', 502);
	// 401 queda para "código incorrecto" (lo da el hook): una key del servidor rechazada es un 502.
	return new Response(body, {
		status: r.status === 401 ? 502 : r.status,
		headers: { 'content-type': r.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' }
	});
};

/** Pistas del archivo (`torrent_id`, `file_id`): `{ data: Track[] }`, o 422 si no es MKV o no se pudo leer. */
async function tracks(key: string, url: URL): Promise<Response> {
	const tid = Number(url.searchParams.get('torrent_id')), fid = Number(url.searchParams.get('file_id'));
	if (!Number.isInteger(tid) || !Number.isInteger(fid)) return plain('Faltan torrent_id y file_id.', 400);
	const target = new URL(ROOT + 'torrents/requestdl');
	for (const [k, v] of Object.entries({ token: key, torrent_id: String(tid), file_id: String(fid), zip_link: 'false' })) target.searchParams.set(k, v);
	const r = await get(target, { headers: { authorization: `Bearer ${key}`, accept: 'application/json' } }, 25_000).catch(() => null);
	const link = r?.ok ? String(((await r.json().catch(() => null)) as { data?: unknown } | null)?.data ?? '') : '';
	if (!link.startsWith('https://')) return plain('TorBox no dio el link.', 502);
	const all = await tracksOf(link);
	if (!all) return plain('No pude leer las pistas de este video.', 422);
	return new Response(JSON.stringify({ data: all }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

export const GET = pass;
export const POST = pass;
