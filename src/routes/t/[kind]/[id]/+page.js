import { error } from '@sveltejs/kit';

export async function load({ fetch, params }) {
	const r = await fetch(`/api/title/${params.kind}/${params.id}`);
	const j = await r.json();
	if (!r.ok) error(r.status, j.message);
	return { t: j };
}
