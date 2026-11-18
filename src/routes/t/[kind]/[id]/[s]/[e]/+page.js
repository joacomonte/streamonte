import { error } from '@sveltejs/kit';

/** Paso 3 de una serie: la ficha del capítulo con sus links. */
export async function load({ fetch, params }) {
	if (params.kind !== 'tv' || !/^\d+$/.test(params.s) || !/^\d+$/.test(params.e)) error(404, 'No existe.');
	const [rt, rs] = await Promise.all([fetch(`/api/title/tv/${params.id}`), fetch(`/api/season/${params.id}/${params.s}`)]);
	const [t, eps] = await Promise.all([rt.json(), rs.json()]);
	if (!rt.ok) error(rt.status, t.message);
	const s = Number(params.s);
	const e = Number(params.e);
	/** @type {{n: number, name: string, date: string | null, still: string | null} | undefined} */
	const ep = rs.ok ? eps.find((/** @type {{n: number}} */ x) => x.n === e) : undefined;
	return { t, s, e, ep: ep ?? null };
}
