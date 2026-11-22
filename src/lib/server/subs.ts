// Subtítulos en español: OpenSubtitles.org (XML-RPC, sesión anónima, gratis) y, abajo, Premium (OpenSubtitles.com). Como
// crates/core/src/subtitles/providers/opensubtitles_org.rs. Se entregan como .srt suelto en UTF-8.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { Fail, get } from './http.ts';
import { keys } from './keys.ts';

const ENDPOINT = 'https://api.opensubtitles.org/xml-rpc';
/** El único user agent que acepta para sesiones anónimas. */
const UA = 'VLSub 0.11.1';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const str = (s: string) => `<string>${esc(s)}</string>`;
const member = (name: string, value: string) => `<member><name>${name}</name><value>${value}</value></member>`;

async function rpc(method: string, params: string[]): Promise<string> {
	const body = `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>${params.map((p) => `<param><value>${p}</value></param>`).join('')}</params></methodCall>`;
	const r = await get(ENDPOINT, { method: 'POST', headers: { 'content-type': 'text/xml', 'user-agent': UA }, body }, 20_000);
	if (!r.ok) throw new Fail(502, 'OpenSubtitles respondió {s}.', { s: r.status });
	return r.text();
}

/** Miembros simples de un `<struct>` (los anidados se ignoran). */
export function members(xml: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const m of xml.matchAll(/<member>\s*<name>([^<]*)<\/name>\s*<value>\s*(?:<(?:string|int|double)>)?([^<]*)/g)) out[m[1].trim()] = unesc(m[2]);
	return out;
}
export const results = (xml: string): Record<string, string>[] => {
	const i = xml.indexOf('<name>data</name>');
	return i < 0 ? [] : xml.slice(i).split('<struct>').slice(1).map(members);
};

let session: { value: string; at: number } | null = null;
async function token(): Promise<string> {
	if (session && Date.now() - session.at < 10 * 60_000) return session.value;
	const xml = await rpc('LogIn', [str(''), str(''), str('eng'), str(UA)]);
	const t = members(xml).token;
	if (!t) throw new Fail(502, 'OpenSubtitles no dio sesión anónima.');
	session = { value: t, at: Date.now() };
	return t;
}

/** Subtítulos en español del título. Con `file` (hash de OpenSubtitles y tamaño del archivo que se va a ver) también
 * busca los hechos para ese archivo exacto: esos van en sync y salen marcados `exact`. */
export async function search(imdb: string, s: string | null, e: string | null, file: { hash: string; size: string } | null = null) {
	const lang = member('sublanguageid', str('spa,spl'));
	let crit = lang + member('imdbid', str(imdb.replace(/^tt/, '')));
	if (s && e) crit += member('season', `<int>${Number(s)}</int>`) + member('episode', `<int>${Number(e)}</int>`);
	const queries = [crit];
	if (file) queries.unshift(lang + member('moviehash', str(file.hash)) + member('moviebytesize', str(file.size)));
	const xml = await rpc('SearchSubtitles', [str(await token()), `<array><data>${queries.map((q) => `<value><struct>${q}</struct></value>`).join('')}</data></array>`]);
	/** `fps` (null si no se sabe), `last`: segundo del último diálogo, `group`: grupo del release, para estimar si calza. */
	const byId = new Map<string, { id: string; release: string; latino: boolean; format: string; downloads: number; exact: boolean; fps: number | null; last: number | null; group: string }>();
	for (const r of results(xml)) {
		if (!['srt', 'ass', 'ssa', 'vtt'].includes(r.SubFormat) || !r.IDSubtitleFile) continue;
		const id = r.IDSubtitleFile.trim();
		const exact = r.MatchedBy === 'moviehash' || !!byId.get(id)?.exact;
		byId.set(id, {
			id,
			release: (r.MovieReleaseName?.trim() || r.SubFileName || '').trim(),
			latino: r.SubLanguageID === 'spl',
			format: r.SubFormat,
			downloads: Number(r.SubDownloadsCnt) || 0,
			exact,
			fps: Number(r.MovieFPS) || null,
			last: seconds(r.SubLastTS),
			group: (r.InfoReleaseGroup ?? '').trim()
		});
	}
	return [...byId.values()].sort((a, b) => b.downloads - a.downloads);
}

/** `hh:mm:ss` → segundos (null si no viene). */
export function seconds(ts: string | undefined): number | null {
	const m = ts?.match(/^(\d+):(\d+):(\d+)/);
	return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/** Texto del subtítulo en UTF-8 (muchos vienen en Windows-1252). */
export async function download(id: string): Promise<string> {
	if (!/^\d+$/.test(id)) throw new Fail(400, 'Id de subtítulo inválido.');
	const xml = await rpc('DownloadSubtitles', [str(await token()), `<array><data><value>${str(id)}</value></data></array>`]);
	if (/<name>status<\/name>\s*<value>\s*<string>407/.test(xml)) throw new Fail(429, 'OpenSubtitles: límite de descargas anónimas del día.');
	const data = results(xml)[0]?.data;
	if (!data) throw new Fail(404, 'OpenSubtitles no devolvió el subtítulo.');
	return utf8(gunzipSync(Buffer.from(data.replace(/\s/g, ''), 'base64'), { maxOutputLength: 5 * 1024 * 1024 }));
}

// ---------- Premium: OpenSubtitles.com con la key del usuario (2026-11-18) ----------
// Pocas descargas por día: buscar no gasta; cada descarga gasta 1 y se hace SOLO con el toque del usuario
// (`POST /api/premium/<id>`). Lo bajado queda en `.data/premium/` y el link que se copia lo sirve de ahí:
// que la tele lo pida varias veces no vuelve a gastar. Como crates/core/src/subtitles/providers/opensubtitles.rs.

const OS_API = 'https://api.opensubtitles.com/api/v1';
// En Vercel solo se puede escribir en /tmp (se borra al reciclar la función: volver a copiar gasta 1 de nuevo).
const PREMIUM_DIR = process.env.VERCEL ? '/tmp/premium' : '.data/premium';
/** Cuota según la última descarga (null = no se sabe desde que arrancó el servidor). */
let quota: { remaining: number; perDay: number; resetsAt: number | null } | null = null;

async function osKey(): Promise<string> {
	const k = (await keys()).opensubtitles;
	if (!k) throw new Fail(428, 'Necesita tu API key de opensubtitles.com.');
	return k;
}
const osHeaders = (key: string) => ({ 'api-key': key, 'user-agent': 'Streamonte v1', accept: 'application/json' });

/** Login con usuario y contraseña (opcional): da la cuota de la cuenta desde el arranque y las descargas van a su nombre.
 * El token dura 24 h; se guarda solo en memoria. */
let account: { who: string; token: string; api: string; until: number } | null = null;
/** Login rechazado: no se reintenta hasta que cambien las credenciales. */
let rejected: { who: string; message: string } | null = null;
/** Cuándo se leyó la cuota de la cuenta (`/infos/user`), para no pedirla en cada apertura. */
let quotaAt = 0;

/** Token de la cuenta, o null si no hay usuario y contraseña cargados. */
async function osSession(): Promise<{ who: string; token: string; api: string; until: number } | null> {
	const k = await keys();
	if (!k.opensubtitles_user || !k.opensubtitles_pass) return null;
	const who = `${k.opensubtitles_user}\n${k.opensubtitles_pass}`;
	if (account?.who === who && Date.now() < account.until) return account;
	if (rejected?.who === who) throw new Fail(401, rejected.message);
	const r = await get(`${OS_API}/login`, { method: 'POST', headers: { ...osHeaders(await osKey()), 'content-type': 'application/json' },
		body: JSON.stringify({ username: k.opensubtitles_user, password: k.opensubtitles_pass }) }, 20_000).catch(() => null);
	const j = (await r?.json().catch(() => null)) as { token?: string; base_url?: string } | null | undefined;
	if (!r?.ok || !j?.token) {
		// Usuario o contraseña mal: no reintentar. Caída de la red o del servidor: se reintenta en el próximo toque.
		if (r && r.status < 500) {
			rejected = { who, message: 'opensubtitles.com rechazó el usuario o la contraseña: revisalos en Ajustes.' };
			throw new Fail(401, rejected.message);
		}
		throw new Fail(502, 'No pude iniciar sesión en opensubtitles.com.');
	}
	account = { who, token: j.token, api: j.base_url ? `https://${j.base_url}/api/v1` : OS_API, until: Date.now() + 23 * 3600_000 };
	return account;
}

/** Cuota para mostrar: `remaining`/`perDay` null = no se sabe; `resetsAt` = ms; `login`: error del login, si falló. */
export async function premiumQuota() {
	if (quota?.resetsAt && Date.now() >= quota.resetsAt) quota = null;
	const hasKey = Boolean((await keys()).opensubtitles);
	let login: string | null = null;
	if (hasKey && Date.now() - quotaAt > 60_000) {
		try {
			const s = await osSession();
			if (s) {
				const r = await get(`${s.api}/infos/user`, { headers: { ...osHeaders(await osKey()), authorization: `Bearer ${s.token}` } }, 15_000);
				const d = ((await r.json().catch(() => ({}))) as { data?: { remaining_downloads?: number; allowed_downloads?: number; reset_time_utc?: string } }).data ?? {};
				if (r.status === 401) account = null;
				else if (Number.isFinite(d.remaining_downloads)) {
					quota = { remaining: Math.max(0, d.remaining_downloads as number), perDay: Number(d.allowed_downloads) || 0, resetsAt: Date.parse(d.reset_time_utc ?? '') || null };
					quotaAt = Date.now();
				}
			}
		} catch (e) {
			login = (e as Error).message;
		}
	}
	return { hasKey, remaining: quota?.remaining ?? null, perDay: quota?.perDay ?? null, resetsAt: quota?.resetsAt ?? null, login };
}

/** Busca en español (no gasta). Mismo formato que `search`, con `premium: true`.
 */
export async function premiumSearch(imdb: string, s: string | null, e: string | null, file: { hash: string } | null = null) {
	const q = new URLSearchParams({ languages: 'ea,es,sp', imdb_id: imdb.replace(/^tt/, '') });
	if (s && e) q.set('season_number', s), q.set('episode_number', e);
	if (file) q.set('moviehash', file.hash);
	const r = await get(`${OS_API}/subtitles?${q}`, { headers: osHeaders(await osKey()) }, 20_000);
	if (r.status === 401 || r.status === 403) throw new Fail(401, 'opensubtitles.com rechazó la key: revisala en Ajustes.');
	if (!r.ok) throw new Fail(502, 'opensubtitles.com no respondió. No se gastó ninguna descarga.');
	const j = (await r.json()) as { data?: { attributes?: { files?: { file_id?: number }[]; language?: string; release?: string; download_count?: number; moviehash_match?: boolean; fps?: number } }[] };
	return (j.data ?? []).flatMap((item) => {
		const a = item.attributes ?? {};
		const id = a.files?.[0]?.file_id;
		if (!id || !['ea', 'es', 'sp'].includes(a.language ?? '')) return [];
		return [{ id: String(id), release: String(a.release ?? ''), latino: a.language === 'ea', format: 'srt', downloads: Number(a.download_count) || 0,
			exact: a.moviehash_match === true, fps: Number(a.fps) || null, last: null, group: '', premium: true }];
	});
}

/** Descargas en curso: un doble toque no gasta dos. */
const inflight = new Map<string, ReturnType<typeof premiumQuota>>();

/** Baja UNO (gasta 1 de la cuota) y lo guarda para servirlo. Lo ya bajado no vuelve a gastar. */
export function premiumDownload(id: string) {
	if (!/^\d+$/.test(id)) throw new Fail(400, 'Id de subtítulo inválido.');
	const running = inflight.get(id) ?? fetchPremium(id).finally(() => inflight.delete(id));
	inflight.set(id, running);
	return running;
}

async function fetchPremium(id: string) {
	if (await premiumFile(id)) return premiumQuota();
	if (quota?.remaining === 0 && (!quota.resetsAt || Date.now() < quota.resetsAt)) throw new Fail(429, 'No quedan descargas de Premium por hoy.');
	const key = await osKey();
	// Con login, la descarga cuenta en la cuenta (y su cuota); si el login falla, sigue como antes, solo con la key.
	const s = await osSession().catch(() => null);
	const auth: Record<string, string> = s ? { authorization: `Bearer ${s.token}` } : {};
	const r = await get(`${s?.api ?? OS_API}/download`, { method: 'POST', headers: { ...osHeaders(key), ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ file_id: Number(id) }) }, 20_000);
	if (r.status === 401 && s) account = null;
	quotaAt = Date.now();
	const j = (await r.json().catch(() => ({}))) as { requests?: number; reset_time_utc?: string; link?: string; remaining?: number };
	const used = Number(j.requests) || 0;
	const resetsAt = Date.parse(j.reset_time_utc ?? '') || null;
	if (r.status === 406) {
		quota = { remaining: 0, perDay: used || quota?.perDay || 0, resetsAt };
		throw new Fail(429, 'No quedan descargas de Premium por hoy.');
	}
	if (!r.ok || !j.link) throw new Fail(502, 'opensubtitles.com no dio el subtítulo.');
	if (typeof j.remaining === 'number' && Number.isFinite(j.remaining)) quota = { remaining: Math.max(0, j.remaining), perDay: used + Math.max(0, j.remaining), resetsAt };
	const file = await get(j.link, {}, 20_000);
	if (!file.ok) throw new Fail(502, 'opensubtitles.com no dio el subtítulo.');
	const bytes = new Uint8Array(await file.arrayBuffer());
	await mkdir(PREMIUM_DIR, { recursive: true });
	await writeFile(`${PREMIUM_DIR}/${id}.srt`, utf8(bytes));
	return premiumQuota();
}

/** El texto de un Premium ya bajado, o null. */
export async function premiumFile(id: string): Promise<string | null> {
	if (!/^\d+$/.test(id)) return null;
	return readFile(`${PREMIUM_DIR}/${id}.srt`, 'utf8').catch(() => null);
}

/** Bytes de un subtítulo → texto UTF-8 (muchos vienen en Windows-1252), sin BOM. */
export function utf8(bytes: Uint8Array): string {
	let text: string;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		text = new TextDecoder('windows-1252').decode(bytes);
	}
	return text.replace(/^﻿/, '');
}
