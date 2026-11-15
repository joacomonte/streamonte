// Lista de Mis magnets (FR-03, FR-29b): pedir la biblioteca, dibujar las filas (diseño aprobado
// design/cards-v3.html, "Fracción y sello"), su detalle desplegable, la velocidad en vivo, los
// pedidos de análisis por fila, el menú contextual (FR-30) y los contadores de la barra de análisis.
import { api } from './api.js';
import { activity } from './activity.js';
import { renderActivity } from './activity-feed.js';
import { play } from './audio-picker.js';
import { confirmDialog, openLog, showAnalysis } from './dialogs.js';
import { $, el, icon, setStatus, showError, srSay } from './dom.js';
import { ago, clock, durationWords, humanBytes, mb, nf, nf1, verdict } from './format.js';
import { markOverflow, mqStart, mqStop } from './marquee.js';
import { ANALYSIS, PHASE_TEXT, isBusy, restartIsQuick, rowAnalysis } from './row-analysis.js';
import { fullName, state, titleOf } from './state.js';

// ---------- biblioteca ----------
// Las filas llegan completas del núcleo (`library()` al abrir y `library-entry-updated` después:
// misma forma, con bytes en disco y clave de orden). La UI solo las reemplaza y ordena.
/** Mientras viaja el `library()` del arranque: claves que ya llegaron por evento (más nuevas que
 *  la foto) o `'*'` si se vació la lista. */
let touchedWhileLoading = null;

export async function loadLibrary() {
  touchedWhileLoading = new Set();
  try {
    const view = await api.library();
    if (!touchedWhileLoading.has('*')) {
      for (const e of [...view.pasted_now, ...view.previous]) if (!touchedWhileLoading.has(e.key)) state.entries.set(e.key, e);
    }
  } finally {
    touchedWhileLoading = null;
  }
  renderLibrary();
}

/** El núcleo mandó una fila nueva o cambiada: reemplaza la anterior. */
export function upsertEntry(row) {
  touchedWhileLoading?.add(row.key);
  state.entries.set(row.key, row);
  renderLibrary();
}

/** El núcleo quitó una fila: fuera de la lista y del caché de filas. */
export function removeEntry(key) {
  touchedWhileLoading?.add(key);
  state.entries.delete(key);
  const hit = rowCache.get(key);
  if (hit) mqStop(hit.node);
  rowCache.delete(key);
  renderLibrary();
}

/** El núcleo vació la lista. */
export function clearEntries() {
  touchedWhileLoading?.add('*');
  state.entries.clear();
  for (const { node } of rowCache.values()) mqStop(node);
  rowCache.clear();
  renderLibrary();
}

/** Orden del núcleo (FR-07): `sort_key` componente por componente y después la clave (igual que `Library::list`). */
function byCoreOrder(a, b) {
  const i = a.sort_key.findIndex((v, j) => v !== b.sort_key[j]);
  if (i >= 0) return a.sort_key[i] - b.sort_key[i];
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}
const groupRows = (group) => [...state.entries.values()].filter((e) => e.group === group).sort(byCoreOrder);

export function renderLibrary() {
  const now = groupRows('pasted-now');
  const prev = groupRows('previous');
  $('#empty').hidden = state.entries.size > 0;
  renderGroup($('#group-now'), now);
  renderGroup($('#group-prev'), prev);
  $('#lib-toolbar').hidden = state.entries.size === 0;
  renderToolbar();
  renderActivity();
}

// ---------- barra de análisis: contadores y botones según lo marcado / lo que corre ----------
export function renderToolbar() {
  const { entries, checked } = state;
  for (const k of [...checked]) if (!entries.has(k)) checked.delete(k);
  const n = checked.size;
  document.body.classList.toggle('selecting', n > 0);
  const all = $('#check-all');
  all.checked = n > 0 && n === entries.size;
  all.indeterminate = n > 0 && n < entries.size;
  const idle = [...checked].filter((k) => !isBusy(entries.get(k).info_hash)).length;
  $('#btn-analyze-selected').disabled = idle === 0;
  $('#btn-analyze-selected').textContent = n ? `Analizar seleccionados (${idle})` : 'Analizar seleccionados';
  const busyN = [...entries.values()].filter((e) => isBusy(e.info_hash)).length;
  const allBtn = $('#btn-analyze');
  allBtn.disabled = entries.size > 0 && busyN === entries.size;
  // Sin "1 de 2": lo que se analiza no tiene por qué ser toda la lista (pedido 2026-11-14).
  allBtn.textContent = allBtn.disabled ? 'Analizando todo…' : 'Analizar todo';
  allBtn.title = allBtn.disabled ? 'Ya se están analizando todos' : 'Analizar todos los magnets (F5)';
  const s = state.analyzerState.kind;
  const running = ['scraping', 'quick-scan', 'measuring'].includes(s);
  const pauseBtn = $('#btn-pause-all');
  pauseBtn.hidden = !(running || s === 'paused');
  pauseBtn.replaceChildren(...(s === 'paused' ? [icon('resume', 13), 'Reanudar todo'] : [icon('pause', 12), 'Pausar todo']));
}

// ---------- pedidos de análisis por fila ----------
/** "Reiniciar análisis" (2026-11-14): desde cero aunque ya esté en cola, pausado o midiéndose
 *  (si se trabó). `quick`: solo la fase rápida; si no, también la medición de velocidad. */
function restartAnalysis(h, quick) {
  state.pending.set(h, quick ? 'quick' : 'speed');
  activity.push({ area: 'analisis', text: `Reiniciaste ${quick ? 'el análisis rápido' : 'la medición de velocidad'} de ${titleOf(h)}` });
  renderLibrary();
  return api.analyzerRestart(h, quick).catch((err) => { state.pending.delete(h); renderLibrary(); showError(err); });
}

/** Marca `hashes` como pedidos y manda el pedido; si falla, vuelve atrás y muestra el error. */
export function requestAnalysis(kind, hashes, scope, note) {
  const fresh = hashes.filter((h) => !isBusy(h));
  if (!fresh.length) return Promise.resolve();
  for (const h of fresh) state.pending.set(h, kind);
  activity.push({ area: 'analisis', text: note });
  renderLibrary();
  return api.analyze(scope).catch((err) => {
    for (const h of fresh) state.pending.delete(h);
    renderLibrary();
    showError(err);
  });
}

// ---------- filas (FR-29b): diseño aprobado design/cards-v3.html, "Fracción y sello" ----------
// Fila de 50 px: título limpio + nombre crudo, peso · duración, idiomas, velocidad real / lo que
// consume el video con el × como sello, acciones de análisis, Ver y el chevron del detalle.
const LIGHT_CLS = { green: 'g', yellow: 'y', red: 'r' };
const TIP = {
  quick: 'Análisis rápido: trae el nombre, la duración, los idiomas de audio, la calidad y los seeds en unos segundos. Se pueden analizar varios a la vez.',
  speed: 'Medir velocidad: baja un pedazo durante unas decenas de segundos para saber la velocidad real y si se va a cortar. Se mide un torrent por vez; con Listo la cortás antes.',
  re: 'Medir de nuevo: vuelve a bajar un pedazo unas decenas de segundos para medir la velocidad real, por si cambiaron los seeds. Un torrent por vez; con Listo la cortás antes.',
  done: 'Listo: corta la medición ahora y se queda con lo que midió hasta acá.',
  pause: 'Pausar el análisis de este sin perder lo medido (los demás siguen).',
  resume: 'Seguir analizando: retoma el análisis de este.',
  watch: 'Ver: elegí el idioma del audio y se abre en mpv.',
  more: 'Mostrar u ocultar el detalle del análisis.',
  seeds: 'Seeds conectados: usuarios con el archivo completo que te están mandando datos ahora.',
  peers: 'Peers conectados: todos los que están conectados con vos ahora, tengan el archivo completo o no.',
  tseed: 'Seeders del tracker: cuántos usuarios con el archivo completo anuncia el tracker en total. No todos se conectan con vos.',
  tleech: 'Leechers del tracker: cuántos lo están bajando según el tracker.',
  when: 'Cuándo se midió la velocidad por última vez.',
  copy: 'Copiar nombre del torrent',
};

/** Filas abiertas / con "Más datos" abierto (sobreviven al redibujo). */
const openRows = new Set();
/** key → { sig, node }: una fila solo se rehace si cambió algo de lo que muestra. */
const rowCache = new Map();

function renderGroup(container, list) {
  container.hidden = list.length === 0;
  const ul = container.querySelector('ul');
  const nodes = list.map(rowNode);
  if (nodes.length !== ul.children.length || nodes.some((n, i) => ul.children[i] !== n)) ul.replaceChildren(...nodes);
  patchLive();
  markOverflow();
}

/** Lo bajado del video: lo que hay en disco (análisis FR-06d o reproducción pausada, el núcleo
 *  da el máximo), lo verificado en vivo mientras se mide, y dónde se pausó la reproducción. */
function downloadInfo(e, liveBytes = 0) {
  const size = e.video_size ?? e.live?.file_size;
  const p = [...state.playbacks.values()].find((r) => r.key === e.key && r.state.kind === 'paused');
  const bytes = Math.max(e.downloaded_bytes ?? 0, liveBytes, p && size ? p.progress * size : 0);
  return size ? { bytes, size, pct: Math.min(100, Math.floor((bytes / size) * 100)), pos: p?.state.position_secs ?? null } : null;
}

/** Reproducción en curso de ese video (no las pausadas ni las fallidas). */
function activePlayback(key) {
  return [...state.playbacks.values()].find((r) => r.key === key && !['paused', 'failed'].includes(r.state.kind)) ?? null;
}
const PB_LOADING = new Set(['fetching-metadata', 'preparing', 'stopping']);
export function pbText(pb) {
  const k = pb.state.kind;
  if (k === 'fetching-metadata') return 'buscando metadatos…';
  if (k === 'preparing') return `preparando ${Math.round((pb.state.fraction ?? 0) * 100)} %`;
  if (k === 'stopping') return 'cerrando…';
  if (k === 'download-paused') return 'reproduciendo · descarga en pausa';
  if (k === 'ask-after-close') return 'cerraste el reproductor…';
  if (k === 'background') return `bajando de fondo · ${Math.floor((pb.progress ?? 0) * 100)} %`;
  return 'reproduciendo';
}

/** Botón con spinner mientras el pedido viaja; se va solo cuando la fila se rehace (o a los 4 s). */
const run = (fn) => (ev) => {
  ev.stopPropagation();
  const b = ev.currentTarget;
  b.classList.add('busy');
  b.setAttribute('aria-busy', 'true');
  const done = () => { b.classList.remove('busy'); b.removeAttribute('aria-busy'); };
  fn().then(() => setTimeout(done, 4000), (err) => { done(); showError(err); });
};

function rowState(e, a) {
  if (a.kind === 'measuring') return 'live';
  if (e.live?.avg_speed_bps > 0) return 'done';
  return e.live ? 'quick' : 'none';
}

function rowNode(e) {
  const a = rowAnalysis(e);
  const pb = activePlayback(e.key);
  const pbSig = pb && [pb.id, pb.state.kind, Math.round((pb.state.fraction ?? 0) * 20)];
  // El × provisorio y la velocidad en vivo los actualiza `patchLive` sin rehacer la fila.
  const sig = JSON.stringify([e, { ...a, live: a.live?.phase, prov: undefined }, downloadInfo(e), pbSig, Math.floor(Date.now() / 60000)]);
  const hit = rowCache.get(e.key);
  let node = hit?.sig === sig ? hit.node : null;
  if (!node) {
    if (hit) mqStop(hit.node);
    node = card(e, a);
    rowCache.set(e.key, { sig, node });
  }
  node.classList.toggle('selected', e.key === state.selected);
  node.querySelector('.row-check').checked = state.checked.has(e.key);
  return node;
}

const tipAttrs = (tip) => ({ 'data-tip': tip });
function ib(iconName, label, tip, onclick, extra = {}) {
  return el('button', { class: 'ib', type: 'button', 'aria-label': label, ...tipAttrs(tip), onclick, ...extra }, icon(iconName, 16));
}

/** Idiomas con color propio en la insignia (ui/styles). El orden viene del núcleo. */
const LANG_CLS = new Set(['lat', 'en', 'cast']);
function langBadges(e) {
  return e.languages.filter((l) => l.code !== '?').map((l) => {
    const tip = l.confirmed
      ? `${l.label}: confirmado, el torrent trae una pista de audio en ${l.label.toLowerCase()}.${l.detail ? ` ${l.detail}` : ''}`
      : `${l.label}: adivinado por el nombre del torrent. Todavía no leímos las pistas de audio reales.`;
    return el('span', { class: `lang ${LANG_CLS.has(l.code) ? l.code : ''} ${l.confirmed ? '' : 'guess'}`, role: 'img', tabindex: '0', 'aria-label': tip, 'data-tip': tip }, l.short);
  });
}

function card(e, a) {
  const h = e.info_hash; // análisis: por torrent
  const k = e.key; // fila, reproducción, quitar: por video
  const kind = ANALYSIS[a.kind];
  const rowSt = rowState(e, a);
  const live = e.live;
  const need = e.score.needed_bps;
  const v = verdict(e.score);
  const phase = rowSt === 'live' ? (a.live?.phase ?? 'connecting') : null;
  const stop = (ev) => ev.stopPropagation();
  const analyze = (ev) => {
    stop(ev);
    requestAnalysis('speed', [h], { kind: 'one', hash: h }, `Pediste medir la velocidad de ${titleOf(h)}`);
  };
  const pb = activePlayback(k);
  const pbLoading = pb && PB_LOADING.has(pb.state.kind);

  // Título limpio + año / episodio; abajo el nombre crudo con copiar.
  const r = e.release;
  const sub = r?.season != null ? `T${r.season}${r.episode != null ? ` · E${r.episode}` : ''}` : r?.year ?? null;
  const raw = fullName(e);
  const copyBtn = rowSt === 'none' ? null : ib('copy', TIP.copy, TIP.copy, (ev) => { stop(ev); copyRaw(ev.currentTarget, raw); }, { class: 'ib cp' });
  const id = el('div', { class: 'id' },
    el('div', { class: 'ttl' }, el('span', { class: 'tn' }, r?.title || raw), sub ? el('span', { class: 'yr' }, String(sub)) : null),
    el('div', { class: 'rw' }, el('div', { class: 'raw' }, el('span', {}, raw)), copyBtn));

  // Peso · duración.
  const size = e.video_size ?? live?.file_size;
  const dur = e.score?.duration;
  let meta = el('div', {});
  if (rowSt !== 'none' && (size || dur)) {
    const [ds, dl] = dur ? durationWords(dur) : [null, null];
    const tip = `${size ? `Pesa ${humanBytes(size)}` : ''}${size && dl ? ' y ' : ''}${dl ? `dura ${dl}${dur.estimated ? ' (estimada por el tamaño)' : ''}` : ''}.`;
    meta = el('div', { class: 'mt', 'data-tip': tip.charAt(0).toUpperCase() + tip.slice(1) },
      size ? humanBytes(size) : '', size && ds ? el('span', { class: 'sep', 'aria-hidden': 'true' }, '·') : null, ds ?? '');
  }

  // Velocidad real / lo que consume el video, con el × como sello.
  let speed;
  const fraction = (val) => el('span', { class: 'fr' }, el('b', {}, val), need ? el('span', { class: 'nd' }, `/ ${mb(need)} `) : null, 'Mbps');
  if (pb) {
    speed = el('span', { class: `ph work${pbLoading ? ' ld' : ''}`, role: 'status', tabindex: '0',
      'data-tip': pbLoading ? 'Preparando la reproducción: baja el principio y el final del video antes de abrir mpv. Con el botón cuadrado la cancelás.' : 'Se está viendo en mpv. Con el botón cuadrado cerrás el reproductor; lo bajado queda guardado.' },
    el('i', { class: pbLoading ? 'spin' : 'pulse', 'aria-hidden': 'true' }), pbText(pb));
  } else if (rowSt === 'live' && !['measuring', 'probing'].includes(phase)) {
    speed = el('span', { class: 'ph work', role: 'status', tabindex: '0', 'data-tip': 'Preparando la medición: arranca el motor, busca los metadatos y precarga el principio del video. Después mide unas decenas de segundos.' },
      el('i', { class: 'spin', 'aria-hidden': 'true' }), `preparando · ${PHASE_TEXT[phase]}`);
  } else if (rowSt === 'live') {
    const now = a.live ?? { speed_bps: 0, secs: 0 };
    const tip = `Midiendo: la velocidad y el × son provisorios hasta que termine.${need ? ` El video consume unos ${mb(need)} Mbps.` : ''} ${v.scale}`;
    speed = el('div', { class: 'u u2', tabindex: '0', role: 'group', 'aria-label': tip, 'data-tip': tip },
      el('span', { class: 'u2-l' },
        fraction(el('span', { 'data-live': 'spd' }, mb(now.speed_bps))),
        el('small', {}, el('i', { class: 'pulse' }), ...(phase === 'probing' ? ['leyendo duración y audios'] : ['midiendo · ', el('span', { 'data-live': 'sec' }, String(Math.round(now.secs))), ' s']))),
      need ? el('span', { class: 'xb prov' }, '≈', el('span', { 'data-live': 'ratio' }, a.prov?.margin != null ? nf1(a.prov.margin) : '–'), '×') : null);
  } else if (rowSt === 'done' && a.kind !== 'prep') {
    const s = e.score;
    const ratio = s.margin;
    const cls = LIGHT_CLS[s.light] ?? 'prov';
    const approx = live.partial ? '≈' : '';
    let tip = `${mb(live.avg_speed_bps)} Mbps reales.`;
    if (ratio != null) {
      const speed = s.speed_factor !== 1
        ? `${mb(s.effective_speed_bps)} Mbps (${mb(live.avg_speed_bps)} medidos, ajustados ×${s.speed_factor.toFixed(2).replace('.', ',')} según tus reproducciones)`
        : `${mb(s.effective_speed_bps)} Mbps reales`;
      tip = `${nf(ratio)}× = ${speed} ÷ ${mb(need)} Mbps que consume el video. ${v.text} ${v.scale}`;
    }
    if (live.partial) tip += ` Medición parcial (${Math.round(live.measured_secs)} s): menos precisa.`;
    speed = el('div', { class: 'u u2', tabindex: '0', role: 'group', 'aria-label': tip, 'data-tip': tip },
      fraction(`${approx}${mb(live.avg_speed_bps)}`),
      ratio != null ? el('span', { class: `xb ${cls}${live.partial ? ' part' : ''}` }, `${approx}${nf(ratio)}×`) : null);
  } else if (kind.busy) {
    speed = el('span', { class: 'ph' }, a.kind === 'queued' ? `en cola #${a.pos}` : kind.text);
  } else if (e.status?.kind === 'failed') {
    speed = el('span', { class: 'ph bad', tabindex: '0', 'data-tip': `Falló el análisis: ${e.status.reason ?? 'sin detalle'}` }, 'falló');
  } else {
    speed = el('span', { class: 'ph' }, rowSt === 'quick' ? 'sin medir' : 'sin analizar');
  }

  // Acciones: Listo + pausa al medir; pausa / seguir en cola; si no, análisis rápido y medir.
  let acts;
  if (rowSt === 'live') {
    acts = [
      ib('check', 'Listo', TIP.done, run(() => api.analyzerFinish())),
      ib('pause', 'Pausar medición', TIP.pause, run(() => api.analyzerPauseOne(h))),
    ];
  } else if (a.kind === 'held') {
    acts = [ib('play', 'Seguir analizando', TIP.resume, run(() => api.analyzerResumeOne(h)), { 'aria-pressed': 'true' })];
  } else if (kind.canPause) {
    acts = [ib('pause', 'Pausar análisis', TIP.pause, run(() => api.analyzerPauseOne(h)))];
  } else {
    acts = [];
    if (rowSt === 'none') {
      acts.push(ib('quick', 'Análisis rápido', TIP.quick, (ev) => {
        stop(ev);
        requestAnalysis('quick', [h], { kind: 'quick', hash: h }, `Pediste el análisis rápido de ${titleOf(h)}`);
      }));
    }
    acts.push(rowSt === 'done'
      ? ib('gauge', 'Medir de nuevo', TIP.re, analyze)
      : ib('gauge', 'Medir velocidad', TIP.speed, analyze));
    // Ya pedido: el botón queda con spinner y deshabilitado (no se puede pedir dos veces).
    if (kind.spin) {
      for (const b of acts) {
        b.disabled = true;
        b.setAttribute('aria-disabled', 'true');
        b.dataset.tip = 'Ya se está analizando';
      }
      const spinning = acts[kind.spin === 'quick' ? 0 : acts.length - 1];
      spinning.classList.add('busy');
      spinning.setAttribute('aria-busy', 'true');
    }
  }
  const bg = pb?.state.kind === 'background';
  if (bg) {
    acts = [ib('pause', 'Pausar descarga', 'Pausar descarga: deja de bajar de fondo; lo bajado queda guardado para retomar.', run(() => api.playbackAction(pb.id, 'stop')))];
  }
  const watch = pb && !bg ? el('button', {
    class: `play stopb${pbLoading ? ' loading' : ''}`, type: 'button', 'aria-label': pbLoading ? 'Cancelar' : 'Detener',
    'data-tip': pbLoading ? `${pbText(pb)[0].toUpperCase()}${pbText(pb).slice(1)}: tocá para cancelar (lo bajado queda guardado).` : 'Detener: cierra mpv; lo bajado queda guardado para retomar.',
    disabled: pb.state.kind === 'stopping',
    onclick: run(() => api.playbackAction(pb.id, 'stop')),
  }, icon('stop', 14)) : rowSt === 'none' ? null : el('button', {
    class: 'play', type: 'button', 'data-watch': '', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': 'Ver', 'data-tip': TIP.watch,
    onclick: (ev) => { stop(ev); play(k, ev.currentTarget); },
  }, icon('play', 15));

  const open = openRows.has(k) && rowSt !== 'none';
  const exp = rowSt === 'none' ? null : el('button', {
    class: 'ib exp', type: 'button', 'aria-expanded': String(open), 'aria-controls': `more-${k}`, 'aria-label': 'Detalles', 'data-tip': TIP.more,
    onclick: (ev) => { stop(ev); toggleRow(ev.currentTarget.closest('.row')); },
  }, icon('chev', 16));

  const cb = el('input', { type: 'checkbox', class: 'row-check', 'aria-label': 'Seleccionar para analizar', 'data-tip': 'Marcar para "Analizar seleccionados"' });
  cb.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (cb.checked) state.checked.add(k); else state.checked.delete(k);
    renderToolbar();
  });

  const row = el('li', {
    class: `row${open ? ' open' : ''}${a.kind === 'held' ? ' paused' : ''}${pbLoading || kind.working ? ' working' : ''}`, 'data-hash': h, 'data-key': k, 'data-state': rowSt,
    onclick: (ev) => onRowClick(ev, e),
    ondblclick: (ev) => { if (!ev.target.closest('button, input, .more')) play(k); },
    oncontextmenu: (ev) => { ev.preventDefault(); select(k); openMenu(ev, e); },
    onpointerenter: (ev) => mqStart(ev.currentTarget),
    onpointerleave: (ev) => { if (!ev.currentTarget.contains(document.activeElement)) mqStop(ev.currentTarget); },
    onfocusin: (ev) => mqStart(ev.currentTarget),
    onfocusout: (ev) => { const r2 = ev.currentTarget; if (!r2.contains(ev.relatedTarget) && !r2.matches(':hover')) mqStop(r2); },
  },
  el('div', { class: 'hd' }, cb, id, meta, el('div', { class: 'lgs' }, ...langBadges(e)), el('div', { class: 'cell-r' }, speed),
    el('div', { class: 'ac' }, ...acts, watch), el('div', { class: 'ex' }, exp)));
  if (rowSt !== 'none') row.append(detail(e, a, rowSt, open));
  return row;
}

/** Detalle desplegable: lo bajado o un resumen + calidad, y debajo el enjambre. */
function restartBtn(e, a) {
  const quick = restartIsQuick(e, a);
  return el('button', {
    class: 'rs', type: 'button',
    'data-tip': `Reiniciar análisis: vuelve a hacer ${quick ? 'el análisis rápido' : 'la medición de velocidad'} desde cero, aunque esté en cola o a mitad de camino. Para cuando se trabó.`,
    onclick: (ev) => { ev.stopPropagation(); restartAnalysis(e.info_hash, quick); },
  }, icon('refresh', 14), 'Reiniciar análisis');
}

function detail(e, a, rowSt, open) {
  const live = e.live;
  const dl = downloadInfo(e, a.live?.downloaded_bytes);
  let top;
  // Midiendo: la línea está siempre, para que `patchLive` haga crecer la barra.
  if (dl && (dl.bytes > 0 || rowSt === 'live')) {
    top = el('span', {}, el('b', { 'data-live': 'pct' }, `${dl.pct} %`), ' bajado',
      el('span', { class: 'bar', role: 'progressbar', 'aria-label': 'Descargado', 'aria-valuenow': String(dl.pct), 'aria-valuemin': '0', 'aria-valuemax': '100' }, el('i', { 'data-live': 'bar', style: `width:${dl.pct}%` })),
      el('span', { 'data-live': 'got' }, gotOf(dl.bytes, dl.size)),
      dl.pos != null ? el('span', { class: 'sep', 'aria-hidden': 'true' }, '·') : null,
      dl.pos != null ? `pausaste en ${clock(dl.pos)}` : null);
  } else {
    const sum = rowSt === 'live' ? 'Midiendo la velocidad ahora: el × es provisorio'
      : rowSt === 'quick' ? `Datos leídos ${ago(live.measured_at)}: falta medir la velocidad`
        : `Medido ${ago(live.measured_at)}${live.partial ? ' (medición parcial)' : ''}`;
    top = el('span', {}, sum);
  }
  const quality = e.release?.quality ?? [];
  const chips = el('span', { class: 'chips' }, ...quality.map((q) => el('span', { class: `chip${/^(4K|\d+p)$/.test(q) ? ' q' : ''}` }, q)));
  const now = rowSt === 'live' ? a.live : null;
  const sw = (k, v, tip, key) => el('span', { class: 'sw', tabindex: '0', 'data-tip': tip }, el('span', { class: 'dim' }, k), el('b', key ? { 'data-live': key } : {}, String(v ?? '–')));
  const xtra = el('div', { class: 'xtra-in' },
    sw('Seeds conectados', now?.seeds ?? live?.seeds, TIP.seeds, 'seeds'),
    sw('Peers conectados', now?.peers ?? live?.peers, TIP.peers, 'peers'),
    sw('Seeders del tracker', e.scrape?.seeders, TIP.tseed),
    sw('Leechers del tracker', e.scrape?.leechers, TIP.tleech),
    dl?.bytes > 0 && live?.avg_speed_bps > 0 ? sw('Medido', ago(live.measured_at), TIP.when) : null);
  const more = el('div', { class: 'more', id: `more-${e.key}` }, el('div', {},
    el('div', { class: 'det' }, el('div', { class: 'top' }, top, chips, restartBtn(e, a)), xtra)));
  more.inert = !open;
  return more;
}

/** "2,8 de 23,4 GB" (la unidad una sola vez si coincide). */
function gotOf(got, total) {
  const g = humanBytes(got);
  const t = humanBytes(total);
  return `${g.slice(-2) === t.slice(-2) ? g.slice(0, -3) : g} de ${t}`;
}

function select(key) {
  state.selected = key;
  document.querySelectorAll('.row.selected').forEach((n) => n.classList.remove('selected'));
  document.querySelector(`.row[data-key="${key}"]`)?.classList.add('selected');
}

function onRowClick(ev, e) {
  select(e.key);
  if (ev.target.closest('button, input, .more') || String(getSelection())) return;
  if (ev.detail > 1) return; // el doble clic reproduce: no abrir y cerrar
  toggleRow(ev.currentTarget);
}

function toggleRow(row) {
  const more = row.querySelector('.more');
  if (!more) return;
  const open = row.classList.toggle('open');
  more.inert = !open;
  row.querySelector('.exp')?.setAttribute('aria-expanded', String(open));
  if (open) openRows.add(row.dataset.key); else openRows.delete(row.dataset.key);
  markOverflow();
}

/** Velocidad en vivo (cada ~2 s) sin rehacer la fila: solo los números. Se mide el torrent:
 *  van a todas sus filas (cada episodio de un pack). */
function patchLive() {
  const s = state.analyzerState;
  if (s.kind !== 'measuring' || !s.current || !s.live) return;
  for (const row of document.querySelectorAll(`.row[data-hash="${s.current}"]`)) {
    const e = state.entries.get(row.dataset.key);
    const prov = s.provisional.find((p) => p.key === row.dataset.key)?.score;
    const set = (k, v) => row.querySelectorAll(`[data-live="${k}"]`).forEach((n) => (n.textContent = v));
    set('spd', mb(s.live.speed_bps));
    set('sec', String(Math.round(s.live.secs)));
    if (prov?.margin != null) set('ratio', nf1(prov.margin));
    set('seeds', String(s.live.seeds));
    set('peers', String(s.live.peers));
    const dl = e && downloadInfo(e, s.live.downloaded_bytes);
    if (dl) {
      set('pct', `${dl.pct} %`);
      set('got', gotOf(dl.bytes, dl.size));
      row.querySelectorAll('[data-live="bar"]').forEach((n) => (n.style.width = `${dl.pct}%`));
      row.querySelector('.bar')?.setAttribute('aria-valuenow', String(dl.pct));
    }
  }
}

async function copyRaw(b, text) {
  try { await navigator.clipboard.writeText(text); } catch { setStatus('No se pudo copiar: seleccioná el nombre y copialo a mano.'); return; }
  b.classList.add('ok');
  b.replaceChildren(icon('check', 16));
  srSay('Copiado');
  clearTimeout(b._t);
  b._t = setTimeout(() => { b.classList.remove('ok'); b.replaceChildren(icon('copy', 16)); }, 1500);
}

// ---------- menú contextual (FR-30) ----------
function openMenu(ev, e) {
  const menu = $('#ctx-menu');
  const item = (label, fn) => el('button', { class: 'ctx-item', onclick: () => { closeMenu(); fn(); } }, label);
  const copy = (text, what) => navigator.clipboard.writeText(text).then(() => setStatus(`${what} copiado.`), showError);
  // Lo que antes estaba en el panel "Reproducciones" (FR-14/15): ahora vive en la fila y acá.
  const pbAll = [...state.playbacks.values()].filter((r) => r.key === e.key);
  const active = pbAll.find((r) => !['paused', 'failed'].includes(r.state.kind));
  const act = (r, action) => () => api.playbackAction(r.id, action).catch(showError);
  const pbItems = [];
  if (active) {
    pbItems.push(item('Detener (lo bajado queda guardado)', act(active, 'stop')));
    if (active.state.kind !== 'background' && active.state.kind !== 'ask-after-close') {
      pbItems.push(active.state.kind === 'download-paused'
        ? item('Reanudar descarga', act(active, 'resume-download'))
        : item('Pausar descarga', act(active, 'pause-download')));
    }
    pbItems.push(item('Ver log de la reproducción', () => openLog(active)));
  }
  if (pbAll[0]) {
    const r = active ?? pbAll[0];
    pbItems.push(item('Abrir carpeta de la descarga', act(r, 'open-folder')));
    pbItems.push(item('Borrar lo descargado…', async () => {
      const ok = await confirmDialog('Borrar descarga', `Se borra lo descargado de "${fullName(e)}" (${Math.round((r.progress ?? 0) * 100)} % bajado). No se puede deshacer.`,
        [{ label: 'Cancelar', value: false }, { label: 'Borrar', value: true, primary: true }]);
      if (ok) act(r, 'stop-and-delete')();
    }));
  }
  menu.replaceChildren(
    item(active ? '▶ Volver a mpv' : pbAll[0] ? '▶ Retomar' : '▶ Reproducir', () => play(e.key)),
    item('Reproducir en VLC', () => api.play(e.key, 'vlc').catch(showError)),
    ...(pbItems.length ? [el('hr'), ...pbItems] : []),
    el('hr'),
    item('Ver análisis', () => showAnalysis(e.key)),
    item(e.live ? 'Re-analizar' : 'Analizar', () => requestAnalysis('speed', [e.info_hash], { kind: 'one', hash: e.info_hash }, `Pediste medir la velocidad de ${titleOf(e.info_hash)}`)),
    item('Reiniciar análisis rápido', () => restartAnalysis(e.info_hash, true)),
    item('Reiniciar medición de velocidad', () => restartAnalysis(e.info_hash, false)),
    el('hr'),
    item('Copiar magnet', () => api.magnet(e.info_hash).then((m) => copy(m, 'Magnet'), showError)),
    item('Copiar nombre', () => copy(fullName(e), 'Nombre')),
    el('hr'),
    item('Quitar de la lista', () => api.remove(e.key).catch(showError)),
  );
  menu.hidden = false;
  const { innerWidth: w, innerHeight: h } = window;
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(ev.clientX, w - r.width - 8)}px`;
  menu.style.top = `${Math.min(ev.clientY, h - r.height - 8)}px`;
}

export function closeMenu() {
  $('#ctx-menu').hidden = true;
}
