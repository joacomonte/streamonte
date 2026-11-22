import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import * as saved from '#lib/saved.ts';
import type { ApiError, Title } from '#lib/types.ts';

export const load: PageLoad = async ({ fetch, params }) => {
	const { ok, status, data: j } = await saved.json(fetch, `/api/title/${params.kind}/${params.id}`, saved.DAY);
	if (!ok) error(status, (j as ApiError).message);
	return { t: j as Title };
};
