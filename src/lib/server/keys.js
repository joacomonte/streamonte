// Keys de TMDB y TorBox: solo en el servidor, en `.data/keys.json` (gitignoreado). Nunca van al navegador.
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const DIR = '.data';
const FILE = `${DIR}/keys.json`;
/** @type {Record<string, string> | null} */
let cache = null;

/** Las del archivo (lo que edita `/ajustes`). @returns {Promise<Record<string, string>>} */
async function fileKeys() {
	cache ??= JSON.parse(await readFile(FILE, 'utf8').catch(() => '{}'));
	return /** @type {Record<string, string>} */ (cache);
}

/** Variables de entorno (Vercel) por encima de `keys.json`. */
const ENV = { tmdb: 'TMDB_KEY', torbox: 'TORBOX_KEY', opensubtitles: 'OPENSUBTITLES_KEY', opensubtitles_user: 'OPENSUBTITLES_USER', opensubtitles_pass: 'OPENSUBTITLES_PASS' };

/** @returns {Promise<Record<string, string>>} */
export async function keys() {
	const k = { ...(await fileKeys()) };
	for (const [name, env] of Object.entries(ENV)) if (process.env[env]) k[name] = process.env[env];
	return k;
}

/** `''` borra la key; `undefined` la deja como está. @param {Record<string, string | undefined>} next */
export async function setKeys(next) {
	const k = { ...(await fileKeys()) };
	for (const [name, v] of Object.entries(next)) {
		if (v === '') delete k[name];
		else if (v) k[name] = v.trim();
	}
	await mkdir(DIR, { recursive: true });
	await writeFile(FILE, JSON.stringify(k), { mode: 0o600 });
	cache = k;
}
