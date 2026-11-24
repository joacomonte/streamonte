import { Fail } from './http-route.ts';

/** IMDb id y episodio de la query (`imdb`, `s`, `e`), validados. */
export function episode(url: URL) {
	const p = url.searchParams;
	const imdb = /^tt\d+$/.test(p.get('imdb') ?? '') ? (p.get('imdb') as string) : null;
	const s = /^\d+$/.test(p.get('s') ?? '') ? p.get('s') : null;
	const e = /^\d+$/.test(p.get('e') ?? '') ? p.get('e') : null;
	return { imdb, s: s && e ? s : null, e: s && e ? e : null };
}

/** `imdb`, `s` y `e` de la query; sin IMDb id válido, 400. */
export function imdbOrFail(url: URL): { imdb: string; s: string | null; e: string | null } {
	const { imdb, s, e } = episode(url);
	if (!imdb) throw new Fail(400, 'Falta el IMDb id.');
	return { imdb, s, e };
}

/** ¿Es un info-hash de torrent (40 hex en minúscula)? */
export const isHash40 = (hash: string): boolean => /^[0-9a-f]{40}$/.test(hash);

/** Valida un info-hash ya en minúscula; si no es válido, 400. */
export function checkHash40(hash: string): string {
	if (!isHash40(hash)) throw new Fail(400, 'Hash inválido.');
	return hash;
}

/** `hash` de la query: info-hash de 40 hex (en minúscula); si no, 400. */
export const hash40 = (url: URL): string => checkHash40(url.searchParams.get('hash')?.toLowerCase() ?? '');

/** `hash` (16 hex) y `size` (dígitos) de la query: lo que identifica el archivo para OpenSubtitles. null si el hash
 * no es válido; `size` es null si falta o no es válido. */
export function osHash(url: URL): { hash: string; size: string | null } | null {
	const hash = url.searchParams.get('hash') ?? '';
	const size = url.searchParams.get('size') ?? '';
	return /^[0-9a-f]{16}$/.test(hash) ? { hash, size: /^\d+$/.test(size) ? size : null } : null;
}
