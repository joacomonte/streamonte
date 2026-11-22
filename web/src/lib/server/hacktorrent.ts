// Hacktorrent y su espejo Pelispanda: API JSON abierta (tema WordPress "wpreact") con películas en latino/castellano.
// Portado de crates/core/src/catalog/wpreact.rs. Solo películas: la API no trae descargas de series.
import { magnetHash } from '../../../../packages/ui/src/magnet-hash.ts';
import { get } from './http.ts';
import { parse, type Torrent } from './torrents.ts';

/** Sitio principal y espejo, en ese orden. */
const BASES = ['https://hacktorrent.cc', 'https://pelispanda.org'];
/** Páginas de búsqueda (10 resultados c/u) que se recorren buscando la película. */
const MAX_PAGES = 3;
const MAX_DOWNLOADS = 50;
const NAME = 'Hacktorrent';

export type Hit = { slug?: string; title?: string; year?: string | number; tmdb_id?: string | number; type?: string };
export type Download = { quality?: string; size?: string; download_link?: string; language?: string };
export type Wanted = { titles: string[]; tmdb: number | null; year: number | null };

/** La película buscada: por TMDB id; sin él, mismo año y un título dentro del otro. */
export function isMatch(h: Hit, want: Wanted): boolean {
	if (h.type !== 'pelicula' || !h.slug) return false;
	if (want.tmdb) return String(h.tmdb_id ?? '').trim() === String(want.tmdb);
	const [a, b] = [(h.title ?? '').toLowerCase(), want.titles[0].toLowerCase()];
	return String(h.year ?? '').trim() === String(want.year) && (a.includes(b) || b.includes(a));
}

/** Cada descarga → torrent, con el mismo parser que los addons (nombre del magnet + calidad + idioma + tamaño). */
export function fromDownloads(list: Download[]): Torrent[] {
	return list.slice(0, MAX_DOWNLOADS).flatMap((d) => {
		const link = d.download_link?.trim() ?? '';
		const hash = magnetHash(link);
		if (!hash) return [];
		const quality = d.quality ?? '';
		const release = new URL(link).searchParams.get('dn') || quality;
		const size = d.size ? `\n💾 ${d.size}` : '';
		const t = parse({ infoHash: hash, title: `${release}\n${quality} ${d.language ?? ''}${size}` }, NAME);
		return t ? [t] : [];
	});
}

const json = async <T>(url: string, ms: number): Promise<T> => {
	const r = await get(url, { headers: { 'user-agent': 'Mozilla/5.0' } }, ms);
	if (!r.ok) throw new Error(`${r.status}`);
	return (await r.json()) as T;
};

async function fromSite(base: string, want: Wanted, ms: number): Promise<Torrent[]> {
	for (const title of want.titles) {
		for (let page = 1; page <= MAX_PAGES; page++) {
			const q = new URLSearchParams({ query: title, page: String(page) });
			const res = await json<{ results?: Hit[]; pages?: number }>(`${base}/wp-json/wpreact/v1/search?${q}`, ms);
			const hit = res.results?.find((h) => isMatch(h, want));
			if (hit) return fromDownloads((await json<{ downloads?: Download[] }>(`${base}/wp-json/wpreact/v1/movie/${hit.slug}`, ms)).downloads ?? []);
			if (page >= (res.pages ?? 0)) break;
		}
	}
	return [];
}

/** Torrents de la película: Hacktorrent y, si falla, Pelispanda. La búsqueda solo entiende títulos en español:
 * `want.titles` va con el español primero. */
export async function hacktorrent(want: Wanted): Promise<Torrent[]> {
	try {
		return await fromSite(BASES[0], want, 8_000);
	} catch {
		return fromSite(BASES[1], want, 6_000);
	}
}
