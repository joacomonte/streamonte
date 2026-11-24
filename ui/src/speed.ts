// "Tu conexión": el botón de la barra de arriba muestra la velocidad de internet y abre un menú con lo que usa la salud
// estimada de los torrents. Estado en speed-store.ts, vista en components/SpeedButton.svelte y SpeedPanel.svelte.
// Al abrir la app se pide la velocidad de esta red (el núcleo mide solo si no tiene una medición); "Medir de nuevo" la fuerza.
import { $ } from './dom.ts';
import { speedStore } from './speed-instance.ts';
import { popFor, togglePop } from './top-menus.ts';
import { host } from './ui-host.ts';
import type { SpeedState } from './types.ts';

/** `s`: evento `speed-test` del núcleo. */
export const onSpeedEvent = (s: SpeedState): void => speedStore.onEvent(s);

function renderPop(): void {
  const pop = popFor('btn-speed');
  if (pop) host.showSpeedPanel?.(pop);
}

export function initSpeed(): void {
  const btn = $('#btn-speed');
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('click', () => { speedStore.setEditing(false); togglePop(btn, renderPop); });
  speedStore.measure(false);
}
