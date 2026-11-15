// Análisis de toda la lista (FR-05–08): botones de la barra (analizar todo / seleccionados,
// pausar todo, marcar todos) y el progreso en la barra de estado.
import { api } from './api.js';
import { $, setStatus, showError } from './dom.js';
import { renderLibrary, renderToolbar, requestAnalysis } from './library-rows.js';
import { entryOfHash, fullName, hashesOf, state } from './state.js';

export function renderAnalyzer() {
  const s = state.analyzerState;
  const progress = $('#progress');
  progress.hidden = s.kind === 'idle';
  renderToolbar();
  if (s.kind === 'scraping') {
    progress.removeAttribute('value');
    setStatus(`Consultando trackers de ${s.total} magnet(s)…`);
  } else if (s.kind === 'quick-scan') {
    progress.removeAttribute('value');
    setStatus(`Datos rápidos de ${s.total} magnet(s) a la vez: nombre, duración, seeds y peers conectados…`);
  } else if (s.kind === 'measuring') {
    progress.value = s.total ? s.done / s.total : 0;
    const cur = s.current ? entryOfHash(s.current) : null;
    const live = s.live ? ` · ${Math.round(s.live.secs)} s${s.live.stable ? ', ya estable' : ''}` : '';
    setStatus(`Velocidad real ${s.done + 1} de ${s.total}${cur ? `: ${fullName(cur)}` : ''}${live} — de a uno para no repartir tu conexión. "Listo" corta con lo medido.`);
  } else if (s.kind === 'paused') {
    progress.value = s.total ? s.done / s.total : 0;
    setStatus(`Análisis en pausa (${s.done} de ${s.total} medidos).`);
  }
}

export async function onAnalyzeAll() {
  if (state.entries.size === 0) {
    setStatus('No hay magnets para analizar: copiá alguno primero.');
    return;
  }
  await requestAnalysis('speed', hashesOf([...state.entries.keys()]), { kind: 'all' }, `Pediste analizar todo (${state.entries.size})`);
}

export async function onPauseAll() {
  try {
    if (state.analyzerState.kind === 'paused') await api.analyzerResume();
    else await api.analyzerPause();
  } catch (e) {
    showError(e);
  }
}

export async function onAnalyzeSelected() {
  const hashes = hashesOf([...state.checked]);
  if (!hashes.length) return;
  await requestAnalysis('speed', hashes, { kind: 'selected', hashes }, `Pediste analizar ${hashes.length} seleccionado(s)`);
  state.checked.clear();
  renderLibrary();
}

export function onCheckAll(ev) {
  if (ev.target.checked) for (const h of state.entries.keys()) state.checked.add(h);
  else state.checked.clear();
  renderLibrary();
}
