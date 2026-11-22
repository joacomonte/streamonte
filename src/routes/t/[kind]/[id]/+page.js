import { error } from '@sveltejs/kit';
import * as saved from '#lib/saved.js';

export async function load({ fetch, params }) {
	const { ok, status, data: j } = await saved.json(fetch, `/api/title/${params.kind}/${params.id}`, saved.DAY);
	if (!ok) error(status, /** @type {import('#lib/types.js').ApiError} */ (j).message);
	return { t: /** @type {import('#lib/types.js').Title} */ (j) };
}
