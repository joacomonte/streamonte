// Catálogo (F4b, spec 09 §11): Buscar / Explorar → al tocar una película o serie se abre un panel
// a la derecha (pedido 2026-11-15). Película: sus opciones. Serie: Serie › Temporada › Episodio ›
// opciones, como migas de pan. Cada opción: análisis profundo, cargar en background o Reproducir.
// Todo texto que viene de Cinemeta o de los addons entra como texto, nunca como HTML (NFR-24).

import { api, onCoreEvent } from './api.js';
import { play } from './audio-picker.js';
import { $, el, icon, setStatus, showError as reportError } from './dom.js';
import { humanBytes, mbps, nf1, playbackText } from './format.js';
import { healthCalibration, speedOf, trackPlayback } from './health-calib.js';
import { state as lib } from './state.js';

/** Errores del catálogo: solo en la barra de estado (no en la burbuja) y sin los "Cancelado." de
 *  pedidos pisados por otro más nuevo. */
const showError = (e) => reportError(e, { activity: false, ignoreCancelled: true });

/** Tooltips del badge HDR (pedido 2026-11-15, en blanco y negro): HDR y Dolby Vision se muestran igual;
 *  el tooltip dice cuál es. */
const HDR_TIP = {
  HDR: 'HDR: más rango de brillo y color. Se aprovecha con pantalla HDR; en una común se ve igual o un poco más apagado.',
  DV: 'Dolby Vision: HDR dinámico de Dolby. En pantallas sin Dolby Vision puede verse con colores raros (verde/violeta).',
};
/** Audio (pedido 2026-11-15): solo el latino, con badge LAT; los demás idiomas no se muestran. Lo que dice
 *  la fuente va en gris hasta que el análisis rápido lo confirma con las pistas reales. */
function latBadge(c, badge) {
  if (!c.audio.includes('lat')) return null;
  const confirmed = rowsOf(c.info_hash).some((e) => e.live?.audio?.length);
  const note = confirmed ? '' : ' · según la fuente, sin confirmar (se confirma al analizarlo)';
  // Sin confirmar = gris (lo dice la fuente); confirmado por el análisis = color de latino.
  return badge('LAT', confirmed ? 'focus lat' : 'guess', `Audio en Latino${note}`);
}

// ---------- estado ----------
/** localStorage puede fallar (vista previa, almacenamiento bloqueado): nunca rompe la UI. */
const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
const state = {
  results: null,          // {movies, series}
  searching: false,       // tipeando / esperando la búsqueda: cards de carga
  excluded: new Set(),    // ids anime/japonés (FR-40)
  hideJapanese: true,
  // Panel lateral: lo que se eligió. Serie: `meta` (episodios) → `season` → `episode`/`videoId`.
  side: null,             // {kind, id, name, meta, season, episode, videoId}
  update: null,           // último StreamsUpdate del video del panel
  library: new Map(),     // clave de video → fila de la biblioteca del núcleo
};
let searchSeq = 0;
/** El último panel pedido gana: abrir otro o cerrarlo invalida la ficha pendiente. */
let sideSeq = 0;
let searchTimer = null;

// ---------- búsqueda (FR-36) ----------
function onQueryInput() {
  clearTimeout(searchTimer);
  const q = $('#cat-q').value.trim();
  if (q.length < 2) { state.results = null; state.searching = false; render(); return; }
  if (!state.searching) { state.searching = true; render(); }
  searchTimer = setTimeout(() => search(q), 300);
}

async function search(q) {
  const seq = ++searchSeq;
  setStatus(`Buscando "${q}"…`);
  try {
    const r = await api.catalogSearch(q);
    if (seq !== searchSeq) return;
    state.searching = false;
    state.results = r;
    setStatus(r.movies.length + r.series.length ? 'Elegí una película o serie.' : `No encontré "${q}". Probá con el título en inglés.`);
    render();
  } catch (e) {
    if (seq === searchSeq) { state.searching = false; render(); showError(e); }
  }
}

/** Cards ya armadas, por título: re-renderizar no recrea los <img> (no recargan ni parpadean).
 *  Las nuevas entran con un fade escalonado (`i` = posición en la grilla). */
const cards = new Map();
function cardFor(p, i) {
  const key = `${p.id}|${browse.from ? 'd' : 'y'}`; // la línea de fecha cambia con el rango
  let card = cards.get(key);
  if (!card) {
    if (cards.size > 600) cards.clear(); // shortcut: tope simple, alcanza para varias páginas
    card = posterCard(p);
    card.classList.add('enter');
    card.style.animationDelay = `${Math.min(i % PAGE, 12) * 25}ms`;
    card.addEventListener('animationend', () => { card.classList.remove('enter'); card.style.animationDelay = ''; }, { once: true });
    cards.set(key, card);
  }
  card.classList.toggle('active', state.side?.id === p.id);
  return card;
}

function posterCard(p) {
  // Sin póster (Cinemeta no tiene imagen para muchos títulos nuevos): uno dibujado con el título.
  const hue = [...p.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const noPoster = () => el('div', { class: 'cat-noposter', style: `--hue:${hue}` },
    el('span', { class: 'cat-noposter-title' }, p.name), p.year ? el('span', { class: 'cat-noposter-year' }, p.year) : null);
  // Cinemeta a veces da una URL de póster que no existe: se muestra la inicial, no un ícono roto.
  // Póster roto → TMDB (si hay key en Ajustes) → uno dibujado.
  const fallback = async (ev) => {
    const img = ev.target;
    img.onerror = () => img.replaceWith(noPoster());
    const url = await api.catalogPoster(p.id).catch(() => null);
    if (url) img.src = url;
    else img.replaceWith(noPoster());
  };
  const img = p.poster
    ? el('img', { src: p.poster, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: fallback })
    : noPoster();
  return el('button', {
    class: `cat-card ${state.side?.id === p.id ? 'active' : ''}`, title: p.name, 'data-id': p.id,
    onclick: () => openSide(p.kind, p.id, p.name),
  },
  img, el('span', { class: 'cat-card-name' }, p.name), el('span', { class: 'cat-card-year' }, [browse.from && p.released ? p.released.split('-').reverse().join('/') : p.year, p.imdb_rating && `★ ${p.imdb_rating}`].filter(Boolean).join(' · ')));
}

/** Resultados de la búsqueda (2026-11-15): películas y series juntas. La búsqueda de Cinemeta no
 *  trae popularidad, solo su orden por tipo (que ya es por popularidad): se intercalan por ese
 *  puesto y, en el mismo puesto, primero el título que empieza con lo escrito. */
function renderResults(root) {
  const q = $('#cat-q').value.trim().toLowerCase();
  const rank = (p, i) => i - (p.name.toLowerCase().startsWith(q) ? 0.5 : 0);
  const list = [...state.results.movies.map((p, i) => [rank(p, i), p]), ...state.results.series.map((p, i) => [rank(p, i), p])]
    .sort((a, b) => a[0] - b[0])
    .map(([, p]) => p)
    .filter((p) => !(state.hideJapanese && state.excluded.has(p.id)));
  root.append(list.length
    ? el('div', { class: 'cat-grid' }, list.map(cardFor))
    : el('p', { class: 'hint' }, 'Sin resultados para esa búsqueda.'));
}

/** Cards de carga mientras se tipea (2026-11-15). */
function skeletonGrid() {
  return el('div', { class: 'cat-grid', 'aria-busy': 'true', 'aria-label': 'Buscando…' },
    Array.from({ length: 12 }, () => el('div', { class: 'cat-card skeleton' }, el('span', { class: 'skel poster' }), el('span', { class: 'skel line' }), el('span', { class: 'skel line short' }))));
}

// ---------- panel lateral (pedido 2026-11-15) ----------
async function openSide(kind, id, name) {
  const seq = ++sideSeq;
  counting.clear();
  api.catalogStopStreams().catch(() => {});
  state.side = { kind, id, name, meta: null, season: null, episode: null, videoId: null };
  state.update = null;
  markActiveCard();
  // Película: no hace falta la ficha (el título ya se eligió); se piden las opciones directo.
  // De fondo, la ficha: cabecera (póster, año, puntaje) y duración para el aviso de "Pesado".
  if (kind === 'movie') {
    loadStreams(id);
    api.catalogMeta(kind, id).then((m) => {
      if (seq !== sideSeq) return;
      state.side.meta = m;
      state.side.runtime = m.runtime_min;
      renderSide();
    }).catch(() => {});
    return;
  }
  renderSide();
  setStatus('Abriendo la serie…');
  try {
    const meta = await api.catalogMeta(kind, id);
    if (seq !== sideSeq) return;
    state.side.meta = meta;
    state.side.runtime = meta.runtime_min;
    setStatus('Elegí temporada y episodio.');
    renderSide();
  } catch (e) { if (seq === sideSeq) showError(e); }
}

function closeSide() {
  counting.clear();
  sideSeq++;
  api.catalogStopStreams().catch(() => {});
  state.side = null;
  state.update = null;
  markActiveCard();
  renderSide();
}

/** Volver a un paso de la serie (miga de pan): `null` = elegir temporada; número = elegir episodio. */
function goSeason(season) {
  counting.clear();
  api.catalogStopStreams().catch(() => {});
  Object.assign(state.side, { season, episode: null, videoId: null });
  state.update = null;
  renderSide();
}

function markActiveCard() {
  document.querySelectorAll('.cat-card').forEach((c) => c.classList.toggle('active', c.dataset.id === state.side?.id));
}

function crumbs(s) {
  if (s.kind === 'movie') return el('span', { class: 'crumbs' });
  // Serie › Temporada › Episodio como píldoras: las anteriores llevan de vuelta a ese paso.
  const steps = [{ label: s.name, back: s.season != null ? () => goSeason(null) : null, cls: 'root' }];
  if (s.season != null) steps.push({ label: s.season === 0 ? 'Especiales' : `Temporada ${s.season}`, back: s.episode != null ? () => goSeason(s.season) : null });
  if (s.episode != null) steps.push({ label: `Episodio ${s.episode}` });
  const up = steps.at(-2)?.back;
  return el('nav', { class: 'crumbs', 'aria-label': 'Serie' },
    up ? el('button', { id: 'cat-crumb-up', class: 'crumb-up', title: 'Volver', 'aria-label': 'Volver', onclick: up }, '←') : null,
    el('ol', { class: 'crumb-path' }, steps.map((st, i) => el('li', {},
      st.back
        ? el('button', { id: `cat-crumb-${i}`, class: `crumb ${st.cls ?? ''}`, title: st.label, onclick: st.back }, st.label)
        : el('span', { class: `crumb current ${st.cls ?? ''}`, 'aria-current': 'page', title: st.label }, st.label)))));
}

function renderSide() {
  const aside = $('#cat-side');
  const s = state.side;
  $('#catalog').classList.toggle('side-open', !!s);
  if (!s) { aside.replaceChildren(); return; }
  aside.replaceChildren(
    el('button', { id: 'cat-side-close', class: 'side-close', title: 'Cerrar (Esc)', 'aria-label': 'Cerrar panel', onclick: closeSide }, '✕'),
    ...(s.meta ? [hero(s.meta)] : []), // replaceChildren escribiría "null"
    el('div', { class: 'side-head' }, crumbs(s)),
    el('div', { id: 'cat-side-body', class: 'side-body' }, sideBody(s)));
  renderStreamsOnly();
}

/** Cabecera de la serie o película: fondo, póster y datos. */
function hero(m) {
  const facts = [m.year, m.imdb_rating && `★ ${m.imdb_rating}`, m.genres.slice(0, 3).join(' · ')].filter(Boolean).join('  ·  ');
  return el('div', { class: 'side-hero' },
    m.background ? el('div', { class: 'side-hero-bg', style: `background-image:url("${encodeURI(m.background)}")` }) : null,
    m.poster ? el('img', { class: 'side-hero-poster', src: m.poster, alt: '', referrerpolicy: 'no-referrer', onerror: (ev) => ev.target.remove() }) : null,
    el('div', { class: 'side-hero-text' }, el('h2', {}, m.name), facts ? el('p', {}, facts) : null));
}

const shortDate = (iso) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function sideBody(s) {
  if (s.videoId) return el('div', { id: 'cat-streams' });
  if (!s.meta) return el('div', { class: 'side-skeleton' }, Array.from({ length: 5 }, () => el('span', { class: 'skel' })));
  const eps = s.meta.episodes;
  if (s.season == null) {
    // Temporadas: tarjetas sin imagen (las de episodios pueden spoilear, pedido 2026-11-15).
    const seasons = [...new Set(eps.map((e) => e.season))].sort((a, b) => (a || 999) - (b || 999));
    return el('div', { class: 'season-grid' }, seasons.map((n) => {
      const list = eps.filter((e) => e.season === n);
      const years = [...new Set(list.map((e) => e.released?.slice(0, 4)).filter(Boolean))];
      return el('button', { class: 'season-tile', id: `cat-season-${n}`, onclick: () => goSeason(n) },
        el('span', { class: 'season-tile-num' }, n === 0 ? '★' : String(n)),
        el('span', { class: 'season-tile-text' },
          el('b', {}, n === 0 ? 'Especiales' : `Temporada ${n}`),
          el('span', {}, [`${list.length} episodios`, years.length && (years.length > 1 ? `${years[0]}–${years.at(-1)}` : years[0])].filter(Boolean).join(' · '))));
    }));
  }
  // Episodios: número, título, fecha y sinopsis (sin miniatura: puede spoilear).
  return el('ul', { class: 'ep-list' }, eps.filter((e) => e.season === s.season).map((e) => el('li', {},
    el('button', {
      class: 'ep-item', id: `cat-ep-${e.season}-${e.episode}`, disabled: !e.available,
      onclick: () => { s.episode = e.episode; loadStreams(e.id); },
    },
    el('span', { class: 'ep-num' }, e.episode),
    el('span', { class: 'ep-text' },
      el('b', {}, e.title || `Episodio ${e.episode}`),
      el('span', { class: 'ep-date' }, e.available ? shortDate(e.released) : `Se estrena ${shortDate(e.released) || 'pronto'}`),
      e.overview ? el('span', { class: 'ep-overview', title: e.overview }, e.overview) : null,
    )))));
}

// ---------- opciones (FR-42–49) ----------
async function loadStreams(videoId) {
  counting.clear();
  state.side.videoId = videoId;
  // Asistente (2026-11-15): resolución → análisis → subtítulos → carga → lista.
  state.side.flow = { step: 'res', res: null, mode: null, subs: null, deep: null };
  state.update = null;
  renderSide();
  setStatus('Pidiendo torrents a todas las fuentes…');
  try {
    await api.catalogStreams(state.side.kind, videoId);
  } catch (e) { showError(e); }
}

function onStreams(update) {
  if (update.video_id !== state.side?.videoId) return;
  state.update = update;
  if (update.done) startAnalysisWhenReady();
  const ok = update.addons.filter((a) => a.state !== 'pending').length;
  setStatus(update.done
    ? `${update.candidates.length} opción(es) de ${ok} fuente(s). Analizá o reproducí una.`
    : `${ok} de ${update.addons.length} fuentes respondieron…`);
  renderStreamsOnly();
}

/** Filas de la biblioteca de ese torrent (una por episodio de un pack; el análisis es del torrent). */
function rowsOf(hash) {
  if (libByHash) return libByHash.get(hash) ?? [];
  return [...state.library.values()].filter((e) => e.info_hash === hash);
}
/** Durante un redibujo de la lista (`renderStreamsOnly`): la biblioteca indexada por info_hash y la
 *  calibración de la salud, armadas una vez y no por fila (con 200+ opciones se notaba). Fuera, null. */
let libByHash = null;
let renderCal = null;

function lightOf(c) {
  const e = rowsOf(c.info_hash)[0];
  if (!e) return { cls: 'none', text: '' };
  if (e.status?.kind === 'measuring') return { cls: 'measuring', text: 'midiendo…' };
  if (e.status?.kind === 'scraping') return { cls: 'measuring', text: 'analizando…' };
  if (e.status?.kind === 'failed') return { cls: 'red', text: 'falló' };
  const light = e.score?.light ?? 'unknown';
  const speed = e.live?.avg_speed_bps;
  return { cls: light, text: speed ? `${mbps(speed)}${e.score?.margin ? ` · ${nf1(e.score.margin)}×` : ''}` : '' };
}

/** Seeders sin análisis profundo: los de los trackers (chequeados recién, al cargar las opciones)
 *  mandan; un 0 de tracker con la fuente diciendo más suele ser un tracker que no conoce el torrent,
 *  y ahí vale la fuente. */
const trackersWin = (c) => c.seeders > 0 || (c.seeders === 0 && !(c.seeders_declared > 0));
function seedsOf(c) {
  return trackersWin(c) ? c.seeders : c.seeders_declared ?? null;
}

/** Orden de las opciones: analizadas primero, después por seeders, leechers y peso. */
const bySeeds = (a, b) => tierOf(b) - tierOf(a) || (knownSeeds(b) ?? -1) - (knownSeeds(a) ?? -1) || (leechersOf(b) ?? -1) - (leechersOf(a) ?? -1) || (b.size_bytes ?? 0) - (a.size_bytes ?? 0);

/** Grupo para ordenar (2026-11-15): 2 = analizado a fondo (va siempre arriba), 1 = el resto
 *  (trackers, fuente o una medición vieja de la biblioteca), 0 = nadie respondió al analizarlo. */
function tierOf(c) {
  const n = counted.get(c.info_hash);
  return !n ? 1 : n.reached === false ? 0 : 2;
}
/** Seeders que se saben de una opción, de lo más confiable a lo menos: contados al analizar
 *  (aunque sea 0), medidos al reproducir o cargar, según los trackers y, por último, la fuente. */
function knownSeeds(c) {
  return counted.get(c.info_hash)?.seeds ?? rowsOf(c.info_hash).find((e) => e.live)?.live.seeds
    ?? seedsOf(c);
}
/** Leechers (desempate): conectados sin el archivo completo al contar, o los del scrape automático. */
function leechersOf(c) {
  const n = counted.get(c.info_hash) ?? rowsOf(c.info_hash).find((e) => e.live)?.live;
  if (n?.reached === false) return null; // nadie respondió: esos peers solo los conoce la DHT
  return n ? Math.max(0, n.peers - n.seeds) : c.leechers ?? null;
}

let onlyHdr = safeGet('tstream.catalog.onlyHdr') === '1';
function setOnlyHdr(v) { onlyHdr = v; safeSet('tstream.catalog.onlyHdr', v ? '1' : '0'); }
/** Lo que entra en un análisis: esa resolución (o todas, sin `res`) y, si se pidió, solo HDR. */
const inScope = (c, res) => (!res || resKey(c) === res) && (!onlyHdr || c.hdr.length);

/** Arriba de la lista (2026-11-15): contar seeders, subtítulos del video y el filtro HDR.
 *  La lista se ordena siempre por seeders. */
function optionsHead() {
  // Se pueden sumar tandas mientras otras cuentan; arriba se ve cuántas están en curso.
  const analyzing = state.update?.candidates.filter((c) => counting.has(c.info_hash)).length ?? 0;
  const deepRunning = state.side?.flow?.deep === 'run';
  // "Analizar ▾" (2026-11-15): (re)analiza todas las del grupo abierto con la profundidad elegida.
  const res = openRes || state.side?.flow?.res || null;
  const scope = (state.update?.candidates ?? []).filter((c) => inScope(c, res)).map((c) => c.info_hash);
  return el('div', { class: 'cat-opt-head' },
    deepRunning ? null : el('button', {
      id: 'cat-analyze-all', class: 'cat-count-all', onclick: () => reanalyze(scope, res),
      title: `Análisis profundo de las ${scope.length} opciones${res ? ` de ${resLabel(res)}` : ''}: se conecta a las ${TOP} mejores y cuenta los seeders reales (${DEEP_ETA}). No baja el video.`,
    }, icon('refresh', 13), 'Analizar a fondo'),
    deepRunning ? deepProgress()
      : analyzing ? el('span', { id: 'cat-analyzing', class: 'cat-analyzing', role: 'status' },
        el('span', { class: 'cat-seeds-spin', 'aria-hidden': 'true' }), `Analizando ${analyzing}`) : null,
    el('span', { class: 'spacer' }),
    subsButton(),
    el('button', {
      id: 'cat-only-hdr', class: `cat-hdr-filter ${onlyHdr ? 'active' : ''}`, 'aria-pressed': String(onlyHdr),
      title: 'Mostrar solo HDR / Dolby Vision',
      onclick: () => { setOnlyHdr(!onlyHdr); renderStreamsOnly(); },
    }, 'Solo HDR'));
}

/** Avance del análisis profundo en curso (`runDeep`): "A fondo 7 de 15" y fracción 0–1. */
function deepStatus(f) {
  const n = f.deepHashes?.length ?? 0;
  const done = f.deepHashes?.filter((h) => deepDone.has(h)).length ?? 0;
  return { text: `A fondo ${done} de ${n}`, frac: n ? done / n : 0 };
}

/** Progreso del análisis del asistente sobre la lista: etapa del embudo con barra. */
function deepProgress() {
  const { text, frac } = deepStatus(state.side.flow);
  return el('span', { id: 'cat-analyzing', class: 'cat-analyzing', role: 'status' },
    el('span', { class: 'cat-seeds-spin', 'aria-hidden': 'true' }), text,
    el('span', { class: 'cat-progress' }, el('i', { style: `width:${Math.round(frac * 100)}%` })));
}

/** Contados al analizar en esta sesión (conectándose al enjambre): hash → SwarmCount. */
const counted = new Map();
/** Subtítulos bajados desde el catálogo en esta sesión, por VIDEO (película o episodio, no por
 *  torrent): videoId → [{provider, language, release_name}]. */
const subsFound = new Map();
const subsBusy = new Set();
/** Progreso de "Bajar subtítulos" por video: {downloading, done, total} (lo emite el núcleo). */
const subsProgress = new Map();
document.addEventListener('click', (ev) => {
  if (subsMenuOpen && !ev.target.closest?.('.cat-subs-box')) { subsMenuOpen = false; renderStreamsOnly(); }
});
/** Idioma de "Bajar subtítulos" (2026-11-15): español por defecto; el otro completa hasta 5. */
let subsLang = safeGet('tstream.catalog.subsLang') === 'en' ? 'en' : 'es';
/** Hashes con un recuento en curso: el spinner sobrevive a los redibujos (varios a la vez). */
const counting = new Set();
/** Conteo parcial de los que están contando (evento `catalog-swarm-progress`), hash → SwarmCount. */
const liveCount = new Map();
let liveRender = null;
/** ▶ tocado: info_hash → `key` del video (null mientras se agrega). Spinner hasta que la
 *  reproducción arranca o falla (evento `playback-updated`), no solo hasta que vuelve el invoke. */
const starting = new Map();
const PB_STARTING = new Set(['fetching-metadata', 'preparing']);

/** "Pesado" (2026-11-15): solo una precaución, no cambia el orden. Mbps que hay que bajar
 *  sostenidos para verlo sin cortes = tamaño ÷ duración. Los packs (varios episodios) no aplican. */
/** Bytes/s que hay que bajar sostenidos para verlo sin cortes = tamaño ÷ duración. `null` sin
 *  duración o sin tamaño, y en packs (varios episodios en un archivo no tienen una duración). */
function neededBps(c) {
  const min = state.side?.runtime;
  return min && c.size_bytes && !c.is_pack ? c.size_bytes / (min * 60) : null;
}
const toMbps = (bps) => (bps * 8) / 1e6;
const HEAVY_MBPS = 35; // un remux 4K anda en 60–80; un 4K web en 15–25; un 1080p en 5–10
function heavyBadge(c, badge) {
  const bps = neededBps(c);
  if (!bps || toMbps(bps) < HEAVY_MBPS) return null;
  const need = toMbps(bps);
  return badge('Pesado', 'cat-heavy', `Necesita ~${Math.round(need)} Mbps sostenidos (${humanBytes(c.size_bytes)} en ${state.side.runtime} min). Con pocos seeders puede cortarse: conviene cargarlo en background (⤓) para ver si la velocidad alcanza, o elegir uno más liviano.`);
}

/** Salud estimada del stream (2026-11-15): lo que aportarían los conectados al contar contra los
 *  Mbps que pide (tamaño ÷ duración). Solo una estimación: no cambia el orden. El aporte por
 *  seeder y el tope de la conexión salen de lo medido en esta PC (`health-calib.js`,
 *  ajustable en Ajustes); un leecher aporta una fracción fija de un seeder. */
const LEECH_SHARE = 1 / 6;
function healthBadge(c) {
  const n = counted.get(c.info_hash);
  if (!n?.reached) return null; // sin contar o nadie respondió (ya se ve con ✕)
  const leech = Math.max(0, n.peers - n.seeds);
  const need = neededBps(c) && toMbps(neededBps(c));
  const cal = renderCal ?? healthCalibration(state.library.values());
  const raw = (n.seeds + leech * LEECH_SHARE) * cal.seedMbps;
  const supply = cal.capMbps ? Math.min(raw, cal.capMbps) : raw;
  const ratio = need ? supply / need : null;
  // Una palabra, no "N×": no es una velocidad medida (eso lo da la carga en background).
  // Tres niveles (2026-11-15): la estimación es gruesa; más niveles serían ruido.
  const level = ratio != null ? (ratio >= 2 ? 0 : ratio >= 1 ? 1 : 2)
    : n.seeds >= 10 ? 0 : n.seeds >= 4 ? 1 : 2;
  const [text, cls, bars] = [['Bueno', 'cat-health-good', 3], ['Justo', 'cat-health-fair', 2], ['Malo', 'cat-health-risky', 1]][level];
  const basis = need
    ? `Pide ~${Math.round(need)} Mbps; ${n.seeds} seeders y ${leech} leechers conectados aportarían ~${Math.round(supply)} Mbps (${nf1(ratio)}×). Bueno desde 2×, justo desde 1×.`
    : `Sin duración conocida: solo por seeders conectados (${n.seeds}). Bueno desde 10, justo desde 4.`;
  // Ícono de señal (2026-11-15): tantas barras llenas como el nivel; el detalle va en el tooltip.
  const tipText = `Salud estimada del stream: ${text}. No es una medición. ${basis} Supone ~${nf1(cal.seedMbps)} Mbps por seeder (${cal.source === 'measured' ? `calibrado con ${cal.n} mediciones de esta PC` : cal.source === 'manual' ? 'fijado en Ajustes' : 'valor por defecto'}) y un sexto de eso por leecher${cal.capMbps ? `, con tope de ~${Math.round(cal.capMbps)} Mbps (lo más rápido que bajó esta PC)` : ''}; el conteo se corta en 30 conexiones. Para saberlo de verdad: cargarlo en background (⤓).`;
  const ic = el('span', { class: `cat-health-ic ${cls}`, title: tipText, role: 'img', 'aria-label': `Salud estimada: ${text}` });
  ic.innerHTML = `<svg viewBox="0 0 16 14" width="16" height="14" aria-hidden="true">${[1, 2, 3].map((b) => `<rect x="${b * 5 - 4}" y="${12 - b * 4}" width="3.4" height="${b * 4}" rx="1" class="${b <= bars ? 'on' : ''}"/>`).join('')}</svg>`;
  return ic;
}

/** "Cargar en background" (2026-11-15): info_hash → {key, row}; `row` = última fila. La velocidad
 *  la mide `health-calib.js` (la misma medición calibra la salud estimada). */
const bgLoads = new Map();
const BG_GREEN = 1.5; // mismos márgenes que el ranking (`green_margin` / `yellow_margin`)
const BG_YELLOW = 1;
/** Fila de una reproducción: la mide (calibra la salud si se conocen sus seeders) y, si es de una
 *  carga en background, la guarda para su texto. */
function measurePlayback(row) {
  trackPlayback(row, counted.get(row.key.split(':')[0])?.seeds);
  const b = [...bgLoads.values()].find((x) => x.key === row.key);
  if (b) b.row = row;
}
/** Texto de la card: "2,3× · alcanza" = promedio ÷ bitrate (tamaño ÷ duración). Sin duración
 *  (o pack) solo la velocidad. */
function bgText(c) {
  const b = bgLoads.get(c.info_hash);
  if (!b) return null;
  if (b.row?.state.kind === 'failed') return { cls: 'red', text: 'falló', tip: b.row.state.message };
  const speed = speedOf(b.key);
  if (!speed?.n) return { cls: 'measuring', text: 'cargando…', tip: 'Buscando metadatos y precargando el principio; después mide la velocidad.' };
  const avg = speed.avg;
  const done = speed.done ? 'completo · ' : '';
  const need = neededBps(c);
  if (!need) return { cls: 'none', text: `${done}${mbps(avg)}`, tip: `${mbps(avg)} de promedio bajando de fondo (sin duración conocida no se calcula si alcanza).` };
  const x = avg / need;
  const [cls, verdict] = x >= BG_GREEN ? ['green', 'alcanza'] : x >= BG_YELLOW ? ['yellow', 'justo'] : ['red', 'no alcanza'];
  return { cls, text: `${done}${nf1(x)}× · ${verdict}`, tip: `${mbps(avg)} de promedio ÷ ${mbps(need)} que consume el video.` };
}
/** Arranca o cancela la carga en background. Cancelar = Detener: lo bajado queda guardado y
 *  Reproducir lo retoma. */
async function toggleBg(hash, btn) {
  btn.disabled = true;
  const b = bgLoads.get(hash);
  try {
    if (b) {
      bgLoads.delete(hash);
      // Si ya se está viendo (Reproducir la retomó), cancelar no cierra el reproductor.
      if (b.row && ['fetching-metadata', 'preparing', 'background'].includes(b.row.state.kind)) await api.playbackAction(b.row.id, 'stop');
      setStatus('Carga en background cancelada: lo bajado queda guardado.');
    } else {
      const [row] = await api.catalogAdd(state.side.kind, state.side.videoId, [hash]);
      if (!row) return;
      bgLoads.set(hash, { key: row.key, row: null });
      await api.playBackground(row.key);
      setStatus('Cargando en background: la velocidad promedio aparece en la opción.');
    }
  } catch (e) { if (!b) bgLoads.delete(hash); showError(e); } finally {
    btn.disabled = false;
    if (state.update) renderStreamsOnly();
  }
}

/** Una opción: peso, seeders (tocar = analizar), badges, ⤓ cargar en background y ▶ reproducir. */
function optionRow(c, best = false) {
  const light = lightOf(c);
  const bg = bgText(c);
  // Al dar ▶, los estados de la reproducción en la card (2026-11-15).
  const pb = [...lib.playbacks.values()].find((r) => r.key.split(':')[0] === c.info_hash);
  const pbStatus = starting.has(c.info_hash) && !pb ? 'preparando…' : pb && pb.state.kind !== 'background' ? playbackText(pb) : null;
  const live = rowsOf(c.info_hash).find((e) => e.live)?.live ?? null;
  const scraped = counted.get(c.info_hash);
  const busy = counting.has(c.info_hash);
  const tip = [c.release_name, c.resolution && `Resolución: ${c.resolution}`, c.file_name && `Archivo: ${c.file_name}`, c.is_pack && 'Pack: varios episodios en un torrent', `Fuentes: ${c.addons.join(' + ')}${c.sites.length ? ` (${c.sites.join(', ')})` : ''}`].filter(Boolean).join('\n');
  const badge = (text, cls = '', title = '') => el('span', { class: `lang ${cls}`, title }, text);
  const hdrTip = c.hdr.map((x) => HDR_TIP[x]).filter(Boolean).join('\n');
  const checked = checkedBy(c);
  const partial = busy ? liveCount.get(c.info_hash) : null; // en vivo mientras cuenta
  const seedsNow = partial?.reached ? partial.seeds : knownSeeds(c);
  const dead = scraped?.reached === false;
  const seedsTip = skipped.has(c.info_hash) && !scraped ? (skipped.get(c.info_hash) === 'dead'
    ? 'No se analizó: los trackers y la fuente dan 0 seeders y 0 leechers (casi seguro muerto). Tocá para analizarlo igual.'
    : `No se analizó a fondo: quedó fuera de los ${TOP} mejores según los trackers. Tocá para analizarlo.`)
    : dead
    ? (scraped.peers ? `Nadie respondió: la red conoce ${scraped.peers} peers de este torrent pero ninguno contestó. Muy flojo, probablemente no arranque. Tocá para analizarlo.` : 'Nadie lo está compartiendo ahora (0 peers). Casi seguro muerto. Tocá para analizarlo.')
    : scraped ? `Conectado al enjambre: ${scraped.seeds} seeders (archivo completo) de ${scraped.peers} peers${c.seeders != null ? ` (los trackers anuncian ${c.seeders}, sin verificar)` : ''}. Es lo que respondió de verdad; al reproducir suelen aparecer algunos más. Tocá para analizarlo.`
    : live && live.seeds === 0 ? 'Al analizarlo no se vio ningún seeder conectado (puede ser el momento). Tocá para analizarlo.'
    : live ? `Seeders vistos al analizarlo: ${live.seeds} (${live.peers} peers conectados). Tocá para analizarlo.`
      : checked === 'trackers' ? `${TRACKERS_TIP} ${c.seeders} seeders, ${c.leechers ?? 0} leechers. Tocá para el análisis profundo (se conecta y cuenta los reales).`
        : 'Según la fuente (los trackers no lo conocen o no respondieron). Tocá para el análisis profundo.';
  return el('li', { class: `cat-opt light-${light.cls} ${best ? 'best' : ''} ${skipped.has(c.info_hash) ? 'skipped' : ''}`, title: tip, 'data-hash': c.info_hash,
    // Cada redibujo recrea la fila: la fase sale del reloj para que la animación no reinicie.
    style: busy ? `--live-phase:-${Date.now() % 3600}ms` : null },
    best ? el('span', { class: 'cat-best-tag' }, 'Mejor opción') : null,
    el('span', { class: 'cat-size-cell' },
      el('span', { class: 'cat-size' }, humanBytes(c.size_bytes)),
      pbStatus ? el('span', { class: `cat-speed cat-pb ${pb?.state.kind === 'failed' ? 'bg-red' : ''}`, role: 'status' }, pbStatus)
        : bg ? el('span', { class: `cat-speed bg-${bg.cls}`, title: bg.tip ?? '', role: 'status' }, bg.text)
        : light.text ? el('span', { class: 'cat-speed', title: 'Velocidad medida · margen' }, light.text) : null),
    // Seeds/leechers y, a su derecha, la salud estimada que sale de ellos (2026-11-15).
    el('span', { class: 'cat-stats-cell' }, el('button', {
      id: `cat-seeds-${c.info_hash}`, class: `cat-seeds-btn ${checked === 'deep' ? 'analyzed' : ''} ${dead ? 'dead' : ''} ${busy ? 'busy' : ''}`, title: seedsTip,
      'aria-label': `${seedsNow ?? 'Sin dato de'} seeders: análisis profundo`, 'aria-busy': busy ? 'true' : null, disabled: busy,
      onclick: () => reanalyze([c.info_hash]),
    }, // Seeds primero y grande; leechers y profundidad como una línea chica debajo.
    el('span', { class: 'cat-stat seeds' }, el('span', { class: 'cat-seeds-n' }, seedsNow ?? '—'), el('span', { class: 'cat-stat-label' }, 'seeds'),
      busy ? el('span', { class: 'cat-seeds-spin', 'aria-hidden': 'true' })
        : dead ? el('span', { class: 'cat-seeds-dead', 'aria-hidden': 'true' }, '✕')
        : checked === 'deep' ? el('span', { class: 'cat-deep-ic', title: 'Análisis profundo: se conectó al enjambre y contó los seeders reales.', role: 'img', 'aria-label': 'Análisis profundo' }, icon('radar', 14))
          : el('span', { class: 'cat-seeds-hint', 'aria-hidden': 'true' }, icon('refresh', 13))),
    busy ? el('span', { class: 'cat-stat-sub cat-live' }, el('span', { class: 'cat-live-dot', 'aria-hidden': 'true' }),
      !partial ? 'analizando · conectando…'
        : partial.reached ? `analizando · ${partial.peers} ${partial.peers === 1 ? 'peer conectado' : 'peers conectados'}`
          : `analizando · ${partial.peers} en la red, esperando respuesta…`)
    : el('span', { class: 'cat-stat-sub' },
      leechersOf(c) != null ? el('span', { title: 'Leechers: bajando ahora; comparten los pedazos que ya tienen' }, `${leechersOf(c)} leechers`) : null)),
    healthBadge(c)),
    el('span', { class: 'cat-badges' },
      latBadge(c, badge),
      heavyBadge(c, badge),
      hdrTip ? badge('HDR', 'cat-hdr', hdrTip) : null),
    el('span', { class: 'cat-opt-actions' },
      el('button', { id: `cat-bg-${c.info_hash}`, class: `cat-icon-btn ${bgLoads.has(c.info_hash) ? 'on' : ''}`, 'aria-pressed': String(bgLoads.has(c.info_hash)),
        title: bgLoads.has(c.info_hash) ? 'Cancelar la carga en background (lo bajado queda guardado)' : 'Cargar en background: lo deja bajando sin abrir el reproductor y dice si la velocidad alcanza para verlo',
        'aria-label': bgLoads.has(c.info_hash) ? 'Cancelar carga en background' : 'Cargar en background', onclick: (ev) => toggleBg(c.info_hash, ev.currentTarget) }, icon(bgLoads.has(c.info_hash) ? 'stop' : 'download', 18)),
      el('button', { id: `cat-play-${c.info_hash}`, class: `cat-icon-btn primary ${starting.has(c.info_hash) ? 'busy' : ''}`, title: starting.has(c.info_hash) ? 'Preparando la reproducción…' : 'Reproducir ya', 'aria-label': 'Reproducir', 'aria-busy': starting.has(c.info_hash) ? 'true' : null, disabled: starting.has(c.info_hash), onclick: (ev) => playOption(c.info_hash, ev.currentTarget) }, icon('play', 18))));
}

/** Resultado por idioma (2026-11-15): "2 ES" en verde, "3 EN" en amarillo; ninguno = rojo. */
function subsCounts(found) {
  const es = found.filter((f) => f.language === 'es').length;
  const en = found.filter((f) => f.language === 'en').length;
  if (!es && !en) return el('span', { class: 'cat-subs-n none' }, 'Sin subs');
  return el('span', { class: 'cat-subs-counts' },
    es ? el('span', { class: 'cat-subs-n es' }, `${es} ES`) : null,
    en ? el('span', { class: 'cat-subs-n en' }, `${en} EN`) : null);
}

/** "Buscando subs…" → "Bajando 2 de 5…" → "5 descargados". */
function subsLabel(video, busy, found) {
  if (busy) {
    const p = subsProgress.get(video);
    return p?.downloading ? `Bajando ${p.done} de ${p.total}…` : 'Buscando subs…';
  }
  if (!found) return 'Subs';
  return found.length ? `${found.length} descargados` : 'Sin subs';
}

let subsMenuOpen = false;
function subsButton() {
  const video = state.side?.videoId;
  const found = subsFound.get(video);
  const busy = subsBusy.has(video);
  const tip = busy ? 'Buscando y bajando subtítulos…'
    : found?.length ? `${found.length} subtítulo(s) listos para este video:\n${found.map((f) => `· ${f.language.toUpperCase()} · ${f.provider} · ${f.release_name}${f.downloads ? ` · ${f.downloads} descargas` : ''}`).join('\n')}`
      : 'Bajar hasta 5 subtítulos para este video';
  const pick = (lang) => () => { subsMenuOpen = false; subsLang = lang; safeSet('tstream.catalog.subsLang', lang); fetchSubs(); };
  return el('div', { class: 'cat-subs-box' },
    el('button', {
      id: 'cat-subs-get', class: `cat-subs-get ${found?.length ? 'done' : ''}`, title: tip,
      'aria-haspopup': 'menu', 'aria-expanded': String(subsMenuOpen), 'aria-busy': busy ? 'true' : null,
      disabled: busy || !state.update?.candidates.length,
      onclick: (ev) => { ev.stopPropagation(); subsMenuOpen = !subsMenuOpen; renderStreamsOnly(); },
    }, busy ? el('span', { class: 'cat-seeds-spin', 'aria-hidden': 'true' }) : icon('subs', 14),
    busy || !found ? subsLabel(video, busy, found) : subsCounts(found),
    el('span', { class: 'cat-subs-caret', 'aria-hidden': 'true' }, '▾')),
    subsMenuOpen ? el('div', { class: 'cat-subs-menu', role: 'menu' },
      el('button', { id: 'cat-subs-es', role: 'menuitem', onclick: pick('es') }, 'Español'),
      el('button', { id: 'cat-subs-en', role: 'menuitem', onclick: pick('en') }, 'Inglés')) : null);
}

/** "Bajar subtítulos" del video abierto: son del episodio/película, no de un torrent; usa el
 *  release de la mejor opción para afinar la coincidencia. */
async function fetchSubs() {
  const video = state.side?.videoId;
  const best = [...(state.update?.candidates ?? [])].sort(bySeeds)[0];
  if (!video || !best || subsBusy.has(video)) return;
  subsBusy.add(video);
  renderStreamsOnly();
  try {
    const found = await api.catalogSubtitles(video, best.info_hash, subsLang);
    subsFound.set(video, found);
    if (state.side?.videoId !== video) return;
    // Pidió un idioma y no vino ninguno: casi siempre faltan las keys gratis de Wyzie / OpenSubtitles.
    if (!found.some((f) => f.language === subsLang)) {
      const missing = (await api.apiKeys().catch(() => [])).filter((k) => ['wyzie', 'opensubtitles'].includes(k.service) && !k.configured);
      const lang = subsLang === 'es' ? 'español' : 'inglés';
      setStatus(missing.length
        ? `No encontré en ${lang}: faltan las API keys gratis de ${missing.map((k) => (k.service === 'wyzie' ? 'Wyzie' : 'OpenSubtitles')).join(' y ')} (⚙ Ajustes › Subtítulos).`
        : `No encontré subtítulos en ${lang} para este video${found.length ? '; bajé los que había en el otro idioma' : ''}.`);
    } else setStatus(`${found.length} subtítulo(s) listos para este video.`);
  } catch (e) { showError(e); } finally { subsBusy.delete(video); renderStreamsOnly(); }
}

/** Análisis profundo de esas opciones: se conecta a cada enjambre y cuenta los seeders reales. */
async function countSeeds(hashes) {
  const todo = hashes.filter((h) => !counting.has(h));
  if (!todo.length) return;
  todo.forEach((h) => counting.add(h));
  renderStreamsOnly();
  const video = state.side?.videoId;
  try {
    const found = await api.catalogSwarm(todo, true);
    if (state.side?.videoId !== video) return; // se fue de ese video: el resultado no se usa
    // Sin resultado = ningún peer dio los metadatos a tiempo: cuenta como "nadie respondió", no se
    // queda con el número de los trackers (que suele ser justamente el inflado).
    for (const h of todo) counted.set(h, found[h] ?? { seeds: 0, peers: 0, reached: false });
    if (todo.length === 1 && !found[todo[0]]) setStatus('No se pudo contar ese torrent: nadie respondió a tiempo.');
  } catch (e) { showError(e); } finally {
    todo.forEach((h) => { counting.delete(h); liveCount.delete(h); });
    renderStreamsOnly();
  }
}

/** Qué se sabe de los seeders de una opción (leyenda de la fila): 'deep' = contados al conectarse
 *  (análisis profundo); 'trackers' = chequeados en los trackers al cargar las opciones (lo hace el
 *  núcleo solo, siempre); null = solo lo que dice la fuente. */
const TRACKERS_TIP = 'Chequeado recién en los trackers al cargar las opciones: más fiel que lo que dice la fuente.';
const checkedBy = (c) => (counted.has(c.info_hash) ? 'deep' : trackersWin(c) ? 'trackers' : null);

/** Etapa 2 del embudo: cuántos se cuentan a fondo (los mejores según los trackers), todos a la vez
 *  (el núcleo cuenta hasta 25 en paralelo, `swarm::CONCURRENCY`). 15 y no 25 (pedido 2026-11-15): cada uno abre hasta 30
 *  conexiones y con 25 la red se cargaba de más. */
const TOP = 15;
/** Tiempo del análisis profundo (todos a la vez, ver `swarm.rs`): trackers unos segundos +
 *  metadatos hasta 35 s + conteo de 45 a 85 s. Los muertos se liberan a los 15 s. */
const DEEP_ETA = '1 a 2 min';
/** Finalistas que además reciben el análisis rápido (metadatos, duración, idiomas). */
const FINALISTS = 8;
function finalists(cands) {
  return cands.filter((c) => counted.get(c.info_hash)?.seeds > 0)
    .sort((a, b) => counted.get(b.info_hash).seeds - counted.get(a.info_hash).seeds || counted.get(b.info_hash).peers - counted.get(a.info_hash).peers)
    .slice(0, FINALISTS).map((c) => c.info_hash);
}
/** Hashes de la etapa en curso que ya respondieron (evento `catalog-swarm-counted`). */
const deepDone = new Set();
/** Salteados por el análisis (2026-11-15), hash → por qué: 'dead' = trackers con 0 seeders y 0
 *  leechers y la fuente sin seeders; 'rest' = fuera de los `TOP`. Se analizan igual desde su fila. */
const skipped = new Map();
const unlikely = (c) => c.seeders === 0 && c.leechers === 0 && !(c.seeders_declared > 0);
/** Análisis profundo desde cero de esas opciones (borra lo contado antes). Una sola: se cuenta ya;
 *  varias: el embudo de `runDeep`. */
function reanalyze(hashes, res = null) {
  const video = state.side?.videoId;
  if (hashes.length === 1) quickAnalyze(hashes);
  hashes.forEach((h) => { counted.delete(h); if (hashes.length === 1) skipped.delete(h); });
  if (hashes.length === 1) {
    countSeeds(hashes);
  } else {
    const f = state.side.flow ?? (state.side.flow = { step: 'done' });
    if (f.deep !== 'run') { f.deep = null; runDeep(video, res); }
  }
}

/** Redibuja y anima lo que cambió (2026-11-15): las filas se deslizan a su nuevo lugar (FLIP),
 *  el número de seeders que cambió destella y la "Mejor opción" nueva entra con un pulso. */
function renderStreamsOnly() {
  const box = $('#cat-streams');
  if (!box) return;
  const rows = () => [...box.querySelectorAll('.cat-opt[data-hash]')];
  const before = new Map(rows().map((n) => [n.dataset.hash, { top: n.getBoundingClientRect().top, seeds: n.querySelector('.cat-seeds-btn')?.textContent }]));
  const prevBest = box.querySelector('.cat-opt.best')?.dataset.hash;
  libByHash = new Map();
  for (const e of state.library.values()) {
    const list = libByHash.get(e.info_hash);
    if (list) list.push(e); else libByHash.set(e.info_hash, [e]);
  }
  renderCal = healthCalibration(state.library.values());
  try { renderStreamsBody(box); } finally { libByHash = renderCal = null; }
  if (!before.size || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const now = performance.now();
  for (const n of rows()) {
    const hash = n.dataset.hash, old = before.get(hash);
    if (old) {
      const dy = old.top - n.getBoundingClientRect().top;
      if (Math.abs(dy) > 1) n.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)' });
      if (old.seeds !== undefined && n.querySelector('.cat-seeds-btn')?.textContent !== old.seeds) fx.set(`flash|${hash}`, now);
      if (n.classList.contains('best') && prevBest && prevBest !== hash) fx.set(`best|${hash}`, now);
    }
    // Las filas se recrean en cada redibujo: el efecto sigue donde iba (delay negativo).
    for (const [kind, target, cls] of [['flash', n.querySelector('.cat-seeds-btn'), 'flash'], ['best', n, 'new-best']]) {
      const t = fx.get(`${kind}|${hash}`);
      if (t === undefined || !target) continue;
      if (now - t > 900) { fx.delete(`${kind}|${hash}`); continue; }
      target.classList.add(cls);
      target.style.animationDelay = `${-(now - t)}ms`;
      const tag = cls === 'new-best' && n.querySelector('.cat-best-tag');
      if (tag) tag.style.animationDelay = target.style.animationDelay;
    }
  }
}
/** Último texto de reproducción mostrado por opción (hash → firma): evita redibujos iguales. */
const cardSig = new Map();
/** Efectos en curso: `flash|hash` / `best|hash` → cuándo empezaron (ms). */
const fx = new Map();

function renderStreamsBody(box) {
  const u = state.update;
  const body = $('#cat-side-body');
  const scroll = body?.scrollTop ?? 0;
  box.replaceChildren();
  if (state.side?.flow && state.side.flow.step !== 'done' && (!u || !u.done || u.candidates.length)) {
    renderWizard(box, u);
    return;
  }
  if (!u || (!u.done && !u.candidates.length)) { box.append(el('div', { class: 'side-skeleton' }, Array.from({ length: 6 }, () => el('span', { class: 'skel' })))); return; }
  if (u.done && !u.candidates.length) {
    const anyOk = u.addons.some((a) => a.state === 'ok');
    box.append(el('p', { class: 'pop-empty' }, anyOk ? 'Ninguna fuente tiene torrents para esto.' : 'Ninguna fuente respondió. Cerrá y volvé a abrirlo para reintentar.'));
    return;
  }
  // Por resolución (2026-11-15): acordeón vertical. Uno abierto a la vez; los demás quedan en la
  // lista como encabezados colapsados. Arriba, fijos, los títulos de columna y el filtro HDR.
  const list = onlyHdr ? u.candidates.filter((c) => c.hdr.length) : u.candidates;
  const groups = new Map(RES_ORDER.map((r) => [r, []]));
  for (const c of list) groups.get(resKey(c)).push(c);
  const present = RES_ORDER.filter((r) => groups.get(r).length);
  // `null` = nunca se eligió (se abre el primero); '' = el usuario cerró todos.
  if (openRes === null || (openRes && !present.includes(openRes))) openRes = present[0] ?? null;
  const toggle = (r) => {
    openRes = openRes === r ? '' : r;
    safeSet('tstream.catalog.openRes', openRes);
    renderStreamsOnly();
    if (openRes) document.getElementById(`cat-group-${r}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  box.append(el('div', { class: 'cat-sticky' }, optionsHead()));
  if (!present.length) { box.append(el('p', { class: 'pop-empty' }, 'Ninguna opción con HDR / Dolby Vision.')); return; }
  box.append(...present.map((r) => {
    const open = r === openRes;
    return el('section', { class: `cat-group ${open ? 'open' : ''}`, id: `cat-group-${r}` },
      el('button', { id: `cat-res-${r}`, class: 'cat-group-head', 'aria-expanded': String(open), onclick: () => toggle(r) },
        el('span', { class: 'cat-group-name' }, resLabel(r)),
        el('span', { class: 'cat-res-count' }, `${groups.get(r).length} ${groups.get(r).length === 1 ? 'opción' : 'opciones'}`),
        el('span', { class: 'cat-chev' }, icon('chev', 18))),
      open ? el('ul', { class: 'cat-options' }, groups.get(r).sort(bySeeds).map((c, i) => optionRow(c, i === 0 && r === state.side?.flow?.res))) : null);
  }));
  if (body) body.scrollTop = scroll;
}

// ---------- asistente al elegir un video (2026-11-15) ----------
const flowStep = (step) => { state.side.flow.step = step; renderStreamsOnly(); };

/** Pasos del asistente: el de HDR solo si la resolución elegida tiene opciones HDR. */
function wizardSteps(u) {
  const f = state.side.flow;
  // Mientras las fuentes siguen respondiendo no se sabe si hay HDR: se pregunta igual.
  const hdr = f.res && (!u?.done || u.candidates.some((c) => resKey(c) === f.res && c.hdr.length));
  return ['res', hdr ? 'hdr' : null, 'analysis'].filter(Boolean);
}

function wizardHead(u, title, sub) {
  const steps = wizardSteps(u);
  const f = state.side.flow;
  const i = steps.indexOf(f.step);
  return el('div', { class: 'wz-head' },
    i > 0 ? el('button', { id: 'wz-back', class: 'wz-back', onclick: () => flowStep(steps[i - 1]) }, '← Atrás') : null,
    el('span', { class: 'wz-step' }, `Paso ${i + 1} de ${steps.length}`),
    el('h3', {}, title),
    sub ? el('p', {}, sub) : null);
}

function bigChoice({ id, title, desc, tag, onclick, primary }) {
  return el('button', { id, class: `wz-choice ${primary ? 'primary' : ''}`, onclick },
    el('span', { class: 'wz-choice-text' }, el('b', {}, title), desc ? el('span', {}, desc) : null),
    tag ? el('span', { class: 'wz-tag' }, tag) : null);
}

function renderWizard(box, u) {
  const f = state.side.flow;
  // Las fuentes se consultan de fondo mientras se eligen los pasos (2026-11-15): los botones
  // son fijos y solo cambian sus números; la animación de entrada va solo al cambiar de paso.
  const enter = f.shown !== f.step;
  f.shown = f.step;
  const cands = u?.candidates ?? [];
  const searchingNow = !u?.done;
  const answered = u ? u.addons.filter((a) => a.state !== 'pending').length : 0;
  const sourcesNote = searchingNow ? el('p', { class: 'wz-note' }, el('span', { class: 'cat-seeds-spin' }),
    !u?.addons.length ? 'Buscando torrents en las fuentes…'
      : answered < u.addons.length ? `Buscando torrents · ${answered} de ${u.addons.length} fuentes · ${cands.length} encontrados`
        : `${cands.length} torrents · consultando sus seeders…`) : null;
  const groups = new Map(RES_ORDER.map((r) => [r, cands.filter((c) => resKey(c) === r)]));
  const present = RES_ORDER.filter((r) => groups.get(r).length);
  if (f.step === 'res') {
    const shown = searchingNow ? RES_ORDER : present;
    box.append(el('div', { class: `wz ${enter ? 'enter' : ''}` },
      wizardHead(u, '¿En qué resolución lo querés ver?'),
      el('div', { class: 'wz-list' }, shown.map((r) => {
        const n = groups.get(r).length;
        return bigChoice({
          id: `wz-res-${r}`, title: resLabel(r),
          desc: `${RES_DESC[r]} · ${searchingNow ? 'cargando…' : `${n} ${n === 1 ? 'opción' : 'opciones'}`}`,
          onclick: () => {
            f.res = r;
            openRes = r;
            const hasHdr = searchingNow || groups.get(r).some((c) => c.hdr.length);
            if (!hasHdr) setOnlyHdr(false);
            flowStep(hasHdr ? 'hdr' : 'analysis');
          },
        });
      })),
      sourcesNote));
    return;
  }
  if (f.step === 'hdr') {
    const all = groups.get(f.res);
    const hdrN = all.filter((c) => c.hdr.length).length;
    const choose = (only) => () => { setOnlyHdr(only); flowStep('analysis'); };
    box.append(el('div', { class: `wz ${enter ? 'enter' : ''}` },
      wizardHead(u, '¿Lo querés en HDR?', 'HDR / Dolby Vision se aprovecha con pantalla HDR; en una común se ve igual o más apagado.'),
      el('div', { class: 'wz-list' },
        bigChoice({ id: 'wz-hdr-any', title: 'Me da igual', desc: `Todas, con y sin HDR · ${all.length} opciones`, primary: true, onclick: choose(false) }),
        bigChoice({ id: 'wz-hdr-yes', title: 'Solo HDR', desc: `Más brillo y color, si tu pantalla es HDR · ${hdrN} ${hdrN === 1 ? 'opción' : 'opciones'}`, onclick: choose(true) })),
      sourcesNote));
    return;
  }
  const start = (mode) => {
    f.mode = mode;
    startAnalysisWhenReady();
    // Sin paso de idioma (2026-11-15): siempre intenta bajar subtítulos en español.
    subsLang = 'es';
    fetchSubs();
    flowStep('loading');
  };
  const n = cands.filter((c) => inScope(c, f.res)).length;
  const scope = `${n} opciones en ${resLabel(f.res)}${onlyHdr ? ' HDR' : ''}`;
  if (f.step === 'analysis') {
    const mins = `${DEEP_ETA}${searchingNow ? ' (todavía llegan opciones)' : ''}`;
    box.append(el('div', { class: `wz ${enter ? 'enter' : ''}` },
      wizardHead(u, '¿Análisis profundo?', `${scope}. Los seeders ya se chequean solos en los trackers; el profundo se conecta y cuenta los reales.`),
      el('div', { class: 'wz-list' },
        bigChoice({ id: 'wz-an-deep', title: 'Analizar a fondo', desc: `Toma los ${TOP} mejores según los trackers y se conecta a todos a la vez para contar los seeders reales · ${mins}`, tag: 'Recomendado', primary: true, onclick: () => start('deep') }),
        bigChoice({ id: 'wz-an-none', title: 'No, alcanza con los trackers', desc: 'Ordena por lo que respondieron los trackers al cargar las opciones', onclick: () => start('none') })),
      sourcesNote));
    return;
  }
  // Cargando: cada proceso con su estado y progreso.
  const res = cands.filter((c) => inScope(c, f.res));
  const deepNow = deepStatus(f);
  const nSkipped = res.filter((c) => skipped.has(c.info_hash)).length;
  const subsState = subsFound.has(state.side.videoId) && !subsBusy.has(state.side.videoId) ? 'ok' : 'run';
  const analysisDone = !searchingNow && (f.mode === 'none' || f.deep === 'done');
  const pct = analysisDone ? 100 : f.mode === 'deep' ? Math.round(deepNow.frac * 100) : 40;
  const row = (stateCls, title, detail) => el('li', { class: `wz-task ${stateCls}` },
    el('span', { class: 'wz-dot', 'aria-hidden': 'true' }, stateCls === 'ok' ? icon('check', 14) : stateCls === 'run' ? el('span', { class: 'cat-seeds-spin' }) : '·'),
    el('span', { class: 'wz-task-text' }, el('b', {}, title), detail ? el('span', {}, detail) : null));
  box.append(el('div', { class: 'wz wz-loading', role: 'status' },
    el('div', { class: 'wz-orb', 'aria-hidden': 'true' }, el('span'), el('span'), el('span')),
    el('h3', {}, analysisDone ? 'Listo' : 'Preparando las mejores opciones…'),
    el('div', { class: 'wz-progress' }, el('i', { style: `width:${pct}%` })),
    el('ul', { class: 'wz-tasks' },
      row(searchingNow ? 'run' : 'ok', 'Torrents de todas las fuentes', searchingNow
        ? `${answered} de ${u?.addons.length ?? '…'} fuentes · ${cands.length} encontrados`
        : `${cands.length} encontrados · ${res.length} en ${resLabel(f.res)}`),
      // Subtítulos antes que el análisis: el análisis suele ser lo último en terminar.
      row(subsState, 'Subtítulos en español', subsState === 'ok' ? `${subsFound.get(state.side.videoId)?.length ?? 0} descargados` : subsLabel(state.side.videoId, true)),
      f.mode === 'none' ? row('skip', 'Sin análisis profundo', 'Se ordena por lo que respondieron los trackers')
        : row(f.deep === 'done' ? 'ok' : 'run', 'Conectándose a cada torrent', `${f.deep === 'done' ? `${res.filter((c) => counted.has(c.info_hash)).length} contados` : deepNow.text}${nSkipped ? ` · ${nSkipped} descartados (sin señales o fuera del top ${TOP})` : ''}`)),
    el('button', { id: 'wz-see', class: `wz-see ${analysisDone ? 'primary' : ''}`, onclick: () => flowStep('done') }, analysisDone ? 'Ver opciones' : 'Ver lo que hay hasta ahora')));
  if (analysisDone && f.autoDone !== true) { f.autoDone = true; setTimeout(() => { if (state.side?.flow === f && f.step === 'loading') flowStep('done'); }, 900); }
}

/** El análisis elegido arranca apenas las fuentes terminaron (puede elegirse antes). */
function startAnalysisWhenReady() {
  const f = state.side?.flow;
  if (!f?.mode || f.started || !state.update?.done) return;
  f.started = true;
  if (f.mode === 'deep') runDeep(state.side.videoId, f.res);
}

/** Análisis profundo (2026-11-15): los trackers ya respondieron al cargar las opciones (el núcleo
 *  los consulta solo), así que de ahí sale el orden: se descartan los `unlikely` y se cuentan a
 *  fondo, todos a la vez, los `TOP` mejores. El progreso va en `f.deepHashes` / `deepDone`. Se
 *  corta al salir del video. */
async function runDeep(video, res) {
  const f = state.side.flow ?? (state.side.flow = { step: 'done' });
  if (f.deep === 'run') return;
  f.deep = 'run';
  const all = (state.update?.candidates ?? []).filter((c) => inScope(c, res));
  const todo = all.filter((c) => !counted.has(c.info_hash) && !counting.has(c.info_hash));
  todo.forEach((c) => skipped.delete(c.info_hash)); // reanalizar decide de nuevo
  todo.filter(unlikely).forEach((c) => skipped.set(c.info_hash, 'dead'));
  // Solo los TOP mejores según los trackers (más abajo casi nunca se ven bien).
  const ranked = todo.filter((c) => !skipped.has(c.info_hash)).sort((a, b) => (seedsOf(b) ?? -1) - (seedsOf(a) ?? -1));
  ranked.slice(TOP).forEach((c) => skipped.set(c.info_hash, 'rest'));
  f.deepHashes = ranked.slice(0, TOP).map((c) => c.info_hash);
  deepDone.clear();
  renderStreamsOnly();
  if (f.deepHashes.length) await countSeeds(f.deepHashes);
  if (state.side?.flow === f) { f.deep = 'done'; renderStreamsOnly(); }
  // Los finalistas, además, con análisis rápido (metadatos, duración, idiomas reales).
  if (state.side?.videoId === video) quickAnalyze(finalists(all));
}

/** Grupos de resolución (2026-11-15): 4K, 1080p, 720p y "Otras" (1440p, SD y sin dato). */
const RES_ORDER = ['2160p', '1080p', '720p', 'other'];
const resKey = (c) => (['2160p', '1080p', '720p'].includes(c.resolution) ? c.resolution : 'other');
const RES_DESC = {
  '2160p': 'La mejor calidad; archivos grandes, pide buena conexión',
  '1080p': 'Full HD: buen equilibrio entre calidad y tamaño',
  '720p': 'HD liviano: arranca rápido aun con poca conexión',
  other: '1440p, SD o sin resolución informada',
};
const resLabel = (r) => ({ '2160p': '4K', other: 'Otras' }[r] ?? r);
/** Grupo de resolución abierto (uno a la vez). */
let openRes = safeGet('tstream.catalog.openRes');

/** Análisis rápido sin salir del catálogo (2026-11-15): se agrega a la biblioteca y el resultado
 *  aparece en la fila (duración, idiomas). Sin botón propio: va solo con cada "Analizar". */
async function quickAnalyze(hashes) {
  if (!hashes.length) return;
  try {
    await api.catalogAdd(state.side.kind, state.side.videoId, hashes);
    await Promise.all(hashes.map((hash) => api.analyze({ kind: 'quick', hash })));
  } catch (e) { showError(e); }
}

/** Reproducir: lo agrega a la biblioteca y lo abre (elige el audio si hay
 *  varios). Se queda en el catálogo (pedido 2026-11-15). */
async function playOption(hash, btn) {
  btn.disabled = true;
  starting.set(hash, null);
  let started = false;
  try {
    const [row] = await api.catalogAdd(state.side.kind, state.side.videoId, [hash]);
    if (row && starting.has(hash)) {
      starting.set(hash, row.key);
      started = await play(row.key, btn, row);
    }
  } catch (e) { showError(e); }
  // Cancelado, error, o ya se estaba viendo (el núcleo no manda evento): se suelta ya.
  const pb = started && [...lib.playbacks.values()].find((r) => r.key === starting.get(hash) && r.state.kind !== 'paused');
  if (!started || (pb && !PB_STARTING.has(pb.state.kind))) starting.delete(hash);
  btn.disabled = false;
  if (state.update) renderStreamsOnly();
}

/** Suelta el spinner de ▶ cuando esa reproducción arrancó, falló o se cerró. */
function onPlaybackRow(row) {
  if (PB_STARTING.has(row.state.kind)) return;
  for (const [hash, key] of starting) if (key === row.key) starting.delete(hash);
}

// ---------- Fuentes (FR-41) ----------
async function openSources() {
  let dlg = $('#dlg-sources');
  if (!dlg) {
    dlg = el('dialog', { id: 'dlg-sources', class: 'dialog wide' });
    document.body.append(dlg);
  }
  const addons = await api.catalogAddons().catch((e) => { showError(e); return []; });
  const input = el('input', { type: 'text', placeholder: 'Pegá la URL del manifest (https://…/manifest.json)', class: 'cat-add-url' });
  const msg = el('p', { class: 'hint' });
  const refresh = () => openSources();
  dlg.replaceChildren(
    el('h3', {}, 'Fuentes de torrents'),
    el('p', { class: 'hint' }, 'Addons de Stremio que se consultan al abrir una película o episodio. La app no indexa contenido: solo junta lo que devuelven. En P2P tu IP es visible para los demás del torrent.'),
    el('ul', { class: 'cat-sources' }, addons.map((a) => el('li', {},
      el('label', {}, el('input', { type: 'checkbox', checked: a.enabled, onchange: (ev) => api.catalogSetAddonEnabled(a.id, ev.target.checked).catch(showError) }), ` ${a.name}`),
      el('span', { class: 'hint cat-url' }, a.display_url),
      el('button', { class: 'small danger', onclick: () => api.catalogRemoveAddon(a.id).then(refresh, showError) }, 'Quitar')))),
    el('div', { class: 'key-row' }, input,
      el('button', { onclick: async () => {
        msg.textContent = 'Validando…';
        try {
          const a = await api.catalogAddAddon(input.value);
          setStatus(`${a.name} ✓ agregado.`);
          refresh();
        } catch (e) { msg.textContent = e?.message ?? String(e); }
      } }, 'Agregar')),
    msg,
    el('div', { class: 'dialog-actions' },
      el('button', { onclick: () => api.catalogResetAddons().then(refresh, showError) }, 'Restaurar lista por defecto'),
      el('button', { onclick: () => dlg.close() }, 'Cerrar')),
  );
  if (!dlg.open) dlg.showModal();
}

// ---------- Explorar (FR-37 simple, pedido 2026-11-14) ----------
// Tipo → orden → cuándo (frase de filtros, 2026-11-15) → de a 20, "Cargar más".
const PAGE = 20;
const browse = {
  kind: safeGet('tstream.browse.kind') ?? 'movie',
  sort: safeGet('tstream.browse.sort') ?? 'popular',
  year: Number(safeGet('tstream.browse.year')) || null,
  // Rango de estreno (AAAA-MM-DD; `to` vacío = hasta hoy). Con `from`, manda sobre el año.
  from: safeGet('tstream.browse.from') || '',
  to: safeGet('tstream.browse.to') || '',
  // Género de Cinemeta (solo `Documentary`, para "documentales"; pedido 2026-11-15).
  genre: safeGet('tstream.browse.genre') || null,
  items: [], stale: [], shown: 0, skip: 0, cursor: null, hasMore: true, loading: false, error: null, gen: 0,
};

function setBrowse(changes) {
  // Lo que se veía queda atenuado hasta que llega lo nuevo (sin vaciar la pantalla).
  const stale = browseItems().slice(0, browse.shown);
  // `gen` invalida lo que esté cargando con el filtro anterior.
  Object.assign(browse, changes, { stale, items: [], shown: 0, skip: 0, cursor: null, hasMore: true, error: null, loading: false, gen: browse.gen + 1 });
  safeSet('tstream.browse.kind', browse.kind);
  safeSet('tstream.browse.sort', browse.sort);
  safeSet('tstream.browse.year', browse.year ?? '');
  safeSet('tstream.browse.from', browse.from);
  safeSet('tstream.browse.to', browse.to);
  safeSet('tstream.browse.genre', browse.genre ?? '');
  loadMore();
}

async function loadMore() {
  if (browse.loading) return;
  const gen = browse.gen;
  const visible = () => browseItems().length;
  // Cinemeta da 50 por página: se piden más solo cuando no alcanzan para mostrar 20 más.
  while (browse.hasMore && visible() < browse.shown + PAGE) {
    browse.loading = true;
    render();
    try {
      const page = byDate()
        ? await api.catalogBrowseReleased(browse.kind, browse.from || `${MIN_YEAR}-01-01`, browse.to || null, browse.genre, browse.cursor)
        : await api.catalogBrowse(browse.kind, browse.sort === 'rating' ? 'rating' : 'popular', browse.year, browse.genre, browse.skip);
      if (gen !== browse.gen) return; // cambió el filtro: otra carga ya está en curso
      const seen = new Set(browse.items.map((p) => p.id));
      browse.items.push(...page.items.filter((p) => !seen.has(p.id)));
      browse.skip += 50;
      browse.cursor = page.next ?? null;
      // Con rango, una tanda puede venir vacía (años sin estrenos en el rango) y seguir habiendo más.
      browse.hasMore = page.has_more && (byDate() ? !!page.next : page.items.length > 0);
    } catch (e) {
      if (gen !== browse.gen) return;
      browse.error = e?.message ?? String(e);
      browse.hasMore = false;
    } finally {
      if (gen === browse.gen) browse.loading = false;
    }
  }
  browse.shown += PAGE;
  browse.stale = [];
  render();
}

function browseItems() {
  const list = browse.items.filter((p) => !(state.hideJapanese && p.excluded));
  // Con año o rango Cinemeta trae por fecha: puntaje y popularidad se ordenan sobre lo cargado.
  if (browse.year || browse.from) {
    if (browse.sort === 'rating') list.sort((a, b) => (Number(b.imdb_rating) || 0) - (Number(a.imdb_rating) || 0));
    if (browse.sort === 'popular') list.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
  }
  return list;
}

// ---------- frase de filtros (pedido 2026-11-15, diseño design/filtros-frase.html) ----------
// "Mostrando [películas] [más populares en IMDb] de [cualquier año]": cada palabra abre su menú.
// Años sueltos usan el catálogo `year`; rangos de años y fechas exactas van por `from`/`to`
// (el núcleo recorre los años y filtra por `released`).
const MIN_YEAR = 1950;
const thisYear = () => new Date().getFullYear();
const isoDay = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const lastMonth = () => isoDay(new Date(Date.now() - 30 * 86400000));
/** Se pide por fecha (núcleo recorriendo años): con rango, o "más recientes" sin año. */
const byDate = () => !!browse.from || (browse.sort === 'recent' && !browse.year);

// Miniseries: Cinemeta no las distingue (ni tipo ni género); queda visible y deshabilitada.
const KINDS = [
  { id: 'movie', label: 'películas', kind: 'movie', genre: null },
  { id: 'series', label: 'series', kind: 'series', genre: null },
  { id: 'miniseries', label: 'miniseries', disabled: true },
  { id: 'documentary', label: 'documentales', kind: 'movie', genre: 'Documentary' },
];
const BROWSE_SORTS = [
  ['popular', 'más populares en IMDb', 'lo más visto'],
  ['rating', 'con mejor puntaje IMDb', 'nota promedio'],
  ['recent', 'más recientes', 'por fecha de estreno'],
];
const YEAR_PRESETS = [['Cualquier año', null], ['Este año', 0], ['Últimos 5 años', 4], ['Últimos 10 años', 9]];
const DECADES = [['2020s', 2020, null], ['2010s', 2010, 2019], ['2000s', 2000, 2009], ['90s', 1990, 1999], ['80s', 1980, 1989], ['Antes', MIN_YEAR, 1979]];

/** Popover abierto ('kind' | 'sort' | 'when') y si se ven las fechas exactas. */
let menu = null;
let exactDates = false;

/** [desde, hasta] en años enteros, o null si el filtro es por fechas exactas (o no hay filtro). */
function yearSpan() {
  if (browse.year) return [browse.year, browse.year];
  if (!browse.from.endsWith('-01-01')) return null;
  const from = Number(browse.from.slice(0, 4));
  if (!browse.to) return [from, thisYear()];
  return browse.to.endsWith('-12-31') ? [from, Number(browse.to.slice(0, 4))] : null;
}

/** Un año suelto (que no sea el actual) usa el catálogo `year`; el resto, rango hasta hoy o fin de año. */
function setYears(from, to) {
  const now = thisYear();
  if (from === null) return setBrowse({ year: null, from: '', to: '' });
  if (from === to && to < now) return setBrowse({ year: from, from: '', to: '' });
  setBrowse({ year: null, from: `${from}-01-01`, to: to >= now ? '' : `${to}-12-31` });
}

function whenWords() {
  if (!browse.year && !browse.from) return ['de', 'cualquier año'];
  const span = yearSpan(), now = thisYear();
  if (!span) {
    if (browse.from === lastMonth() && !browse.to) return ['del', 'último mes'];
    const fmt = (d) => d.split('-').reverse().join('/');
    return ['del', `${fmt(browse.from)} a ${browse.to ? fmt(browse.to) : 'hoy'}`];
  }
  const [from, to] = span;
  if (from === now && to === now) return ['de', 'este año'];
  if (from === to) return ['de', String(from)];
  if (from === MIN_YEAR && to < now) return ['de', `antes de ${to + 1}`];
  if (to === now && [5, 10].includes(now - from + 1)) return ['de', `los últimos ${now - from + 1} años`];
  if (to === now) return ['de', `${from} a hoy`];
  if (from % 10 === 0 && to === from + 9) return ['de', `los ${from < 2000 ? String(from).slice(2) : from}s`];
  return ['de', `${from} a ${to}`];
}

const sameSpan = (from, to) => {
  const span = yearSpan();
  return from === null ? !browse.year && !browse.from : !!span && span[0] === from && span[1] === to;
};
/** Elegir una opción cierra el menú; si no cambia nada, no se recarga la lista. */
const pick = (changed, apply) => () => { menu = null; if (changed) apply(); else renderFilters(); };

const menuOpt = (id, label, sel, onclick, { sub, disabled } = {}) => el('button', {
  id, class: `cat-menu-opt ${sel ? 'sel' : ''}`, role: 'menuitemradio', 'aria-checked': String(sel), disabled, onclick,
}, el('span', {}, label, sub ? el('small', {}, ` · ${sub}`) : null));

function kindMenu() {
  return KINDS.map((k) => {
    const sel = k.kind === browse.kind && k.genre === browse.genre;
    return menuOpt(`cat-kind-${k.id}`, k.label, sel, pick(!sel, () => setBrowse({ kind: k.kind, genre: k.genre })),
      k.disabled ? { disabled: true, sub: 'próximamente' } : {});
  });
}

function sortMenu() {
  return BROWSE_SORTS.map(([value, label, sub]) =>
    menuOpt(`cat-sort-${value}`, label, browse.sort === value, pick(browse.sort !== value, () => setBrowse({ sort: value })), { sub }));
}

function whenMenu() {
  const now = thisYear(), span = yearSpan();
  const presets = YEAR_PRESETS.map(([label, back], i) => {
    const from = back === null ? null : now - back;
    const sel = sameSpan(from, now);
    return menuOpt(`cat-when-${i}`, label, sel, pick(!sel, () => setYears(from, now)));
  });
  const decades = el('div', { class: 'cat-decades' }, DECADES.map(([label, from, to]) => {
    const end = to ?? now, sel = sameSpan(from, end);
    return el('button', { id: `cat-decade-${from}`, class: `cat-chip ${sel ? 'on' : ''}`, onclick: pick(!sel, () => setYears(from, end)) }, label);
  }));
  // "Entre [año] y [año]": se queda abierto para ajustar el otro extremo; si quedan al revés se ordenan.
  const years = Array.from({ length: now - MIN_YEAR + 1 }, (_, i) => now - i);
  const pickYear = (which) => (ev) => {
    const v = Number(ev.target.value), [from, to] = span ?? [v, now];
    const [a, b] = which === 'from' ? [v, to] : [from, v];
    setYears(Math.min(a, b), Math.max(a, b));
  };
  const between = el('div', { class: 'cat-between' }, 'Entre',
    el('select', { id: 'cat-year-from', 'aria-label': 'Desde el año', onchange: pickYear('from') },
      el('option', { value: '', hidden: true, selected: !span }, 'año'),
      years.map((y) => el('option', { value: y, selected: span?.[0] === y }, y))),
    'y',
    el('select', { id: 'cat-year-to', 'aria-label': 'Hasta el año', onchange: pickYear('to') },
      years.map((y) => el('option', { value: y, selected: (span?.[1] ?? now) === y }, y === now ? 'hoy' : y))));
  return [...presets, el('div', { class: 'cat-sep' }), decades, el('div', { class: 'cat-sep' }), between, exactDates ? exactBlock() : el('button', {
    id: 'cat-exact', class: 'cat-more-link', onclick: () => { exactDates = true; renderFilters(); },
  }, 'Fechas exactas…')];
}

/** Fechas exactas (menos usadas): último mes o desde/hasta como el `release_date` de IMDb. */
function exactBlock() {
  const dates = !yearSpan() && !!browse.from;
  const set = (from, to) => (from !== browse.from || to !== browse.to) && setBrowse({ year: null, from, to });
  const field = (key, label) => el('label', {}, label, el('input', {
    type: 'date', id: `cat-date-${key}`, value: dates ? browse[key] : '', min: `${MIN_YEAR}-01-01`, 'aria-label': `Estreno ${label}`,
    onchange: (ev) => {
      const v = ev.target.value;
      if (key === 'from') set(v, v && browse.to && browse.to < v ? '' : browse.to);
      else set(browse.from || (v ? `${MIN_YEAR}-01-01` : ''), v); // "hasta" solo = desde 1950
    },
  }));
  const month = dates && browse.from === lastMonth() && !browse.to;
  return el('div', { class: 'cat-exact' },
    el('button', { id: 'cat-last-month', class: `cat-chip ${month ? 'on' : ''}`, onclick: pick(!month, () => set(lastMonth(), '')) }, 'Último mes'),
    field('from', 'Desde'), field('to', 'Hasta'),
    el('span', { class: 'hint' }, '“Hasta” vacío = hoy'));
}

function sentence(searching) {
  const word = (name, label, build) => el('span', { class: 'cat-dd' },
    el('button', {
      id: `cat-word-${name}`, class: `cat-word ${menu === name ? 'open' : ''}`, 'aria-haspopup': 'menu', 'aria-expanded': String(menu === name),
      onclick: () => {
        menu = menu === name ? null : name;
        if (name === 'when') exactDates = !yearSpan() && !!browse.from;
        renderFilters();
      },
    }, label),
    menu === name ? el('div', { id: `cat-pop-${name}`, class: `cat-pop ${name === 'when' ? 'wide' : ''}`, role: 'menu' }, build()) : null);
  const kind = KINDS.find((k) => k.kind === browse.kind && k.genre === browse.genre) ?? KINDS[0];
  if (searching) return el('div', { class: 'cat-sentence' }, 'Películas y series');
  const [prep, when] = whenWords();
  return el('div', { class: 'cat-sentence' }, 'Mostrando ',
    word('kind', kind.label, () => kindMenu()), ' ',
    word('sort', BROWSE_SORTS.find(([v]) => v === browse.sort)?.[1] ?? BROWSE_SORTS[0][1], sortMenu), ` ${prep} `,
    word('when', when, whenMenu));
}

// Clic afuera o Escape cierra el menú (ignora clics en nodos que un re-render ya sacó).
document.addEventListener('click', (ev) => {
  if (menu && ev.target.isConnected && !ev.target.closest('.cat-dd')) { menu = null; renderFilters(); }
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && menu) { menu = null; renderFilters(); }
});

/** Magnets pegados del portapapeles (sin ficha del catálogo), arriba de todo (2026-11-15: reemplaza
 *  a "Mis magnets"). Lo más nuevo primero. */
function pastedSection() {
  const rows = [...state.library.values()].filter((e) => !e.origin)
    .sort((a, b) => String(b.added_at ?? '').localeCompare(String(a.added_at ?? '')));
  if (!rows.length) return null;
  const name = (e) => {
    const r = e.release;
    const ep = r?.season != null && r?.episode != null ? ` T${r.season}·E${r.episode}` : '';
    return r?.title ? `${r.title}${ep}` : e.torrent_name || e.name;
  };
  return el('section', { id: 'cat-pasted', class: 'cat-pasted', 'aria-label': 'Pegados' },
    el('h3', {}, 'Pegados'),
    el('ul', {}, rows.map((e) => el('li', { class: 'cat-pasted-row' },
      el('span', { class: 'cat-pasted-name', title: e.torrent_name || e.name }, name(e)),
      e.video_size ? el('span', { class: 'cat-pasted-size' }, humanBytes(e.video_size)) : null,
      el('button', { id: `cat-pasted-rm-${e.key}`, class: 'cat-icon-btn', title: 'Quitar de Pegados', 'aria-label': 'Quitar', onclick: () => api.remove(e.key).catch(showError) }, '✕'),
      el('button', { id: `cat-pasted-play-${e.key}`, class: 'cat-icon-btn primary', title: 'Reproducir', 'aria-label': 'Reproducir', onclick: (ev) => play(e.key, ev.currentTarget, e) }, icon('play', 16))))));
}
/** Redibuja solo la sección de pegados (llega una fila nueva o se quita una). */
function refreshPasted() {
  if (state.results || state.searching) return;
  const now = pastedSection();
  const old = $('#cat-pasted');
  if (old && now) old.replaceWith(now);
  else if (old) old.remove();
  else if (now) $('#cat-body')?.prepend(now);
}

function renderBrowse(root) {
  const pasted = pastedSection();
  if (pasted) root.append(pasted);
  const items = browseItems().slice(0, browse.shown);
  const stale = !items.length && browse.loading;
  if (items.length) root.append(el('div', { class: 'cat-grid' }, items.map(cardFor)));
  else if (stale) root.append(browse.stale.length ? el('div', { class: 'cat-grid stale', 'aria-busy': 'true' }, browse.stale.map(cardFor)) : skeletonGrid());
  if (browse.error) root.append(el('p', { class: 'hint' }, browse.error));
  else if (!items.length && !browse.loading) root.append(el('p', { class: 'hint' }, 'No hay títulos con ese filtro.'));
  if (browse.loading && !stale) root.append(el('p', { class: 'hint' }, 'Cargando…'));
  else if (browse.hasMore || browseItems().length > browse.shown) {
    root.append(el('div', { class: 'cat-more' }, el('button', { onclick: loadMore }, 'Cargar más')));
  }
}

// ---------- render ----------
/** Solo la frase de filtros: abrir o cerrar un menú no toca la grilla. */
function renderFilters() {
  $('#cat-filters').replaceChildren(sentence(!!(state.searching || state.results)));
}

function render() {
  renderFilters();
  const root = $('#cat-body');
  root.replaceChildren();
  if (state.searching) root.append(skeletonGrid());
  else if (state.results) renderResults(root);
  else {
    if (!browse.items.length && browse.hasMore && !browse.loading) loadMore();
    renderBrowse(root);
  }
}

async function init() {
  $('#catalog').append(
    el('div', { class: 'cat-main' },
      el('div', { class: 'cat-bar' },
        el('div', { class: 'cat-search' },
          el('input', { id: 'cat-q', type: 'search', placeholder: 'Buscar película o serie…', autocomplete: 'off', oninput: onQueryInput }))),
      el('div', { id: 'cat-filters' }),
      el('div', { id: 'cat-body' })),
    el('aside', { id: 'cat-side', class: 'cat-side', 'aria-label': 'Opciones' }));
  $('#btn-sources').addEventListener('click', openSources); // en Ajustes (2026-11-15)
  document.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey && ev.key.toLowerCase() === 'f') { ev.preventDefault(); $('#cat-q').focus(); }
    // Esc cierra el panel, salvo que esté abierto un diálogo o el selector de audio (cierran ellos).
    if (ev.key === 'Escape' && state.side
      && !document.querySelector('dialog[open]') && !document.querySelector('#pk.on')) closeSide();
  });
  try {
    const cfg = await api.config();
    // Anime siempre oculto (se sacó el toggle, 2026-11-15); si estaba apagado, se vuelve a prender.
    state.hideJapanese = true;
    if (cfg.catalog?.exclude_japanese === false) api.catalogSetExcludeJapanese(true).catch(showError);
    const lib = await api.library();
    for (const e of [...lib.pasted_now, ...lib.previous]) state.library.set(e.key, e);
  } catch (e) { showError(e); }
  await onCoreEvent((event) => {
    switch (event.type) {
      case 'catalog-streams': onStreams(event.update); break;
      case 'catalog-swarm-progress':
        // En vivo (2026-11-15): llega en cada cambio de cada torrent; se redibuja como mucho cada 400 ms.
        if (!counting.has(event.hash)) break;
        liveCount.set(event.hash, event.count);
        if (!liveRender) liveRender = setTimeout(() => { liveRender = null; if (state.update) renderStreamsOnly(); }, 400);
        break;
      case 'catalog-swarm-counted':
        counted.set(event.hash, event.count);
        counting.delete(event.hash);
        liveCount.delete(event.hash);
        deepDone.add(event.hash);
        if (state.update?.candidates.some((c) => c.info_hash === event.hash)) renderStreamsOnly();
        break;
      case 'catalog-subtitles-progress':
        subsProgress.set(event.video_id, event);
        if (event.video_id === state.side?.videoId) renderStreamsOnly();
        break;
      case 'catalog-excluded':
        state.excluded.add(event.id);
        if (state.results && state.hideJapanese) render();
        break;
      case 'library-entry-updated':
        state.library.set(event.entry.key, event.entry);
        if (!event.entry.origin) refreshPasted();
        if (state.update?.candidates.some((c) => c.info_hash === event.entry.info_hash)) renderStreamsOnly();
        break;
      case 'library-entry-removed':
        state.library.delete(event.key);
        refreshPasted();
        if (state.update) renderStreamsOnly();
        break;
      case 'playback-updated': {
        const n = starting.size;
        onPlaybackRow(event.row);
        measurePlayback(event.row);
        // Redibuja si cambió lo que muestra la card de esa opción (llega una fila por segundo
        // mientras reproduce y casi siempre dice lo mismo, 2026-11-15).
        const hash = event.row.key.split(':')[0];
        const c = state.update?.candidates.find((x) => x.info_hash === hash);
        const sig = c ? `${playbackText(event.row)}|${bgText(c)?.text ?? ''}` : null;
        const changed = c && cardSig.get(hash) !== sig;
        if (c) cardSig.set(hash, sig);
        if (state.update && (starting.size !== n || changed)) renderStreamsOnly();
        break;
      }
      // La card deja de mostrar el estado (app.js ya la sacó de `lib.playbacks`).
      case 'playback-removed': if (state.update) renderStreamsOnly(); break;
      default: break;
    }
  });
  render();
}

init().catch(showError);
