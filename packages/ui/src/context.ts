// `Api` por contexto de Svelte: la app lo fija en su raíz (`setApi`) y los componentes compartidos lo leen (`getApi`).
import { getContext, setContext } from 'svelte';
import type { Api } from './api.ts';

const KEY = Symbol('streamonte.api');

export const setApi = (api: Api): void => void setContext(KEY, api);

export function getApi(): Api {
	const api = getContext<Api | undefined>(KEY);
	if (!api) throw new Error('Falta setApi(): la app tiene que fijar el Api en su raíz.');
	return api;
}

/** Contexto listo para `mount(Comp, { context })`: para montar un componente compartido desde código que no es Svelte (desktop legacy). */
export const apiContext = (api: Api): Map<unknown, unknown> => new Map([[KEY, api]]);
