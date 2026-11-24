// @ts-check
// Arranque (botones, atajos, estado inicial) y despacho de los eventos del núcleo al estado
// que todavía no migraron. El estado en vivo (biblioteca, reproducciones, análisis) y la actividad los lleva
// live.svelte.ts (`startLive`); la barra de arriba y la burbuja son components/*.svelte. La vista es Buscar (catalog.js);
// los diálogos viven en dialogs.js y el selector de audio en audio-picker.js.
import { askAfterClose, onConfirmClose, openSettings } from './dialogs.js';
import { $, $button, icon, setStatus, showError } from './dom.js';
import { translateStatic } from './i18n.js';
import { langToggle } from './lang-picker.js';
import { markFailed } from './catalog-options.ts';
import { initSpeed, onSpeedEvent } from './speed.js';
import { state } from './state.js';
import { startLive } from './live.svelte.ts';
import './tooltip.js'; // tooltips propios en toda la app (se instala solo)
import './updater.js'; // aviso de versión nueva (GitHub Releases)

const LOG_LINES = 500;

// ---------- atajos (los que anuncian los tooltips) ----------
/** @param {KeyboardEvent} ev */
function onShortcut(ev) {
  if (ev.key === 'F5') ev.preventDefault(); // nunca recargar la ventana
  if (document.querySelector('dialog[open]')) return;
  const typing = /** @type {Element} */ (ev.target).closest?.('input, textarea, select, [contenteditable]');
  /** @param {HTMLButtonElement} b */
  const clickIfUsable = (b) => { if (!b.disabled && !b.hidden && b.offsetParent) b.click(); };
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'v' && !typing) clickIfUsable($button('#btn-clipboard'));
}

// ---------- eventos del núcleo ----------
/** Ya con `live.v` al día; `prev` es el estado anterior al evento.
 *  @param {import('./types.ts').CoreEvent} event @param {import('./live.ts').Live} prev */
function onEvent(event, prev) {
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
      state.logs.delete(event.id);
      window.dispatchEvent(new CustomEvent('playback-changed', { detail: event }));
      break;
    case 'playback-log': {
      const lines = state.logs.get(event.id) ?? [];
      lines.push(event.line);
      if (lines.length > LOG_LINES) lines.shift();
      state.logs.set(event.id, lines);
      if (state.logOpenFor === event.id) {
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
async function init() {
  translateStatic(document.body);
  $('#btn-settings').before(langToggle());
  $('#btn-settings').append(icon('gear', 24));
  $('#btn-settings').addEventListener('click', openSettings);
  document.addEventListener('keydown', onShortcut);
  $('#dlg-log').addEventListener('close', () => (state.logOpenFor = null));

  await startLive(onEvent);
  initSpeed();
}

init().catch(showError);
