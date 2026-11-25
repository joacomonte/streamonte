import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// tmdb.ts / keys.ts guardan en `.data` relativo al cwd: se trabaja en un tmp para no tocar los datos reales.
const work = mkdtempSync(join(tmpdir(), 'streamonte-tmdb-'));
const cwd = process.cwd();
process.chdir(work);
process.env.TMDB_KEY = 'x';
delete process.env.VERCEL;
const { capped, detail, title } = await import('./tmdb.ts');

after(() => {
	process.chdir(cwd);
	rmSync(work, { recursive: true, force: true });
});

test('capped: borra la entrada más vieja y re-setear la refresca', () => {
	const m = new Map<string, number>();
	capped(m, 'a', 1, 2);
	capped(m, 'b', 2, 2);
	capped(m, 'a', 3, 2); // a pasa a ser la más nueva
	capped(m, 'c', 4, 2); // se va b
	assert.deepEqual([...m], [['a', 3], ['c', 4]]);
});

test('detail: imdb id, idioma original', () => {
	const now = Date.now();
	const d = detail({ imdb_id: 'tt0133093', original_language: 'en', origin_country: ['US'] });
	assert.equal(d.imdb, 133093);
	assert.equal(d.lang, 'en');
	assert.ok(d.at >= now);
	assert.equal(detail({ imdb_id: 'nope' }).imdb, null);
	assert.equal(detail({}).lang, null);
	assert.equal(detail({ external_ids: { imdb_id: 'tt5' } }).imdb, 5); // series
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** Responde TMDB con `bodies` por ruta (`/movie/1`); IMDb (datasets) falla, como sin red. */
function mockFetch(bodies: Record<string, unknown>) {
	return mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
		const url = new URL(String(input));
		if (url.hostname !== 'api.themoviedb.org') throw new Error('sin red');
		const path = url.pathname.replace(/^\/3/, '');
		if (!(path in bodies)) return new Response('{}', { status: 404 });
		return json(bodies[path]);
	});
}

const person = (id: number, name: string, extra: Record<string, unknown> = {}) => ({ id, name, profile_path: `/p${id}.jpg`, ...extra });
const MOVIE = {
	id: 1,
	title: 'Peli',
	release_date: '2020-05-01',
	poster_path: '/poster.jpg',
	backdrop_path: '/back.jpg',
	overview: 'Sinopsis',
	runtime: 101,
	genres: [{ id: 28, name: 'Acción' }],
	imdb_id: 'tt0000123',
	original_language: 'en',
	status: 'Ended',
	production_companies: [{ name: 'Uno' }, { name: 'Dos' }, { name: 'Tres' }],
	'watch/providers': {
		results: {
			AR: {
				flatrate: [
					{ provider_id: 2, provider_name: 'B', display_priority: 2, logo_path: '/b.png' },
					{ provider_id: 1, provider_name: 'A', display_priority: 1 }
				],
				ads: [{ provider_id: 2, provider_name: 'B', display_priority: 2 }],
				free: [{ provider_id: 3, provider_name: 'C', display_priority: 3 }]
			},
			US: { flatrate: [{ provider_id: 9, provider_name: 'US', display_priority: 0 }] }
		}
	},
	credits: {
		crew: [person(20, 'Productor', { job: 'Producer' }), person(21, 'Director Uno', { job: 'Director' }), person(22, 'Director Dos', { job: 'Director' })],
		cast: [1, 2, 3, 4].map((n) => person(30 + n, `Actor ${n}`, { character: n === 2 ? '' : `Personaje ${n}` }))
	}
};

test('title (película): providers AR, people, companies', async () => {
	mockFetch({ '/movie/1': MOVIE });
	const t = await title('movie', 1);
	// Solo Argentina, sin repetir, por prioridad.
	assert.deepEqual(t.providers, [
		{ name: 'A', logo: null },
		{ name: 'B', logo: 'https://image.tmdb.org/t/p/w92/b.png' },
		{ name: 'C', logo: null }
	]);
	// Director (solo el primero) y el reparto (hasta 18) con personaje (vacío -> null).
	assert.deepEqual(
		t.people.map((p) => [p.role, p.name, p.note]),
		[['director', 'Director Uno', null], ['cast', 'Actor 1', 'Personaje 1'], ['cast', 'Actor 2', null], ['cast', 'Actor 3', 'Personaje 3'], ['cast', 'Actor 4', 'Personaje 4']]
	);
	assert.equal(t.people[0].photo, 'https://image.tmdb.org/t/p/w185/p21.jpg');
	assert.deepEqual(t.companies, ['Uno', 'Dos']);
	assert.equal(t.imdb, 'tt0000123');
	assert.equal(t.year, '2020');
	assert.equal(t.released, '2020-05-01');
	assert.equal(t.poster, 'https://image.tmdb.org/t/p/w342/poster.jpg');
	assert.equal(t.rating, null); // IMDb sin red: sale igual, sin puntaje
	assert.equal(t.status, 'ended');
	assert.equal(t.lang, 'Inglés');
	assert.equal(t.origLang, 'en');
	assert.equal(t.next, null);
	assert.deepEqual(t.seasons, []);
});

test('title (serie): sin director, temporadas, género doble y próximo episodio', async () => {
	mockFetch({
		'/tv/2': {
			id: 2,
			name: 'Serie',
			first_air_date: '2019-02-03',
			overview: 'x',
			genres: [{ id: 10759, name: 'Action & Adventure' }, { id: 18, name: 'Drama' }],
			external_ids: { imdb_id: 'tt0000456' },
			status: 'Returning Series',
			episode_run_time: [45],
			credits: { crew: [person(1, 'Dir', { job: 'Director' })], cast: [person(2, 'Act', { character: 'Pj' })] },
			next_episode_to_air: { air_date: '2030-01-01', season_number: 2, episode_number: 3 },
			seasons: [
				{ season_number: 0, name: 'Especiales', episode_count: 4 },
				{ season_number: 1, name: 'T1', episode_count: 8, air_date: '2019-02-03' },
				{ season_number: 2, name: 'T2', episode_count: 0 },
				{ season_number: 3, name: 'T3', episode_count: 6 }
			]
		}
	});
	const t = await title('tv', '2');
	assert.deepEqual(t.people.map((p) => p.role), ['cast']);
	assert.equal(t.imdb, 'tt0000456');
	assert.equal(t.runtime, 45);
	assert.equal(t.released, null);
	assert.equal(t.status, 'returning');
	assert.deepEqual(t.genres, ['Acción', 'Aventura', 'Drama']);
	assert.deepEqual(t.next, { season: 2, episode: 3, date: '2030-01-01' });
	assert.deepEqual(t.seasons, [
		{ n: 1, name: 'T1', count: 8, year: '2019' },
		{ n: 3, name: 'T3', count: 6, year: null }
	]);
});

test('title: sin créditos ni productoras -> vacíos', async () => {
	mockFetch({ '/movie/1': { ...MOVIE, credits: undefined, production_companies: undefined } });
	const t = await title('movie', 1);
	assert.deepEqual(t.people, []);
	assert.deepEqual(t.companies, []);
});
