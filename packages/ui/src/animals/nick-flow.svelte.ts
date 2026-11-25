// Entrar con un apodo sobre `Api['nick']` (el desktop; la web arma lo mismo con fetch en `web/src/lib/apodo.svelte.ts`):
// valida el apodo, pregunta si ya tiene código y abre la pantalla de los animales (`NickCode.svelte`). `enterNick` se
// resuelve al crear o acertar el código (`{nick}`) o al volver a escribir otro apodo (`{error: ''}`).
import type { Api } from '../api.ts';
import { t } from '../i18n/runtime.ts';
import { ANIMALS, type Animal, type CodeResult } from './animals.ts';
import { cleanNick } from './nick.ts';

export type Asking = { nick: string; mode: 'nuevo' | 'login'; order: string[]; wait: number; done: (r: { nick?: string; error?: string }) => void };
export type NickFlow = ReturnType<typeof createNickFlow>;

const FAILED = 'No se pudo guardar. Probá de nuevo.';
/** El mensaje de un rechazo del núcleo (texto) o de un error; si no hay, el genérico. */
const messageOf = (e: unknown): string => (typeof e === 'string' && e ? e : e instanceof Error && e.message ? e.message : FAILED);

/** Los animales (en orden) de esos ids; `null` si no son exactamente 2 conocidos. */
export function animalsOf(ids: string[] | null): Animal[] | null {
	const found = (ids ?? []).map((id) => ANIMALS.find((a) => a.id === id)).filter((a): a is Animal => !!a);
	return found.length === 2 ? found : null;
}

export function createNickFlow(nick: Api['nick']) {
	/** La pantalla abierta, o null. */
	const ask = $state<{ current: Asking | null }>({ current: null });
	let entered: string | undefined;

	async function fetchAsk(name: string): Promise<Omit<Asking, 'done'> | { error: string }> {
		try {
			return await nick.ask(name);
		} catch (e) {
			return { error: messageOf(e) };
		}
	}

	return {
		ask,
		async enterNick(raw: string): Promise<{ nick?: string; error?: string }> {
			const c = cleanNick(raw);
			if (!c.nick) return c;
			const a = await fetchAsk(c.nick);
			if ('error' in a) return a;
			entered = undefined;
			return new Promise((done) => (ask.current = { ...a, done }));
		},
		/** Manda el código. `changed` (otro creó el código o se reseteó): se vuelve a preguntar y la pantalla se rearma. */
		async sendCode(code: string[]): Promise<CodeResult> {
			const cur = ask.current;
			if (!cur) return { ok: false, error: '' };
			try {
				const r = await nick.enter(cur.nick, code, cur.mode);
				if (r.ok) {
					entered = r.nick ?? cur.nick;
					return r;
				}
				if (r.changed) {
					const a = await fetchAsk(cur.nick);
					if (!('error' in a)) ask.current = { ...a, done: cur.done };
				}
				return { ...r, error: t(r.error) };
			} catch (e) {
				return { ok: false, error: t(messageOf(e)) };
			}
		},
		/** Cierra la pantalla: `done` = creado o acertado; sin él, volver a escribir el apodo. */
		close(done: boolean) {
			const cur = ask.current;
			ask.current = null;
			cur?.done(done ? { nick: entered ?? cur.nick } : { error: '' });
		}
	};
}
