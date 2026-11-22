import { error } from '@sveltejs/kit';
import * as saved from '#lib/saved.js';

/** Paso 3 de una serie: la ficha del capítulo con sus links. */
export async function load({ fetch, params }) {
	if (params.kind !== 'tv' || !/^\d+$/.test(params.s) || !/^\d+$/.test(params.e)) error(404, 'No existe.');
	const [rt, rs] = await Promise.all([saved.json(fetch, `/api/title/tv/${params.id}`, saved.DAY), saved.json(fetch, `/api/season/${params.id}/${params.s}`, saved.DAY)]);
	if (!rt.ok) error(rt.status, /** @type {import('#lib/types.js').ApiError} */ (rt.data).message);
	const t = /** @type {import('#lib/types.js').Title} */ (rt.data);
	const eps = /** @type {import('#lib/types.js').Episodes} */ (rs.data);
	const s = Number(params.s);
	const e = Number(params.e);
	/** @type {{n: number, name: string, date?: string | null, still: string | null} | undefined} */
	const ep = rs.ok ? eps.find((x) => x.n === e) : undefined;
	return { t, s, e, ep: ep ?? null };
}
