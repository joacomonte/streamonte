import { error } from '@sveltejs/kit';
import * as saved from '#lib/saved.js';

export async function load({ fetch, params }) {
	const { ok, status, data: j } = await saved.json(fetch, `/api/title/${params.kind}/${params.id}`, saved.DAY);
	if (!ok) error(status, j.message);
	return { t: j };
}
