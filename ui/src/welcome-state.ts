// Estado de la bienvenida (la dibuja Welcome.svelte): qué paso quedó y si todavía tapa la portada.
import { safeGet } from './catalog-state.ts';

/** 'done' = ya la vio (o la salteó); un número = el paso abierto (para retomarla tras recargar por el idioma). */
export const STORE = 'streamonte.welcome';
/** Desde la carga del módulo: las tarjetas que se arman antes de abrirla ya esperan. */
let touring = safeGet(STORE) !== 'done';
/** La bienvenida tapa la portada: las tarjetas esperan para entrar (catalog.js). */
export const isTouring = () => touring;
export const setTouring = (on: boolean): void => { touring = on; };
