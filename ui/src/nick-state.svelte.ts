// Apodo del desktop (la misma cuenta que en la web): estado para la bienvenida, el saludo y Ajustes, y el flujo del
// código de animales (`$ui/animals/nick-flow.svelte.ts`). `initNick` lo fija `boot.ts` con el único `Api` del desktop.
import type { Api } from '$ui/api.ts';
import type { Animal } from '$ui/animals/animals.ts';
import { animalsOf, createNickFlow, type NickFlow } from '$ui/animals/nick-flow.svelte.ts';

type NickState = { loaded: boolean; codeSet: boolean; nick: string | null; animals: Animal[] | null };
/** Lo guardado de la sesión; `loaded` = ya se preguntó (hasta entonces no se sabe si hay apodo). */
export const nickState = $state<NickState>({ loaded: false, codeSet: false, nick: null, animals: null });

let nickApi: Api['nick'] | null = null;
let flow: NickFlow | null = null;

export function initNick(api: Api): void {
	nickApi = api.nick;
	flow = createNickFlow(api.nick);
	void refreshNick();
}

const ready = (): { api: Api['nick']; flow: NickFlow } => {
	if (!nickApi || !flow) throw new Error('Falta initNick(): boot.ts tiene que fijar el Api antes.');
	return { api: nickApi, flow };
};
export const nickFlow = (): NickFlow => ready().flow;
export const nickApiOf = (): Api['nick'] => ready().api;

/** Vuelve a leer apodo y código (locales, del llavero) y, con apodo, los animales (los pide a la web; sin respuesta, `null`). */
export async function refreshNick(): Promise<void> {
	const { api } = ready();
	try {
		const s = await api.status();
		nickState.codeSet = s.codeSet;
		nickState.nick = s.nick;
		nickState.animals = s.nick ? animalsOf(await api.animals().catch(() => null)) : null;
	} catch {
		nickState.codeSet = false;
		nickState.nick = null;
		nickState.animals = null;
	}
	nickState.loaded = true;
}
