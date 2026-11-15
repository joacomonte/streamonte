// UI de Mis magnets: arranque (botones, atajos de teclado, estado inicial) y despacho de los
// eventos del núcleo al estado compartido (state.js) y a las vistas. Las filas viven en
// library-rows.js, los diálogos en dialogs.js, el selector de audio en audio-picker.js y lo que
// se cuenta en la burbuja de actividad en activity-feed.js.
import { api, onCoreEvent } from './api.js';
import { logEvent } from './activity-feed.js';
import { onAnalyzeAll, onAnalyzeSelected, onCheckAll, onPauseAll, renderAnalyzer } from './analysis-toolbar.js';
import { play } from './audio-picker.js';
import { askAfterClose, onConfirmClose, openSettings, saveKey, saveNetwork } from './dialogs.js';
import { $, setStatus, showError } from './dom.js';
import { clearEntries, closeMenu, loadLibrary, removeEntry, renderLibrary, upsertEntry } from './library-rows.js';
import { state } from './state.js';
import { refreshDownloads, toggleClipboard, toggleDownloads } from './top-menus.js';
import './tooltip.js'; // tooltips propios en toda la app (se instala solo)
import './updater.js'; // aviso de versión nueva (GitHub Releases)

const LOG_LINES = 500;

// ---------- atajos (los que anuncian los tooltips) ----------
function onShortcut(ev) {
  if (ev.key === 'F5') ev.preventDefault(); // nunca recargar la ventana
  if (document.querySelector('dialog[open]')) return;
  const typing = ev.target.closest?.('input, textarea, select, [contenteditable]');
  const clickIfUsable = (b) => { if (!b.disabled && !b.hidden && b.offsetParent) b.click(); };
  if (ev.key === 'F5') clickIfUsable($('#btn-analyze'));
  else if (ev.key === 'Enter' && !typing && !ev.target.closest?.('button, a') && !$('.library').hidden && state.selected) play(state.selected);
  else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'v' && !typing) clickIfUsable($('#btn-clipboard'));
}

// ---------- eventos del núcleo ----------
function onEvent(event) {
  logEvent(event);
  switch (event.type) {
    case 'status':
      setStatus(event.message);
      break;
    case 'analyzer-progress': {
      const wasRunning = state.analyzerState.kind !== 'idle' && state.analyzerState.kind !== 'paused';
      state.analyzerState = event.state;
      if (event.state.kind === 'idle') state.pending.clear();
      if (event.state.kind === 'measuring' && event.state.current) state.pending.delete(event.state.current);
      renderAnalyzer();
      renderLibrary(); // velocidad en vivo, "Listo", "en cola"
      refreshDownloads();
      if (wasRunning && event.state.kind === 'idle') setStatus('Análisis terminado: la lista quedó ordenada de mejor a peor.');
      break;
    }
    case 'analyzer-queue':
      // Ya en la cola: el estado real reemplaza al optimista (el rápido sigue hasta tener datos).
      for (const h of [...event.queued, ...event.held]) if (state.pending.get(h) === 'speed') state.pending.delete(h);
      state.queued = event.queued;
      state.held = new Set(event.held);
      renderLibrary();
      break;
    case 'library-entry-updated':
      // Fila completa del núcleo (misma forma que `library()`): se reemplaza y se reordena.
      if (event.entry.live && state.pending.get(event.entry.info_hash) === 'quick') state.pending.delete(event.entry.info_hash);
      upsertEntry(event.entry);
      break;
    case 'library-entry-removed':
      removeEntry(event.key);
      break;
    case 'library-cleared':
      clearEntries();
      break;
    case 'confirm-close':
      onConfirmClose(event.active);
      break;
    case 'playback-updated':
      if (event.row.state.kind === 'failed' && state.playbacks.get(event.row.id)?.state.kind !== 'failed') setStatus(`No se pudo reproducir: ${event.row.state.message}`);
      if (event.row.state.kind === 'ask-after-close' && state.playbacks.get(event.row.id)?.state.kind !== 'ask-after-close') askAfterClose(event.row);
      state.playbacks.set(event.row.id, event.row);
      renderLibrary(); // "% bajado · pausaste en…" del detalle
      refreshDownloads();
      break;
    case 'playback-removed':
      state.playbacks.delete(event.id);
      state.logs.delete(event.id);
      renderLibrary();
      refreshDownloads();
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
  $('#btn-clipboard').addEventListener('click', toggleClipboard);
  $('#btn-downloads').addEventListener('click', toggleDownloads);
  $('#btn-analyze').addEventListener('click', onAnalyzeAll);
  $('#btn-pause-all').addEventListener('click', onPauseAll);
  $('#btn-analyze-selected').addEventListener('click', onAnalyzeSelected);
  $('#check-all').addEventListener('change', onCheckAll);
  $('#btn-settings').addEventListener('click', openSettings);
  $('#set-incoming').addEventListener('change', saveNetwork);
  $('#set-upnp').addEventListener('change', saveNetwork);
  document.querySelectorAll('[data-save-key]').forEach((b) => b.addEventListener('click', () => saveKey(b.dataset.saveKey)));
  document.querySelectorAll('[data-key-page]').forEach((b) => b.addEventListener('click', () => api.openKeyPage(b.dataset.keyPage).catch(showError)));
  document.querySelectorAll('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
  document.addEventListener('click', (ev) => { if (!ev.target.closest('#ctx-menu')) closeMenu(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeMenu(); });
  document.addEventListener('keydown', onShortcut);
  window.addEventListener('blur', closeMenu);
  $('#dlg-log').addEventListener('close', () => (state.logOpenFor = null));

  await onCoreEvent(onEvent);

  // Estado inicial.
  await loadLibrary();
  for (const r of await api.playbacks()) state.playbacks.set(r.id, r);
  renderLibrary();
  refreshDownloads();
}

init().catch(showError);
