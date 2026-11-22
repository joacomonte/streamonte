// "Pegar magnet" (2026-11-18): un torrent que el usuario trae de afuera (1337x, un foro…). TorBox dice si lo tiene en
// caché; si no, lo baja en sus servidores y acá se lee el avance. Sus videos salen como opciones normales (el link y
// los subs usan el mismo camino que el resto), y del nombre se identifica la película o serie en TMDB.
import { Fail } from './http.ts';
import { checkFiles, mine, addMagnet } from './torbox.ts';
import { fileTorrent } from './torrents.ts';
import type { Torrent } from './torrents.ts';
import { search, title } from './tmdb.ts';

const VIDEO = /\.(mkv|mp4|avi|m4v|mov|webm)$/i;
/** Lo que ya no es parte del título en un nombre de release: año, SxE, resolución, fuente, códec… */
const CUT = /\b(19\d\d|20\d\d|s\d{1,2}e\d{1,3}|s\d{1,2}|\d{1,2}x\d{2}|2160p|1080p|720p|480p|4k|uhd|web-?dl|web-?rip|webrip|bluray|blu-ray|bdrip|brrip|remux|hdtv|dvdrip|x26[45]|h\.?26[45]|hevc|hdr|dv|proper|repack|complete|temporada|season)\b/i;

/** Título, año y capítulo del nombre de un release (`The.Bear.S03E02.1080p…` → The Bear, null, 3, 2).
 */
export function parseName(name: string) {
	const base = name.replace(/\.(mkv|mp4|avi|m4v|mov|webm)$/i, '').replace(/[[(][^\])]*[\])]/g, ' ');
	const flat = base.replace(/[._]+/g, ' ');
	const cut = flat.search(CUT);
	const q = (cut > 0 ? flat.slice(0, cut) : flat).replace(/[-–]+\s*$/, '').replace(/\s+/g, ' ').trim();
	// El año suele venir entre paréntesis (`Oppenheimer (2023) [1080p]`): se busca en el nombre entero.
	const year = name.match(/\b(19\d\d|20\d\d)\b/)?.[1] ?? null;
	const ep = flat.match(/\bs(\d{1,2})e(\d{1,3})\b/i) ?? flat.match(/\b(\d{1,2})x(\d{2})\b/);
	const season = flat.match(/\bs(\d{1,2})\b/i);
	return { q, year, s: ep ? String(Number(ep[1])) : season ? String(Number(season[1])) : null, e: ep ? String(Number(ep[2])) : null };
}

/** La película o serie del nombre, o null: busca en TMDB por título y, si el nombre trae año, prefiere esa. Con
 * capítulo (o temporada), solo series. */
export async function identify(name: string) {
	const p = parseName(name);
	if (p.q.length < 2) return null;
	const { items } = await search(p.q, 1).catch(() => ({ items: [] }));
	const fit = items.filter((x) => (p.s ? x.kind === 'tv' : true));
	const best = (p.year && fit.find((x) => String(x.year) === p.year)) || fit[0];
	if (!best) return null;
	const t = await title(best.kind, best.id).catch(() => null);
	if (!t?.imdb) return null;
	return { kind: best.kind, id: best.id, imdb: t.imdb, title: t.title, year: t.year, poster: t.poster, rating: t.rating ?? null, runtime: t.runtime, origLang: t.origLang, s: p.s, e: p.e };
}

/** Estado del torrent en TorBox: `cached` (en su caché: se agrega al copiar), `downloading` (lo está bajando, con
 * avance), `ready` (ya bajado en tu cuenta) o `missing` (no lo tiene). `files`: sus videos como opciones.
 */
export async function status(hash: string): Promise<{ state: 'cached' | 'downloading' | 'ready' | 'missing'; name: string | null; progress?: number; speed?: number; seeds?: number; eta?: number; files: Torrent[] }> {
	if (!/^[0-9a-f]{40}$/.test(hash)) throw new Fail(400, 'Hash inválido.');
	const options = (files: { name: string; size: number }[]) =>
		files.filter((f) => VIDEO.test(f.name)).map((f) => fileTorrent(hash, f.name, f.size || null)).sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
	const own = await mine(hash);
	if (own) {
		const ready = own.finished || own.progress >= 1;
		return { state: ready ? 'ready' : 'downloading', name: own.name, progress: own.progress, speed: own.speed, seeds: own.seeds, eta: own.eta, files: ready ? options(own.files) : [] };
	}
	const hit = await checkFiles(hash);
	return hit ? { state: 'cached', name: hit.name, files: options(hit.files) } : { state: 'missing', name: null, files: [] };
}

/** "Bajarlo en TorBox": lo agrega a la cuenta aunque no esté en caché (lo baja en sus servidores).
 */
export async function download(hash: string, dn: string) {
	if (!/^[0-9a-f]{40}$/.test(hash)) throw new Fail(400, 'Hash inválido.');
	await addMagnet(`magnet:?xt=urn:btih:${hash}${dn ? `&dn=${encodeURIComponent(dn)}` : ''}`);
	return status(hash);
}
