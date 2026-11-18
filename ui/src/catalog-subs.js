// Subtítulos de una opción (2026-11-18, docs/mockups/subs-dropdown/ELEGIDA.md): el paso "Subtítulos" del panel de
// Reproducir (`openWizard`). Son de cada torrent: nada se busca antes de que el usuario los pida, al reproducir, con
// clic derecho → Subtítulos… o con "Cambiar subtítulo" mientras se ve (se carga en el mpv abierto).
// 1. "Vienen con el video": los en español que trae ESE archivo (pistas y .srt sueltos). Si todavía no se leyeron,
//    se leen de donde se va a ver ([`readTracks`]): por TorBox, su link; si no, la lectura corta del enjambre (como
//    "Buscar LAT"). Si trae, no se busca afuera: queda "Buscar más subtítulos", a pedido.
// 2. "Encontrados para vos": fuentes gratis, ya ordenadas por el núcleo (exacto → mismo release → mismos fps y
//    duración → resto).
// 3. Premium (OpenSubtitles.com, cuota diaria), plegado, recién después de buscar afuera: buscar es gratis; cada
//    "Usar · 1" baja UNO. Nada se baja solo.
// Clic en una fila = usar ese subtítulo al reproducir esa opción (el anterior cuenta como probado).

import { api } from './api.js';
import { openSettings } from './dialogs.js';
import { el, icon, setStatus } from './dom.js';
import { closeWizard, openWizard } from './audio-picker.js';
import { rowsOf } from './catalog-options.js';
import { quickAnalyze } from './catalog-tests.js';
import { showError, state } from './catalog-state.js';

/** Por opción (info hash) del video abierto: {phase: 'reading'|'searching'|'done', read: lectura de sus pistas
 *  ('reading'|'done'|'failed'|'skipped'), torbox, found: [SubtitleFound] | null,
 *  picks: {chosen, tried} | null, premium: {open, status, results, busy}}. Se vacía al cambiar de video. */
const byHash = new Map();
let forVideo = null;
/** Progreso de la búsqueda por video: {downloading, done, total} (lo emite el núcleo). */
export const subsProgress = new Map();
/** Cuota de Premium (una para la app): {has_key, remaining, per_day, resets_at}. */
let quota = null;
/** El paso abierto: {hash, next (Reproducir: seguir), live (id de la reproducción: cargarlo en mpv)}. */
let active = null;
/** Avisa al panel que redibuje el paso (lo que muestra cambió). */
const changed = () => document.dispatchEvent(new Event('subs-changed'));

/** Lo que tarda como mucho la lectura corta de las pistas por el enjambre (como "Buscar LAT"); se puede cortar. */
const READ_WAIT_MS = 120_000;
/** Lo que se espera a que llegue la fila actualizada después de leerlas por TorBox. */
const ROW_WAIT_MS = 3_000;
const LEVEL = {
  exact: ['perfecto', () => 'Hecho para este mismo archivo'],
  release: ['muy probable', (f) => `Mismo release: grupo ${f.head}${f.spec !== 'sin release' ? ` y ${f.spec}` : ''}`],
  fps: ['probable', () => 'Mismos fps y misma duración que el video'],
};
const VARIANT = { latino: 'Latinoamérica', spain: 'España', unknown: 'Español' };

function subsOf(hash) {
  if (forVideo !== state.side?.videoId) { byHash.clear(); forVideo = state.side?.videoId; }
  return byHash.get(hash) ?? byHash.set(hash, { phase: null, read: null, torbox: false, found: null, picks: null, premium: { open: false, status: 'idle', results: [], busy: null } }).get(hash);
}
/** Los en español que trae esa opción; `null` = todavía no se leyeron sus pistas. */
const natives = (hash) => rowsOf(hash).find((e) => e.native_subs)?.native_subs ?? null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Lee las pistas (audio y subtítulos) de la opción de donde se va a ver, si todavía no se leyeron: `torbox` = su
 *  link de TorBox (el video ya está en sus servidores); si no, la lectura corta del enjambre. Termina siempre: leídas,
 *  falló o se cortó ("No esperar"). Lo usan el paso de audio (TorBox) y el de subtítulos. */
export async function readTracks(hash, torbox) {
  const s = subsOf(hash);
  if (natives(hash) != null || s.read) return;
  s.read = 'reading';
  s.torbox = torbox;
  changed();
  let wait = READ_WAIT_MS;
  if (torbox) {
    try { await api.catalogTorboxTracks(state.side.kind, state.side.videoId, hash); wait = ROW_WAIT_MS; } catch (e) { showError(e); wait = 0; }
  } else quickAnalyze([hash]);
  for (const end = Date.now() + wait; natives(hash) == null && Date.now() < end && s.read === 'reading';) await sleep(250);
  // Sin leer (falló, se pasó el tiempo o "No esperar"): no se reintenta; se sigue buscando afuera.
  s.read = natives(hash) != null ? 'done' : 'failed';
  changed();
}

/** ¿Trae subs en español? (2026-11-18): en la lista de TorBox se leen solas, de a una y en el orden de la lista,
 *  solo hasta encontrar una que sirva (`satisfied`: sub ES y, si se pidió, latino confirmado); tope `AUTO_READ`
 *  por video. El resto queda con el chip "¿Sub ES?". Lo leído queda guardado por torrent. Un fallo (TorBox frenó,
 *  sin mpv) corta las automáticas del video; el chip sigue. */
const AUTO_READ = 5;
let auto = { video: null, busy: false, stopped: false, count: 0 };
export const isReading = (hash) => subsOf(hash).read === 'reading';
export function readUntil(hashes, satisfied) {
  const video = state.side?.videoId;
  if (auto.video !== video) auto = { video, busy: false, stopped: false, count: 0 };
  if (auto.busy || auto.stopped || auto.count >= AUTO_READ || hashes.some(satisfied)) return;
  const next = hashes.find((h) => natives(h) == null && !subsOf(h).read);
  if (!next) return;
  const run = auto;
  run.busy = true;
  run.count++;
  readTracks(next, true).then(() => {
    run.busy = false;
    if (subsOf(next).read === 'failed') run.stopped = true;
    changed();
  });
}
/** El botón de la fila: lee esa opción (también si una lectura anterior falló). */
export function readSubsNow(hash, torbox = true) {
  const s = subsOf(hash);
  if (s.read === 'failed') s.read = null;
  readTracks(hash, torbox);
}
/** Corta la espera de una lectura (el botón de la fila, otro clic): queda como no leída y se puede volver a pedir. */
export function stopReading(hash) {
  const s = subsOf(hash);
  if (s.read === 'reading') s.read = 'skipped';
}

/** Primer paso: nativos de ESE archivo; si trae en español, listo; si no, busca afuera. */
async function prepare(hash, torbox) {
  const s = subsOf(hash);
  if (s.phase) return;
  s.phase = 'reading';
  await readTracks(hash, torbox);
  if (natives(hash)?.length) { s.phase = 'done'; changed(); return; }
  await search(hash);
}

/** Busca en las fuentes gratis para esa opción (su release ordena). */
async function search(hash) {
  const s = subsOf(hash);
  const video = state.side?.videoId;
  s.phase = 'searching';
  changed();
  try {
    const got = await api.catalogSubtitles(video, hash, 'es');
    if (state.side?.videoId !== video) return;
    s.found = got.found;
    s.picks = got.picks;
    s.timing = got.timing_known;
  } catch (e) { s.found = []; showError(e); }
  s.phase = 'done';
  changed();
}

/** Usar ese subtítulo: al reproducir esta opción (y, si Reproducir lo esperaba, sigue) o, mientras se ve, ya en el
 *  mpv abierto. `path`: el archivo bajado (no hace falta para una pista del video). */
async function useSub(hash, key, path = null) {
  const s = subsOf(hash);
  const step = active;
  try {
    if (step?.live) {
      await api.playbackSubtitle(step.live, key, path);
      s.picks = { chosen: key, tried: [...(s.picks?.tried ?? []), s.picks?.chosen].filter((k) => k && k !== key) };
      setStatus('Subtítulo cambiado en el reproductor.');
      return closeWizard();
    }
    s.picks = await api.catalogSubtitleUse(state.side.videoId, hash, key);
    setStatus('Listo: se usa ese subtítulo al reproducir.');
    if (step?.next) return step.next(true);
  } catch (e) { showError(e); }
  changed();
}

async function loadQuota() {
  quota = await api.premiumQuota().catch(() => quota);
  changed();
}

async function premiumSearch(hash) {
  const p = subsOf(hash).premium;
  p.status = 'loading';
  changed();
  try {
    p.results = await api.catalogPremiumSearch(state.side.videoId, hash);
    p.status = p.results.length ? 'ready' : 'empty';
  } catch { p.status = 'error'; }
  changed();
}

/** "Usar · 1": baja ese (gasta 1) y queda elegido. */
async function premiumUse(hash, r) {
  const s = subsOf(hash);
  if (s.premium.busy) return;
  s.premium.busy = r.key;
  changed();
  try {
    const got = await api.catalogPremiumUse(state.side.videoId, hash, { id: Number(r.key.split(':')[1]), release_name: r.release_name, latino: r.latino, level: r.level });
    s.found = got.found;
    s.picks = got.picks;
    s.timing = got.timing_known;
    setStatus('Bajado: se usa ese subtítulo al reproducir.');
    s.premium.busy = null;
    loadQuota();
    const step = active;
    if (step?.live) return useSub(hash, r.key, got.found.find((f) => f.key === r.key)?.path ?? null);
    if (step?.next) return step.next(true);
    return;
  } catch (e) { showError(e); }
  s.premium.busy = null;
  loadQuota();
}

/** Copia uno ya bajado a Descargas (`<título> (subtítulos)`) y abre la carpeta. */
async function saveSub(f) {
  const [, s, e] = (state.side.videoId ?? '').split(':');
  const title = `${state.side.name ?? 'Video'}${s ? ` S${s.padStart(2, '0')}E${e.padStart(2, '0')}` : ''}`;
  try {
    await api.saveSubtitles(title, [{ path: f.path, name: `${f.language.toUpperCase()} - ${f.release_name}` }]);
    setStatus('Subtítulo guardado en Descargas.');
  } catch (err) { showError(err); }
}

/** El paso "Subtítulos" de una opción para el panel de Reproducir: `render(next)`. `torbox`: se ve por TorBox (las
 *  pistas se leen de ahí); `live`: id de la reproducción en curso (lo elegido se carga en su mpv). */
export function subsStep(hash, torbox, live = null) {
  return (next) => {
    active = { hash, next: live ? null : next, live };
    if (!quota) loadQuota();
    prepare(hash, torbox);
    return subsBody(hash, !!next && !live);
  };
}

/** Clic derecho → Subtítulos… (sin reproducir) o "Cambiar subtítulo" mientras se ve (`live`): el mismo panel, solo
 *  con este paso. */
export function openSubs(hash, torbox, anchor, live = null) {
  const s = subsStep(hash, torbox, live);
  openWizard(anchor, [{ id: 'subs', title: live ? 'Cambiar subtítulo' : 'Subtítulos', render: () => s(null) }]).then(() => { active = null; });
}

function quotaText() {
  if (!quota) return 'viendo cuántas descargas quedan…';
  if (quota.remaining == null) return 'no sé cuántas descargas quedan hoy';
  if (quota.remaining === 0) return `usaste las ${quota.per_day} de hoy${quota.resets_at ? ` · vuelven ${quota.resets_at}` : ''}`;
  return `quedan ${quota.remaining} de ${quota.per_day} descargas hoy`;
}

/** Una fila: clic = usar (`key` null = solo se usa con su botón). `end`: lo de la derecha. */
function subItem({ id, key, head, spec, latino, src, title, end, onPick }, picks) {
  const on = key && picks?.chosen === key;
  const tried = key && !on && picks?.tried.includes(key);
  return el('div', { class: `cat-sub-item ${on ? 'on' : ''} ${tried ? 'tried' : ''}`, title: tried ? 'Probado · no sincronizó' : '' },
    el('button', { id, type: 'button', class: 'cat-sub-pick', role: 'menuitemradio', 'aria-checked': String(!!on), 'aria-label': `${head} ${spec}`, title,
      onclick: onPick, disabled: onPick ? null : true }),
    el('span', { class: 'cat-sub-mark' }, on ? icon('check', 14) : null),
    el('span', { class: 'cat-sub-l1' }, el('b', {}, head), el('span', { class: 'cat-sub-spec' }, spec),
      latino ? el('span', { class: 'cat-sub-lat' }, 'LAT') : null, tried ? el('span', { class: 'cat-sub-why' }, 'probado') : null,
      src ? el('span', { class: 'cat-sub-src' }, `· ${src}`) : null),
    el('span', { class: 'cat-sub-end' }, ...end));
}

/** Palabra de cuánto calza (perfecto / muy probable / probable), con el porqué en el tooltip; nada si no calza. */
function fitWord(f) {
  const lvl = LEVEL[f.level];
  return lvl ? el('span', { class: `cat-sub-fit ${f.level}`, title: lvl[1](f), 'aria-label': `${lvl[0]}: ${lvl[1](f)}` }, lvl[0]) : null;
}
/** Si ninguno calza, por qué (sin inventar niveles): otro release, o no se saben los fps y la duración del archivo. */
function noFitLine(list, timing) {
  if (!list.length || list.some((f) => LEVEL[f.level])) return null;
  return el('div', { class: 'cat-sub-none' }, timing ? 'Ninguno es de este release ni de sus mismos fps y duración'
    : 'Sin fps ni duración de este archivo: solo se reconoce el mismo release');
}

function foundItem(hash, f, i, picks) {
  return subItem({ id: `cat-sub-pick-${i}`, key: f.key, head: f.head, spec: f.language === 'en' ? `${f.spec} · EN` : f.spec, latino: f.latino, src: f.provider, title: f.release_name,
    onPick: () => useSub(hash, f.key, f.path), end: [
      fitWord(f),
      el('button', { id: `cat-sub-dl-${i}`, type: 'button', class: 'cat-sub-dl', 'aria-label': 'Bajar a la Mac', title: 'Bajar a la Mac', onclick: () => saveSub(f) }, icon('download', 14)),
    ] }, picks);
}

const msg = (ico, text, btn, err = false) => el('div', { class: `cat-sub-msg ${err ? 'err' : ''}` }, ico, el('span', {}, text), btn);
const spin = () => el('span', { class: 'cat-seeds-spin', 'aria-hidden': 'true' });

function premiumBody(hash, p, timing) {
  if (!quota?.has_key) {
    return msg(icon('lock', 14), 'Necesita tu API key de opensubtitles.com.', el('button', { id: 'cat-prem-key', type: 'button', class: 'cat-sub-btn',
      onclick: async () => { closeWizard(); await openSettings(); document.getElementById('set-subs')?.scrollIntoView({ block: 'center' }); } }, 'Ajustes'));
  }
  if (p.status === 'loading' || p.status === 'idle') return msg(spin(), 'Buscando en opensubtitles.com…');
  if (p.status === 'error') {
    return msg(icon('info', 14), 'opensubtitles.com no respondió. No se gastó ninguna descarga.',
      el('button', { id: 'cat-prem-retry', type: 'button', class: 'cat-sub-btn', onclick: () => premiumSearch(hash) }, icon('refresh', 12), 'Reintentar'), true);
  }
  if (p.status === 'empty') {
    const [, s, e] = state.side.videoId.split(':');
    return msg(icon('info', 14), `Tampoco hay en español para ${s ? `S${s.padStart(2, '0')}E${e.padStart(2, '0')}` : 'esta película'}. No se gastó ninguna descarga.`);
  }
  const off = quota.remaining === 0;
  return [...p.results.map((r, i) => subItem({ id: `cat-prem-pick-${i}`, key: null, head: r.head, spec: r.spec, latino: r.latino, src: `${r.downloads.toLocaleString('es-AR')} ↓`, title: r.release_name,
    end: [fitWord(r), p.busy === r.key ? el('span', { class: 'cat-sub-btn' }, spin(), 'Bajando')
      : el('button', { id: `cat-prem-use-${i}`, type: 'button', class: 'cat-sub-btn', 'aria-disabled': off ? 'true' : null, title: off ? 'Sin descargas por hoy' : 'Gasta 1 descarga de hoy',
        onclick: () => !off && premiumUse(hash, r) }, 'Usar ', el('span', { class: 'cat-sub-cost' }, '· 1'))] }, null)), noFitLine(p.results, timing)];
}

function premiumGate(hash, s) {
  const p = s.premium;
  const tried = s.picks?.tried.length ?? 0;
  const hot = tried >= 2 && quota?.has_key;
  const sub = quota && !quota.has_key ? 'Necesita tu API key de opensubtitles.com'
    : hot ? `Probaste ${tried} y no sincronizaron · ${quotaText()}` : `Último recurso · ${quotaText()}`;
  return [el('div', { class: 'cat-sub-sep' }),
    el('button', { id: 'cat-prem-gate', type: 'button', class: `cat-sub-gate ${hot ? 'hot' : ''}`, 'aria-expanded': String(p.open), onclick: () => {
      p.open = !p.open;
      // Buscar es gratis: corre solo al abrir.
      if (p.open && quota?.has_key && p.status === 'idle') premiumSearch(hash);
      changed();
    } },
    el('span', { class: 'cat-sub-gi' }, icon('lock', 15)),
    el('span', {}, el('b', {}, hot ? '¿Ninguno anduvo? Buscá en Premium' : 'Buscar en Premium'), el('span', { class: 'cat-sub-gs' }, sub)),
    el('span', { class: 'cat-sub-chev' }, icon('chev', 13))),
    p.open ? el('div', { class: 'cat-sub-open' }, premiumBody(hash, p, s.timing)) : null];
}

/** Lo que muestra el paso: los tres grupos. `playing`: dentro de Reproducir (suma "Reproducir sin elegir"). */
function subsBody(hash, playing) {
  const s = subsOf(hash);
  const nat = natives(hash);
  const grp = (t) => el('div', { class: 'cat-sub-grp' }, t);
  const out = [grp('Vienen con el video')];
  if (s.read === 'reading') {
    out.push(s.torbox ? msg(spin(), 'Leyendo sus pistas en TorBox…')
      : msg(spin(), 'Viendo si el video trae subtítulos… (baja solo el comienzo)',
        el('button', { id: 'cat-subs-noread', type: 'button', class: 'cat-sub-btn', onclick: () => { s.read = 'skipped'; } }, 'No esperar')));
  } else if (nat?.length) {
    out.push(...nat.map((n, i) => subItem({ id: `cat-sub-native-${i}`, key: n.key, head: VARIANT[n.variant], spec: n.kind, src: n.place, title: '',
      onPick: () => useSub(hash, n.key), end: [] }, s.picks)));
  } else out.push(el('div', { class: 'cat-sub-none' }, nat ? 'Este video no trae en español' : 'Sin confirmar: no se pudieron leer sus pistas'));
  if (s.phase === 'searching') {
    const p = subsProgress.get(state.side.videoId);
    out.push(grp('Encontrados para vos'), msg(spin(), p?.downloading ? `Bajando subtítulos · ${p.done} de ${p.total}` : 'Buscando en Wyzie, Subdivx y OpenSubtitles.org…'));
  } else if (s.found) {
    out.push(grp('Encontrados para vos'), ...(s.found.length ? s.found.map((f, i) => foundItem(hash, f, i, s.picks))
      : [el('div', { class: 'cat-sub-none' }, 'No encontré en Wyzie, Subdivx ni OpenSubtitles.org')]), noFitLine(s.found, s.timing));
    out.push(...premiumGate(hash, s));
  } else if (s.phase === 'done') {
    out.push(el('button', { id: 'cat-subs-more', type: 'button', class: 'cat-sub-more', onclick: () => search(hash) }, icon('search', 14),
      el('span', {}, el('b', {}, 'Buscar más subtítulos'), el('span', {}, 'Por si los del video no te sirven'))));
  }
  if (playing) {
    out.push(el('div', { class: 'cat-sub-foot' },
      el('button', { id: 'cat-subs-skip', type: 'button', class: 'cat-sub-btn', onclick: () => active?.next?.(true) }, 'Reproducir sin elegir')));
  }
  return el('div', { class: 'cat-subs-menu', role: 'menu', id: 'cat-subs-menu', 'aria-label': 'Subtítulos' }, ...out);
}
