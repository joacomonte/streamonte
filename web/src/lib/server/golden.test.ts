// Vectores compartidos con el núcleo Rust (/packages/golden/*.json): Rust es la fuente de verdad.
// Un caso con "diverge" es una diferencia conocida: acá se salta y se lista en el reporte. Los tests no corren en Vercel.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// tmdb.ts / keys.ts guardan en `.data` relativo al cwd: se trabaja en un tmp.
const work = mkdtempSync(join(tmpdir(), 'streamonte-golden-'));
const cwd = process.cwd();
process.chdir(work);
process.env.TMDB_KEY = 'x';
delete process.env.VERCEL;
const { detail, peopleOf, providersAr, showStatus } = await import('./tmdb.ts');
const { parse, otherFilm, merge } = await import('./torrents.ts');
const { isSpanishSub, spanishVariant: variantLabel } = await import('./torbox.ts');
const { spanishVariant, trackVariant, audioOf } = await import('../../../../packages/ui/src/latino.ts');
const { constraints: interestConstraints, smallPoster } = await import('./interests.ts');
const { results: osResults, seconds: osSeconds } = await import('./subs.ts');
const { parseTracks } = await import('./mkv.ts');
const { normalize: awardsOf } = await import('./awards.ts');
const { normalize: episodeRatingsOf } = await import('./episode-ratings.ts');
after(() => {
	process.chdir(cwd);
	rmSync(work, { recursive: true, force: true });
});

type Case = { in: any; out: unknown; nota?: string; diverge?: string };
const load = (name: string): Case[] => JSON.parse(readFileSync(join(import.meta.dirname, '../../../../packages/golden', `${name}.json`), 'utf8'));
const diverged: string[] = [];

function golden(name: string, run: (input: any) => unknown) {
	for (const [i, c] of load(name).entries()) {
		const label = `${name} #${i + 1} ${JSON.stringify(c.in).slice(0, 70)}`;
		if (c.diverge) {
			diverged.push(`${label} → ${c.diverge}`);
			test(label, { skip: c.diverge }, () => {});
		} else test(label, () => assert.deepEqual(run(c.in), c.out));
	}
}

golden('providers_ar', (wp) => providersAr(wp ?? undefined));
golden('people', ({ kind, credits, createdBy }) => peopleOf(kind === 'movie' ? 'movie' : 'tv', credits, createdBy));
golden('show_status', (r) => {
	const { status, next } = showStatus(r);
	return { state: status, next };
});
golden('excluded', ({ countries, animation }) => detail({ origin_country: countries, genres: animation ? [{ id: 16, name: 'Animation' }] : [] }).excluded);
golden('sub_lang', (path) => isSpanishSub(path));
golden('awards', (data) => awardsOf(data));
golden('episode_ratings', ({ data, season }) => episodeRatingsOf(data, season));
golden('release', (name) => {
	const t = parse({ infoHash: 'a'.repeat(40), title: name }, 'golden')!;
	return { res: t.res, hdr: t.hdr, codec: t.codec, source: t.source, atmos: t.atmos, hint: t.hint === 'likely' ? 'likely' : t.hint, multi: t.multi, spa: t.spa, cam: t.cam, size: t.size, release: t.release, seeds: t.seeds };
});

// La regla de "latino" es una sola (`latino.ts`): el golden la prueba directa y por cada camino que la usa.
const KIND = { latino: 'lat', spain: 'spain', unknown: 'es' } as const;
const LABEL = { latino: 'Latinoamérica', spain: 'España', unknown: 'Español' } as const;
golden('spanish_variant', (text) => ({ lat: 'latino', spain: 'spain', unknown: 'unknown' })[spanishVariant(text)]);
golden('spanish_variant', (text) => ({ lat: 'latino', spain: 'spain', unknown: 'unknown' })[trackVariant('', text)]);
// Como pista de audio ("spa" + título): latino → lat, España → spain, sin variante → es.
for (const [i, c] of load('spanish_variant').entries()) {
	const label = `spanish_variant audioOf #${i + 1} ${JSON.stringify(c.in).slice(0, 70)}`;
	const out = c.out as keyof typeof KIND;
	test(label, () => assert.equal(audioOf([{ language: 'spa', title: c.in }]), KIND[out]));
	test(`${label} (etiqueta de TorBox)`, () => assert.equal(variantLabel(c.in, ''), LABEL[out]));
}

golden('other_film', ({ release, titles, year }) => otherFilm(release, { titles, year }));
golden('merge', ({ items, want }) => {
	const hashOf = (h: number) => h.toString(16).padStart(2, '0').repeat(20);
	const lists = items.map((i: any) => [
		{ hash: hashOf(i.h), release: i.release, file: i.file ?? null, res: null, hdr: [], source: null, cam: !!i.cam, codec: null, atmos: false, hint: null, multi: false, spa: false, size: i.size ?? null, seeds: i.seeds ?? 0, addons: [i.addon] }
	]);
	return [...merge(lists, want).values()]
		.map((t) => ({ h: parseInt(t.hash.slice(0, 2), 16), seeds: t.seeds, size: t.size, file: t.file, addons: t.addons }))
		.sort((a, b) => a.h - b.h);
});

golden('mkv', (hex: string) => parseTracks(Buffer.from(hex, 'hex')));

// Sin espacios ni comas: GraphQL los ignora y cada lado arma la consulta con su formato.
golden('interests', ({ kind, from, to, votes, langs, interests }) =>
	interestConstraints({ kind, sort: 'popular', from, to, votes, lang: langs.join(','), interests }).replace(/[\s,]+/g, '')
);
golden('small_poster', (url) => smallPoster(url));

golden('opensubs_org', (i) => (i.results !== undefined ? osResults(i.results) : osSeconds(i.seconds)));

after(() => {
	if (diverged.length) console.log(`\nDivergencias web ↔ Rust (${diverged.length}):\n${diverged.map((d) => `  - ${d}`).join('\n')}`);
});
