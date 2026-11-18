// Puntaje y votos reales de IMDb (como el desktop, streamonte/crates/core/src/catalog/top.rs): el dataset
// oficial `title.ratings` (gratis para uso personal, se actualiza a diario), guardado en `.data/`.
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip, gunzipSync } from 'node:zlib';
import { Fail, get } from './http.js';

const URL_RATINGS = 'https://datasets.imdbws.com/title.ratings.tsv.gz';
// TODO optimizar: en Vercel /tmp se borra en cada cold start y se re-bajan ~60 MB de IMDb.
const DIR = process.env.VERCEL ? '/tmp/.data' : '.data';
const FILE = `${DIR}/title.ratings.tsv.gz`;
/** Qué episodios tiene cada serie (~55 MB): para el puntaje por temporada. */
const URL_EPISODES = 'https://datasets.imdbws.com/title.episode.tsv.gz';
const EPISODES_FILE = `${DIR}/title.episode.tsv.gz`;
/** Índice ya armado (serie → temporadas), para no recorrer el dataset en cada arranque. */
const INDEX_FILE = `${DIR}/imdb-temporadas.tsv`;
const DAY = 24 * 3600 * 1000;
/** Menos votos que esto no se guarda (el piso más bajo de la UI es 1.000). */
const KEEP_MIN_VOTES = 10;

/** Número de `tt` → votos × 1000 + puntaje × 10 (un número por título: ~1 M entradas). @type {Map<number, number> | null} */
let table = null;
let loadedAt = 0;
/** @type {Promise<Map<number, number>> | null} */
let loading = null;

/** @param {string} file */
const ageOf = (file) => stat(file).then((s) => Date.now() - s.mtimeMs).catch(() => Infinity);

/** Deja en `file` el .gz de `url` si el guardado tiene más de un día (si falla la bajada, sirve el viejo). @param {string} url @param {string} file @param {string} what */
async function dataset(url, file, what) {
	const age = await ageOf(file);
	if (age < DAY) return file;
	try {
		const r = await get(url, {}, 300_000);
		if (!r.ok) throw new Error(`IMDb respondió ${r.status}`);
		const gz = Buffer.from(await r.arrayBuffer());
		await mkdir(DIR, { recursive: true });
		await writeFile(file, gz);
		return file;
	} catch (e) {
		if (age < Infinity) return file;
		throw new Fail(502, 'No pude bajar {what} de IMDb: {m}', { what, m: /** @type {Error} */ (e).message });
	}
}

/** @param {Buffer} gz */
function parse(gz) {
	const map = new Map();
	const text = gunzipSync(gz).toString('utf8');
	for (const line of text.split('\n')) {
		const [tt, rating, votes] = line.split('\t');
		const n = Number(tt?.slice(2));
		const v = Number(votes);
		if (n && v >= KEEP_MIN_VOTES) map.set(n, v * 1000 + Math.round(Number(rating) * 10));
	}
	return map;
}

/** Tabla de puntajes, leída una vez por día. */
export async function ratings() {
	if (table && Date.now() - loadedAt < DAY) return table;
	loading ??= dataset(URL_RATINGS, FILE, 'los puntajes')
		.then((f) => readFile(f))
		.then(parse)
		.then((m) => {
			table = m;
			loadedAt = Date.now();
			return m;
		})
		.finally(() => (loading = null));
	return table ?? loading;
}

/** Puntaje y votos de un IMDb id (`tt123` o número), si la tabla ya está cargada. @param {string | number | null | undefined} id */
export function imdbOf(id, map = table) {
	const n = typeof id === 'number' ? id : Number(id?.slice(2));
	const packed = n ? map?.get(n) : undefined;
	return packed == null ? null : { rating: (packed % 1000) / 10, votes: Math.floor(packed / 1000) };
}

/** Número de serie → [temporada, puntaje, episodios con puntaje][]. @typedef {Map<number, [number, number, number][]>} Index */
/** @type {Index | null} */
let index = null;
let indexAt = 0;
/** @type {Promise<Index> | null} */
let indexing = null;

/** Recorre `title.episode` (`tconst\tparentTconst\tseason\tepisode`) y promedia, por serie y temporada, los
 * episodios con puntaje (sin especiales ni episodios sin temporada), como `build_index` del desktop. */
async function buildIndex() {
	const [table, file] = await Promise.all([ratings(), dataset(URL_EPISODES, EPISODES_FILE, 'los episodios')]);
	/** "serie:temporada" → [suma, cantidad] @type {Map<string, [number, number]>} */
	const sums = new Map();
	const lines = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
	for await (const line of lines) {
		const [ep, series, season] = line.split('\t');
		const n = Number(season);
		if (!(n > 0)) continue;
		const r = imdbOf(ep, table);
		if (!r) continue;
		const k = `${series.slice(2)}:${n}`;
		const acc = sums.get(k) ?? [0, 0];
		acc[0] += r.rating;
		acc[1] += 1;
		sums.set(k, acc);
	}
	/** @type {Index} */
	const out = new Map();
	for (const [k, [sum, cnt]] of sums) {
		const [series, season] = k.split(':').map(Number);
		const list = out.get(series) ?? [];
		list.push([season, Math.round((sum / cnt) * 10) / 10, cnt]);
		out.set(series, list);
	}
	for (const list of out.values()) list.sort((a, b) => a[0] - b[0]);
	await writeFile(INDEX_FILE, [...out].flatMap(([series, l]) => l.map((x) => [series, ...x].join('\t'))).join('\n'));
	return out;
}

/** El índice guardado, si es de hoy. */
async function savedIndex() {
	if ((await ageOf(INDEX_FILE)) >= DAY) return null;
	/** @type {Index} */
	const out = new Map();
	for (const line of (await readFile(INDEX_FILE, 'utf8')).split('\n')) {
		const [series, season, rating, n] = line.split('\t').map(Number);
		if (!series) continue;
		const list = out.get(series) ?? [];
		list.push([season, rating, n]);
		out.set(series, list);
	}
	return out;
}

/** Puntaje de IMDb por temporada de una serie (la primera vez del día tarda: arma el índice). @param {string} imdb */
export async function seasonScores(imdb) {
	if (!index || Date.now() - indexAt >= DAY) {
		indexing ??= savedIndex()
			.then((saved) => saved ?? buildIndex())
			.then((ix) => {
				index = ix;
				indexAt = Date.now();
				return ix;
			})
			.finally(() => (indexing = null));
		await indexing;
	}
	return (index?.get(Number(imdb.slice(2))) ?? []).map(([season, rating, episodes]) => ({ season, rating, episodes }));
}

// Self-check del empaquetado.
console.assert(imdbOf(1, new Map([[1, 5000 * 1000 + 84]]))?.rating === 8.4 && imdbOf('tt1', new Map([[1, 5000 * 1000 + 84]]))?.votes === 5000);
