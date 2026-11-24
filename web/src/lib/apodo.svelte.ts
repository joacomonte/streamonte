// Entrar con un apodo (bienvenida y Ajustes): valida el apodo, pregunta al servidor si ya tiene código y abre la
// pantalla de los animales (`ApodoCode.svelte`, montada una vez en +layout.svelte). La promesa se resuelve al crear o
// acertar el código (`{nick}`) o al volver a escribir otro apodo (`{error: ''}`).
import { cleanNick } from './nick.ts';
import type { CodeResult } from '$ui/animals/animals.ts';

export type Asking = { nick: string; mode: 'nuevo' | 'login'; order: string[]; wait: number; done: (r: { nick?: string; error?: string }) => void };

/** La pantalla abierta, o null. */
export const codeAsk = $state<{ current: Asking | null }>({ current: null });

async function fetchAsk(nick: string): Promise<Omit<Asking, 'done'> | { error: string }> {
	try {
		const r = await fetch(`/api/nick?nick=${encodeURIComponent(nick)}`);
		const j = await r.json();
		return r.ok ? { nick: j.nick, mode: j.mode, order: j.order, wait: j.wait } : { error: j.message };
	} catch {
		return { error: 'No se pudo guardar. Probá de nuevo.' };
	}
}

export async function enterNick(raw: string): Promise<{ nick?: string; error?: string }> {
	const c = cleanNick(raw);
	if (!c.nick) return c;
	const a = await fetchAsk(c.nick);
	if ('error' in a) return a;
	return new Promise((done) => (codeAsk.current = { ...a, done }));
}

/** Manda el código. 409 (otro creó el código o el admin lo reseteó): se vuelve a preguntar y la pantalla se rearma. */
export async function sendCode(code: string[]): Promise<CodeResult> {
	const cur = codeAsk.current;
	if (!cur) return { ok: false, error: '' };
	try {
		const r = await fetch('/api/nick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nick: cur.nick, code, mode: cur.mode }) });
		const j = await r.json();
		if (r.ok) return { ok: true };
		if (r.status === 409) {
			const a = await fetchAsk(cur.nick);
			if (!('error' in a)) codeAsk.current = { ...a, done: cur.done };
		}
		return { ok: false, error: j.message, wait: j.wait };
	} catch {
		return { ok: false, error: 'No se pudo guardar. Probá de nuevo.' };
	}
}

/** Cierra la sesión del apodo (borra la cookie en el servidor). */
export async function logoutNick(): Promise<boolean> {
	try {
		return (await fetch('/api/nick', { method: 'DELETE' })).ok;
	} catch {
		return false;
	}
}

/** Los 2 animales (ids, en orden) del dueño con sesión; `null` si todavía no se guardaron o no se pudo pedir. */
export async function myAnimals(): Promise<string[] | null> {
	try {
		const r = await fetch('/api/nick/animales', { cache: 'no-store' });
		return r.ok ? ((await r.json()).animals ?? null) : null;
	} catch {
		return null;
	}
}

export function closeCode(r: { nick?: string; error?: string }) {
	const cur = codeAsk.current;
	codeAsk.current = null;
	cur?.done(r);
}
