// "Vistos recientemente" (2026-11-23): lo que cada apodo copió (web) o reprodujo (desktop), en la tabla `vistos` de Neon
// (esquema en db/schema.sql; la tabla se crea sola la primera vez). Una fila por título y apodo: una serie guarda el último
// capítulo. `estado`: 'viendo' (sale en la fila) o 'visto' (lo terminó o lo sacó con la X: ya no sale). Sin
// DATABASE_URL o sin apodo: lista vacía y no guarda nada.
import { Fail } from './http.ts';
import { sql } from './track.ts';

export type Kind = 'movie' | 'tv';
/** Lo que se guarda de un título visto. `imdb` es el id común (desktop y web); `tmdb`, el de la ruta de la web. */
export type Seen = {
	kind: Kind;
	imdb: string;
	tmdb: number | null;
	title: string;
	poster: string | null;
	backdrop: string | null;
	season: number | null;
	episode: number | null;
	/** ISO: cuándo lo vio (lo usa "Deshacer" para devolverlo a su lugar). */
	at: string;
};

/** Hasta cuántos muestra la fila. */
const ROW = 10;
const TT = /^tt\d{5,10}$/;

let ready: Promise<unknown> | null = null;
function db() {
	const q = sql();
	if (!q) return null;
	ready ??= q`CREATE TABLE IF NOT EXISTS vistos (
		apodo text NOT NULL, kind text NOT NULL, imdb text NOT NULL, tmdb integer, titulo text NOT NULL, poster text, fondo text,
		temporada integer, episodio integer, estado text NOT NULL DEFAULT 'viendo', fecha timestamptz NOT NULL DEFAULT now(),
		PRIMARY KEY (apodo, kind, imdb))`.catch((e) => ((ready = null), Promise.reject(e)));
	return { q, ready };
}

type Row = { kind: Kind; imdb: string; tmdb: number | null; titulo: string; poster: string | null; fondo: string | null; temporada: number | null; episodio: number | null; fecha: string | Date };
const toSeen = (r: Row): Seen => ({
	kind: r.kind, imdb: r.imdb, tmdb: r.tmdb, title: r.titulo, poster: r.poster, backdrop: r.fondo,
	season: r.temporada, episode: r.episodio, at: new Date(r.fecha).toISOString()
});

export async function list(apodo: string | null): Promise<Seen[]> {
	const d = db();
	if (!d || !apodo) return [];
	await d.ready;
	const rows = (await d.q`SELECT kind, imdb, tmdb, titulo, poster, fondo, temporada, episodio, fecha FROM vistos
		WHERE apodo = ${apodo} AND estado = 'viendo' ORDER BY fecha DESC LIMIT ${ROW}`) as Row[];
	return rows.map(toSeen);
}

/** Lo que llega del cliente (borde externo): se valida cada campo. */
export function parseSeen(v: unknown): Seen {
	const o = (typeof v === 'object' && v ? v : {}) as Record<string, unknown>;
	const str = (x: unknown, max: number) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : null);
	const int = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x > 0 && x < 1e9 ? x : null);
	const url = (x: unknown) => { const s = str(x, 500); return s && /^https:\/\//.test(s) ? s : null; };
	const kind = o.kind === 'tv' ? 'tv' : o.kind === 'movie' ? 'movie' : null;
	const imdb = str(o.imdb, 12);
	const title = str(o.title, 200);
	if (!kind || !imdb || !TT.test(imdb) || !title) throw new Fail(400, 'Título inválido.');
	const at = str(o.at, 40);
	return {
		kind, imdb, title, tmdb: int(o.tmdb), poster: url(o.poster), backdrop: url(o.backdrop),
		season: kind === 'tv' ? int(o.season) : null, episode: kind === 'tv' ? int(o.episode) : null,
		at: at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : new Date().toISOString()
	};
}

/** Lo vio ahora (copió o reprodujo): vuelve a la fila, arriba de todo, con este capítulo. `restore`: "Deshacer" de la X,
 * con su fecha original (vuelve a su lugar). */
export async function mark(apodo: string | null, s: Seen, restore = false): Promise<void> {
	const d = db();
	if (!d || !apodo) return;
	await d.ready;
	const at = restore ? s.at : new Date().toISOString();
	await d.q`INSERT INTO vistos (apodo, kind, imdb, tmdb, titulo, poster, fondo, temporada, episodio, estado, fecha)
		VALUES (${apodo}, ${s.kind}, ${s.imdb}, ${s.tmdb}, ${s.title}, ${s.poster}, ${s.backdrop}, ${s.season}, ${s.episode}, 'viendo', ${at})
		ON CONFLICT (apodo, kind, imdb) DO UPDATE SET
			tmdb = COALESCE(EXCLUDED.tmdb, vistos.tmdb), titulo = EXCLUDED.titulo, poster = COALESCE(EXCLUDED.poster, vistos.poster),
			fondo = COALESCE(EXCLUDED.fondo, vistos.fondo), temporada = EXCLUDED.temporada, episodio = EXCLUDED.episodio,
			estado = 'viendo', fecha = EXCLUDED.fecha`;
}

/** La X: 'visto' lo deja como terminado (sale de la fila); 'olvidar' lo borra (no lo vio). */
export async function dismiss(apodo: string | null, kind: Kind, imdb: string, how: 'visto' | 'olvidar'): Promise<void> {
	const d = db();
	if (!d || !apodo || !TT.test(imdb)) return;
	await d.ready;
	if (how === 'olvidar') await d.q`DELETE FROM vistos WHERE apodo = ${apodo} AND kind = ${kind} AND imdb = ${imdb}`;
	else await d.q`UPDATE vistos SET estado = 'visto' WHERE apodo = ${apodo} AND kind = ${kind} AND imdb = ${imdb}`;
}

/** Guarda el id de TMDB que se resolvió de un item marcado desde el desktop (así no se vuelve a buscar). */
export async function setTmdb(apodo: string | null, kind: Kind, imdb: string, tmdb: number): Promise<void> {
	const d = db();
	if (!d || !apodo) return;
	await d.ready;
	await d.q`UPDATE vistos SET tmdb = ${tmdb} WHERE apodo = ${apodo} AND kind = ${kind} AND imdb = ${imdb} AND tmdb IS NULL`;
}
