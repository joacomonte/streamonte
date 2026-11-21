// Arranque (botones, atajos, estado inicial) y despacho de los eventos del núcleo al estado
// compartido (state.js). La vista es Buscar (catalog.js); los diálogos viven en dialogs.js, el
// selector de audio en audio-picker.js y la burbuja de actividad en activity-feed.js.
import { api, onCoreEvent } from './api.js';
import { logEvent, renderActivity } from './activity-feed.js';
import { askAfterClose, installMpv, onConfirmClose, onNetCheck, openSettings, saveEqualizer, saveKey, saveNetwork, saveOsLogin, saveLatTeamToken, saveTorboxCode, toggleKeyEdit, toggleLatTeam, toggleTorboxShared } from './dialogs.js';
import { $, icon, setStatus, showError } from './dom.js';
import { translateStatic } from './i18n.js';
import { langPicker, langToggle } from './lang-picker.js';
import { openWelcome } from './welcome.js';
import { markFailed } from './catalog-options.js';
import { initSpeed, onSpeedEvent } from './speed.js';
import { state } from './state.js';
import { playCopied, refreshCache, refreshCopied, refreshDownloads, toggleDownloads } from './top-menus.js';
import './tooltip.js'; // tooltips propios en toda la app (se instala solo)
import './updater.js'; // aviso de versión nueva (GitHub Releases)

const LOG_LINES = 500;

// ---------- atajos (los que anuncian los tooltips) ----------
function onShortcut(ev) {
  if (ev.key === 'F5') ev.preventDefault(); // nunca recargar la ventana
  if (document.querySelector('dialog[open]')) return;
  const typing = ev.target.closest?.('input, textarea, select, [contenteditable]');
  const clickIfUsable = (b) => { if (!b.disabled && !b.hidden && b.offsetParent) b.click(); };
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'v' && !typing) clickIfUsable($('#btn-clipboard'));
}

// ---------- eventos del núcleo ----------
function onEvent(event) {
  logEvent(event);
  switch (event.type) {
    case 'status':
      setStatus(event.message);
      break;
    case 'speed-test':
      onSpeedEvent(event.state);
      break;
    case 'analyzer-progress': {
      state.analyzerState = event.state;
      if (event.state.kind === 'idle') state.pending.clear();
      if (event.state.kind === 'measuring' && event.state.current) state.pending.delete(event.state.current);
      renderActivity();
      refreshDownloads();
      break;
    }
    case 'analyzer-queue':
      // Ya en la cola: el estado real reemplaza al optimista (el rápido sigue hasta tener datos).
      for (const h of [...event.queued, ...event.held]) if (state.pending.get(h) === 'speed') state.pending.delete(h);
      state.queued = event.queued;
      state.held = new Set(event.held);
      renderActivity();
      break;
    case 'library-entry-updated':
      // Fila completa del núcleo (misma forma que `library()`): se reemplaza y se reordena.
      if (event.entry.live && state.pending.get(event.entry.info_hash) === 'quick') state.pending.delete(event.entry.info_hash);
      state.entries.set(event.entry.key, event.entry);
      break;
    case 'library-entry-removed':
      state.entries.delete(event.key);
      break;
    case 'confirm-close':
      onConfirmClose(event.active);
      break;
    case 'playback-updated':
      if (event.row.state.kind === 'failed' && state.playbacks.get(event.row.id)?.state.kind !== 'failed') {
        setStatus(`No se pudo reproducir: ${event.row.state.message}`);
        markFailed(event.row.key.split(':')[0]);
      }
      if (event.row.state.kind === 'ask-after-close' && state.playbacks.get(event.row.id)?.state.kind !== 'ask-after-close') askAfterClose(event.row);
      state.playbacks.set(event.row.id, event.row);
      window.dispatchEvent(new CustomEvent('playback-changed', { detail: event })); // ya guardada: el catálogo redibuja
      renderActivity();
      refreshDownloads();
      break;
    case 'playback-removed':
      state.playbacks.delete(event.id);
      state.logs.delete(event.id);
      window.dispatchEvent(new CustomEvent('playback-changed', { detail: event }));
      renderActivity();
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
  translateStatic(document.body);
  $('#btn-settings').before(langToggle());
  $('#set-lang-picker').append(langPicker('set-lang'));
  openWelcome();
  $('#btn-clipboard').addEventListener('click', playCopied);
  $('#btn-downloads').addEventListener('click', toggleDownloads);
  $('#btn-settings').append(icon('gear', 24));
  $('#btn-settings').addEventListener('click', openSettings);
  // Lo copiado se mira al volver a la app y cada tanto (copiar un magnet afuera y volver).
  window.addEventListener('focus', refreshCopied);
  refreshCopied();
  setInterval(() => { if (document.hasFocus()) refreshCopied(); }, 3000);
  for (const r of document.querySelectorAll('input[name="set-eq"]')) r.addEventListener('change', saveEqualizer);
  $('#btn-install-mpv').addEventListener('click', installMpv);
  $('#set-incoming').addEventListener('change', saveNetwork);
  $('#set-announce').addEventListener('change', saveNetwork);
  $('#set-upnp').addEventListener('change', saveNetwork);
  $('#btn-net-check').addEventListener('click', onNetCheck);
  document.querySelectorAll('[data-save-key]').forEach((b) => b.addEventListener('click', () => saveKey(b.dataset.saveKey)));
  $('#os-login-save').addEventListener('click', saveOsLogin);
  $('#set-latteam-on').addEventListener('change', toggleLatTeam);
  $('#key-latteam-save').addEventListener('click', saveLatTeamToken);
  $('#set-torbox-shared').addEventListener('change', toggleTorboxShared);
  $('#key-torbox-code-save').addEventListener('click', saveTorboxCode);
  $('#key-torbox-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveTorboxCode(); });
  document.querySelectorAll('.key-change').forEach((b) => b.addEventListener('click', () => toggleKeyEdit(b.closest('.key-row').dataset.service)));
  document.querySelectorAll('[data-key-page]').forEach((b) => b.addEventListener('click', () => api.openKeyPage(b.dataset.keyPage).catch(showError)));
  document.querySelectorAll('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
  document.addEventListener('keydown', onShortcut);
  $('#dlg-log').addEventListener('close', () => (state.logOpenFor = null));

  await onCoreEvent(onEvent);

  // Estado inicial.
  const view = await api.library();
  for (const e of [...view.pasted_now, ...view.previous]) if (!state.entries.has(e.key)) state.entries.set(e.key, e);
  for (const r of await api.playbacks()) state.playbacks.set(r.id, r);
  renderActivity();
  refreshDownloads();
  refreshCache();
  setInterval(refreshCache, 30_000);
  initSpeed();
}

init().catch(showError);
