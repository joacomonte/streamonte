import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import * as saved from '#lib/saved.ts';
import type { ApiError, Episodes, Title } from '#lib/types.ts';

/** Paso 3 de una serie: la ficha del capítulo con sus links. */
export const load: PageLoad = async ({ fetch, params }) => {
	if (params.kind !== 'tv' || !/^\d+$/.test(params.s) || !/^\d+$/.test(params.e)) error(404, 'No existe.');
	const [rt, rs] = await Promise.all([saved.json(fetch, `/api/title/tv/${params.id}`, saved.DAY), saved.json(fetch, `/api/season/${params.id}/${params.s}`, saved.DAY)]);
	if (!rt.ok) error(rt.status, (rt.data as ApiError).message);
	const t = rt.data as Title;
	const eps = rs.data as Episodes;
	const s = Number(params.s);
	const e = Number(params.e);
	const ep: { n: number; name: string; date?: string | null; still: string | null } | undefined = rs.ok ? eps.find((x) => x.n === e) : undefined;
	return { t, s, e, ep: ep ?? null };
};
