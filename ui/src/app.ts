// Arranque (botones, atajos, estado inicial) y despacho de los eventos del núcleo al estado
// que todavía no migraron. El estado en vivo (biblioteca, reproducciones, análisis) y la actividad los lleva
// live.svelte.ts (`startLive`); la barra de arriba y la burbuja son components/*.svelte. La vista es Buscar (catalog.ts);
// los diálogos viven en dialog-flows.ts y el selector de audio en audio-picker.ts.
import { askAfterClose, onConfirmClose, openSettings, playbackLogs } from './dialog-flows.ts';
import { $, $button, icon, setStatus } from './dom.ts';
import { translateStatic } from './i18n.ts';
import { mountLangToggle } from './mount-shared.ts';
import { markFailed } from './catalog-options.ts';
import { initSpeed, onSpeedEvent } from './speed.ts';
import { startLive } from './live.svelte.ts';
import { installTooltips } from './tooltip.ts';
import { startUpdater } from './updater.ts';
import type { CoreEvent } from './types.ts';
import type { Live } from './live.ts';

const LOG_LINES = 500;

// ---------- atajos (los que anuncian los tooltips) ----------
function onShortcut(ev: KeyboardEvent): void {
  if (ev.key === 'F5') ev.preventDefault(); // nunca recargar la ventana
  if (document.querySelector('dialog[open]')) return;
  const typing = (ev.target as Element).closest?.('input, textarea, select, [contenteditable]');
  const clickIfUsable = (b: HTMLButtonElement): void => { if (!b.disabled && !b.hidden && b.offsetParent) b.click(); };
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'v' && !typing) clickIfUsable($button('#btn-clipboard'));
}

// ---------- eventos del núcleo ----------
/** Ya con `live.v` al día; `prev` es el estado anterior al evento. */
function onEvent(event: CoreEvent, prev: Live): void {
  switch (event.type) {
    case 'status':
      setStatus(event.message);
      break;
    case 'speed-test':
      onSpeedEvent(event.state);
      break;
    case 'confirm-close':
      onConfirmClose(event.active);
      break;
    case 'playback-updated':
      if (event.row.state.kind === 'failed' && prev.playbacks.get(event.row.id)?.state.kind !== 'failed') {
        setStatus(`No se pudo reproducir: ${event.row.state.message}`);
        markFailed(event.row.key.split(':')[0]);
      }
      if (event.row.state.kind === 'ask-after-close' && prev.playbacks.get(event.row.id)?.state.kind !== 'ask-after-close') askAfterClose(event.row);
      window.dispatchEvent(new CustomEvent('playback-changed', { detail: event })); // ya guardada: el catálogo redibuja
      break;
    case 'playback-removed':
      playbackLogs.lines.delete(event.id);
      window.dispatchEvent(new CustomEvent('playback-changed', { detail: event }));
      break;
    case 'playback-log': {
      const lines = playbackLogs.lines.get(event.id) ?? [];
      lines.push(event.line);
      if (lines.length > LOG_LINES) lines.shift();
      playbackLogs.lines.set(event.id, lines);
      if (playbackLogs.openFor === event.id) {
        const pre = $('#dlg-log-body');
        // shortcut: solo se agrega la línea nueva; el <pre> abierto puede pasar de LOG_LINES hasta reabrirlo.
        pre.append(`${pre.hasChildNodes() ? '\n' : ''}${event.line}`);
        pre.scrollTop = pre.scrollHeight;
      }
      break;
    }
    default:
      break;
  }
}

// ---------- arranque ----------
/** Arranque (botones, atajos, estado inicial): lo llama `main.ts` después de montar los diálogos. */
export async function initApp(): Promise<void> {
  installTooltips();
  startUpdater();
  translateStatic(document.body);
  mountLangToggle($('#btn-settings'));
  $('#btn-settings').append(icon('gear', 24));
  $('#btn-settings').addEventListener('click', () => openSettings());
  document.addEventListener('keydown', onShortcut);
  $('#dlg-log').addEventListener('close', () => (playbackLogs.openFor = null));

  await startLive(onEvent);
  initSpeed();
}

