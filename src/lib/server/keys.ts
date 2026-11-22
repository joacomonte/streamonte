// Keys de TMDB y TorBox: solo en el servidor, en `.data/keys.json` (gitignoreado). Nunca van al navegador.
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const DIR = '.data';
const FILE = `${DIR}/keys.json`;
let cache: Record<string, string> | null = null;

/** Las del archivo (lo que edita `/ajustes`). */
async function fileKeys(): Promise<Record<string, string>> {
	cache ??= JSON.parse(await readFile(FILE, 'utf8').catch(() => '{}'));
	return cache ?? {};
}

/** Variables de entorno (Vercel) por encima de `keys.json`. */
const ENV = { tmdb: 'TMDB_KEY', torbox: 'TORBOX_KEY', opensubtitles: 'OPENSUBTITLES_KEY', opensubtitles_user: 'OPENSUBTITLES_USER', opensubtitles_pass: 'OPENSUBTITLES_PASS' };

export async function keys(): Promise<Record<string, string>> {
	const k = { ...(await fileKeys()) };
	for (const [name, env] of Object.entries(ENV)) if (process.env[env]) k[name] = process.env[env];
	return k;
}

/** `''` borra la key; `undefined` la deja como está. */
export async function setKeys(next: Record<string, string | undefined>): Promise<void> {
	const k = { ...(await fileKeys()) };
	for (const [name, v] of Object.entries(next)) {
		if (v === '') delete k[name];
		else if (v) k[name] = v.trim();
	}
	await mkdir(DIR, { recursive: true });
	await writeFile(FILE, JSON.stringify(k), { mode: 0o600 });
	cache = k;
}
