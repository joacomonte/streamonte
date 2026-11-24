// Fichas de TMDB (IMDb id, idioma, excluidos) guardadas en `.data/` y el Map con tope que usan las cachés en memoria.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Fail } from '../http-route.ts';
import { dataDir } from '../config.ts';
import { tmdb } from './client.ts';
import type { Kind, TmdbTitle } from './client.ts';

// TODO optimizar: en Vercel /tmp es efímero, las fichas se vuelven a pedir tras cada cold start.
const detailsFile = () => `${dataDir()}/tmdb-fichas.json`;
/** Las fichas casi no cambian. */
const DETAILS_TTL = 90 * 24 * 3600 * 1000;
/** Guarda en un Map con tope: al pasarse, borra la entrada más vieja (los Map recorren en orden de inserción).
 */
export function capped<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
	map.delete(key);
	map.set(key, value);
	if (map.size > max) map.delete(map.keys().next().value as K);
}

export type Detail = { imdb: number | null; lang: string | null; excluded: boolean; at: number };
/** "movie:123" → ficha. */
let details: Record<string, Detail> | null = null;

export function detail(raw: Partial<TmdbTitle>): Detail {
	const tt = raw.imdb_id ?? raw.external_ids?.imdb_id ?? '';
	const countries = raw.origin_country ?? raw.production_countries?.map((c) => c.iso_3166_1) ?? [];
	const anim = (raw.genres ?? []).some((g) => g.id === 16);
	return {
		imdb: /^tt\d+$/.test(tt) ? Number(tt.slice(2)) : null,
		// Idioma original, no los hablados.
		lang: raw.original_language ?? null,
		// Como `is_excluded` del desktop: de Japón, o con Japón y animación.
		excluded: countries[0] === 'JP' || (countries.includes('JP') && anim),
		at: Date.now()
	};
}

/** Fichas que faltan, de a 8 pedidos a la vez; quedan en `.data/` (una que falla se reintenta la próxima). */
export async function fillDetails(kind: Kind, ids: number[]): Promise<Record<string, Detail>> {
	details ??= JSON.parse(await readFile(detailsFile(), 'utf8').catch(() => '{}'));
	const all = details ?? {};
	const missing = ids.filter((id) => !(all[`${kind}:${id}`]?.at > Date.now() - DETAILS_TTL));
	if (!missing.length) return all;
	const queue = [...missing];
	const worker = async () => {
		for (let id: number | undefined; (id = queue.shift()) != null; ) {
			try {
				all[`${kind}:${id}`] = detail((await tmdb(`/${kind}/${id}`, kind === 'tv' ? { append_to_response: 'external_ids' } : {})) as TmdbTitle);
			} catch (e) {
				if (e instanceof Fail && e.status === 401) throw e;
			}
		}
	};
	await Promise.all(Array.from({ length: 8 }, worker));
	await mkdir(dataDir(), { recursive: true });
	await writeFile(detailsFile(), JSON.stringify(all));
	return all;
}

