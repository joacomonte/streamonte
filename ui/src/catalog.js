// Catálogo (F4b, spec 09 §11): Buscar / Explorar → al tocar una película o serie se abre un panel
// a la derecha (pedido 2026-11-15). Película: sus opciones. Serie: Serie › Temporada › Episodio ›
// opciones, como migas de pan. Cada opción: análisis profundo, cargar en background o Reproducir.
// Todo texto que viene de Cinemeta o de los addons entra como texto, nunca como HTML (NFR-24).

import { api, onCoreEvent } from './api.js';
import { play } from './audio-picker.js';
import { $, el, icon, setStatus, showError as reportError } from './dom.js';
import { openSettings } from './dialogs.js';
import { humanBytes, mbps, nf1, playbackText } from './format.js';
import { MIN_SECS, healthCalibration, speedOf, trackPlayback } from './health-calib.js';
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
  results: null,          // MetaPreview[] ya ordenadas
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

/** Una lista nueva (búsqueda o filtros) arranca desde arriba. */
const toTop = () => document.querySelector('.cat-main')?.scrollTo({ top: 0 });

// ---------- búsqueda (FR-36) ----------
/** Se pide recién cuando se deja de tipear un momento (2026-11-16: no un pedido por letra). */
const SEARCH_WAIT_MS = 900;
function onQueryInput() {
  clearTimeout(searchTimer);
  searchSeq++; // lo que esté en vuelo ya no se muestra
  const q = $('#cat-q').value.trim();
  if (q.length < 2) { state.results = null; state.searching = false; render(); return; }
  if (!state.searching) { state.searching = true; render(); toTop(); }
  searchTimer = setTimeout(() => search(q), SEARCH_WAIT_MS);
}

async function search(q) {
  const seq = ++searchSeq;
  setStatus(`Buscando "${q}"…`);
  try {
    const r = await api.catalogSearch(q);
    if (seq !== searchSeq) return;
    state.searching = false;
    state.results = r;
    setStatus(r.length ? 'Elegí una película o serie.' : `No encontré "${q}". Probá con el título en inglés.`);
    render();
  } catch (e) {
    if (seq === searchSeq) { state.searching = false; render(); showError(e); }
  }
}

/** Cards ya armadas, por título: re-renderizar no recrea los <img> (no recargan ni parpadean).
 *  Las nuevas entran con un fade escalonado (`i` = posición en la grilla). */
const cards = new Map();
function cardFor(p, i) {
  const key = p.id;
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
  const info = el('span', { class: 'cat-card-info', 'aria-hidden': 'true' });
  let hoverT = null;
  return el('button', {
    class: `cat-card ${state.side?.id === p.id ? 'active' : ''}`, 'data-id': p.id,
    onclick: () => openSide(p.kind, p.id, p.name),
    // Detalles al detenerse un momento encima (no al pasar de largo): la ficha queda en caché.
    onmouseenter: () => { if (!info.childElementCount) hoverT = setTimeout(() => fillCardInfo(info, p), 250); },
    onmouseleave: () => clearTimeout(hoverT),
  },
  // Título y año sobre el póster, con un degradado chico siempre visible (2026-11-16).
  el('span', { class: 'cat-poster' }, img,
    el('span', { class: 'cat-card-caption' }, el('span', { class: 'cat-card-name' }, p.name),
      el('span', { class: 'cat-card-year' }, [p.year, p.imdb_rating && `★ ${p.imdb_rating}`].filter(Boolean).join(' · '))),
    info));
}

/** Detalles sobre el póster al pasar el mouse (2026-11-16): géneros, puntaje y sinopsis, sobre un
 *  degradado a oscuro. Sale de la ficha (Cinemeta, guardada en la caché de datos). */
async function fillCardInfo(info, p) {
  info.replaceChildren(el('span', { class: 'skel line' }), el('span', { class: 'skel line' }), el('span', { class: 'skel line short' }));
  const m = await api.catalogMeta(p.kind, p.id).catch(() => null);
  if (!m) { info.replaceChildren(); return; }
  // Series: mini gráfico de temporadas y qué pasa con la próxima (rápido: sin key no usa IMDb).
  // Mientras llegan los puntajes: barras que laten (se reemplazan, o se van si no hay nada).
  const seasonsBox = p.kind === 'series' ? el('span', { class: 'cat-info-seasons' },
    el('span', { class: 'sbars small loading', 'aria-hidden': 'true' }, [40, 70, 55, 85, 65].map((h, i) => el('span', { class: 'sbar' },
      el('span', { class: 'sbar-track' }, el('i', { style: `height:${h}%;animation-delay:${i * 90}ms` })))))) : null;
  if (seasonsBox) {
    const last = Math.max(0, ...m.episodes.map((e) => e.season));
    api.catalogSeasonRatings(p.id, true).then((r) => seasonsBox.replaceChildren(...seasonMini(r, seasonOutlook(r.status, last)))).catch(() => {});
  }
  info.replaceChildren(
    m.genres.length ? el('span', { class: 'cat-info-genres' }, m.genres.slice(0, 3).map((g) => el('span', {}, GENRE_ES[g] ?? g))) : null,
    seasonsBox,
    // Duración solo en películas: en series depende del capítulo.
    el('span', { class: 'cat-info-meta' }, [m.year, m.imdb_rating && `★ ${m.imdb_rating}`, p.kind === 'movie' && m.runtime_min && `${m.runtime_min} min`].filter(Boolean).join(' · ')),
    m.description ? el('span', { class: 'cat-info-desc' }, m.description) : null);
}

/** Versión chica del gráfico de temporadas para la tarjeta (2026-11-16): las mismas barras que el
 *  panel (`seasonBars`) y qué viene después; con fecha, una cuenta regresiva destacada. */
function seasonMini(r, o) {
  const out = [seasonBars(r, o, false)];
  if (o?.date) {
    const when = o.days <= 1 ? (o.days ? 'mañana' : 'hoy') : `en ${o.days} días`;
    out.push(el('span', { class: 'cat-mini-next soon' },
      el('span', { class: 'cat-mini-soon' }, icon('clock', 12), when),
      `T${o.season}${o.episode > 1 ? ` E${o.episode}` : ''} · ${new Date(`${o.date}T12:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }).replace('.', '')}`));
  } else if (o) {
    const end = o.tone === 'done' || o.tone === 'stop';
    out.push(el('span', { class: `cat-mini-next ${o.tone}` }, el('span', { class: 'show-status-dot', 'aria-hidden': 'true' }),
      end ? `Serie ${o.label.toLowerCase()}` : `${o.label} · sin fecha`));
  }
  return out.filter(Boolean);
}

/** Resultados de la búsqueda: películas y series juntas, ya ordenadas por el núcleo (lo más popular
 *  primero). */
function renderResults(root) {
  const list = state.results.filter((p) => !(state.hideJapanese && state.excluded.has(p.id)));
  root.append(list.length
    ? el('div', { class: 'cat-grid' }, list.map(cardFor))
    : el('p', { class: 'hint' }, 'Sin resultados para esa búsqueda.'));
}

/** Cards de carga mientras se tipea (2026-11-15). */
function skeletonGrid(n = 12) {
  return el('div', { class: 'cat-grid', 'aria-busy': 'true', 'aria-label': 'Buscando…' },
    Array.from({ length: n }, () => el('div', { class: 'cat-card skeleton' }, el('span', { class: 'skel poster' }))));
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
    // Puntaje por temporada de fondo (2026-11-16); la primera vez sin key baja datasets de IMDb.
    api.catalogSeasonRatings(id).then((r) => { if (seq === sideSeq) { state.side.seasonRatings = r; renderSide(); } })
      .catch(() => { if (seq === sideSeq) { state.side.seasonRatings = null; renderSide(); } });
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
        : el('span', { class: `crumb current ${st.cls ?? ''}`, title: st.label, 'aria-current': 'page' }, st.label)))));
}

function renderSide() {
  const aside = $('#cat-side');
  const s = state.side;
  $('#catalog').classList.toggle('side-open', !!s);
  if (!s) { aside.replaceChildren(); return; }
  aside.replaceChildren(
    el('button', { id: 'cat-side-close', class: 'side-close', title: 'Cerrar (Esc)', 'aria-label': 'Cerrar panel', onclick: closeSide }, '✕'),
    ...(s.meta ? [hero(s.meta), about(s.meta)] : []), // replaceChildren escribiría "null"
    el('div', { class: 'side-head' }, crumbs(s)),
    el('div', { id: 'cat-side-body', class: 'side-body' }, sideBody(s)));
  renderStreamsOnly();
}

/** Géneros de Cinemeta (en inglés) a español; los que no están se muestran tal cual. */
const GENRE_ES = { Action: 'Acción', Adventure: 'Aventura', Animation: 'Animación', Biography: 'Biografía', Comedy: 'Comedia', Crime: 'Crimen', Documentary: 'Documental', Drama: 'Drama', Family: 'Familia', Fantasy: 'Fantasía', 'Film-Noir': 'Cine negro', History: 'Historia', Horror: 'Terror', Music: 'Música', Musical: 'Musical', Mystery: 'Misterio', Romance: 'Romance', 'Sci-Fi': 'Ciencia ficción', 'Science Fiction': 'Ciencia ficción', Short: 'Corto', Sport: 'Deportes', Thriller: 'Suspenso', War: 'Bélica', Western: 'Western', 'Reality-TV': 'Reality', 'Talk-Show': 'Talk show', 'Game-Show': 'Concurso', News: 'Noticias' };

/** Cabecera de la serie o película: fondo, póster y datos. */
function hero(m) {
  const facts = [m.year, m.imdb_rating && `★ ${m.imdb_rating}`, m.runtime_min && `${m.runtime_min} min`].filter(Boolean).join('  ·  ');
  return el('div', { class: 'side-hero' },
    m.background ? el('div', { class: 'side-hero-bg', style: `background-image:url("${encodeURI(m.background)}")` }) : null,
    m.poster ? el('img', { class: 'side-hero-poster', src: m.poster, alt: '', referrerpolicy: 'no-referrer', onerror: (ev) => ev.target.remove() }) : null,
    el('div', { class: 'side-hero-text' }, el('h2', {}, m.name), facts ? el('p', {}, facts) : null));
}

/** Debajo de la cabecera (pedido 2026-11-15): géneros, sinopsis (clic para verla entera) y link a IMDb. */
function about(m) {
  const desc = m.description ? el('p', {
    class: 'side-desc', tabindex: 0, 'aria-expanded': 'false',
    onclick: (ev) => { const p = ev.currentTarget; p.setAttribute('aria-expanded', String(p.classList.toggle('open'))); },
    onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.currentTarget.click(); } },
  }, m.description) : null;
  return el('div', { class: 'side-about' },
    m.genres.length ? el('div', { class: 'side-genres' }, m.genres.map((g) => el('span', { class: 'side-genre' }, GENRE_ES[g] ?? g))) : null,
    desc,
    el('button', { id: 'cat-open-imdb', class: 'side-imdb', onclick: () => api.catalogOpenImdb(m.id).catch(showError) }, 'Ver en IMDb', icon('external', 14)));
}

/** Puntaje por temporada como barras (2026-11-16), el mismo componente en el panel (`large`) y en
 *  la tarjeta. Alto relativo: la mejor temporada llena la barra y la base es un punto debajo de la
 *  peor, así se ve si sube o baja aunque todas estén entre 8 y 9. Color por nota. Si viene otra
 *  temporada, una barra punteada al final. null = no hay nada que mostrar. */
const seasonTone = (x) => (x >= 8.5 ? 'great' : x >= 7.5 ? 'good' : x >= 6.5 ? 'meh' : 'bad');
const fmtScore = (x) => x.toFixed(1).replace('.', ',');
function seasonBars(r, o, large) {
  const v = r.seasons.map((x) => x.rating);
  const upcoming = o && !(o.tone === 'done' || o.tone === 'stop') && o.season > (r.seasons.at(-1)?.season ?? 0) ? o : null;
  if (v.length < 2 && !(v.length && upcoming)) return null;
  const top = Math.max(...v), floor = Math.min(...v) - 1;
  const height = (x) => `${Math.max(12, ((x - floor) / (top - floor || 1)) * 100)}%`;
  const best = v.indexOf(top);
  const col = (tag, attrs, val, fill, n) => el(tag, attrs, large ? el('span', { class: 'sbar-val' }, val) : null,
    el('span', { class: 'sbar-track' }, fill), large ? el('span', { class: 'sbar-n' }, n) : null);
  const bars = r.seasons.map((x, i) => col(large ? 'button' : 'span', {
    ...(large ? { id: `cat-season-bar-${x.season}`, onclick: () => goSeason(x.season) } : {}),
    class: `sbar ${seasonTone(x.rating)} ${large && i === best ? 'best' : ''}`,
    title: `Temporada ${x.season}: ${fmtScore(x.rating)} (${x.episodes} episodios con puntaje)`,
  }, fmtScore(x.rating), el('i', { style: `height:${height(x.rating)}` }), `T${x.season}`));
  // Lo que viene: punteada, a la altura de la última, con la fecha si se sabe.
  const next = upcoming && col('span', {
    class: `sbar ghost ${upcoming.tone}`, title: `Temporada ${upcoming.season}: ${upcoming.date ? shortDate(upcoming.date) : `${upcoming.label.toLowerCase()}, sin fecha anunciada`}`,
  }, upcoming.date ? new Date(`${upcoming.date}T12:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }).replace('.', '') : '?',
  el('i', { style: `height:${height(v.at(-1))}` }), `T${upcoming.season}`);
  return el('span', { class: `sbars ${large ? 'large' : 'small'}` }, bars, next);
}
/** Primera contra última temporada: "Mejoró +0,8" / "Decayó −0,4" / "Estable". */
function seasonTrend(r) {
  const v = r.seasons.map((x) => x.rating);
  if (v.length < 2) return null;
  const delta = v.at(-1) - v[0];
  if (Math.abs(delta) < 0.3) return { text: 'Estable', icon: 'trend-flat', tone: 'flat' };
  return { text: `${delta > 0 ? 'Mejoró +' : 'Decayó −'}${fmtScore(Math.abs(delta))}`, icon: delta > 0 ? 'trend-up' : 'trend-down', tone: delta > 0 ? 'up' : 'down' };
}

/** Gráfico del panel de la serie. `r`: undefined = cargando (esqueleto). */
function seasonChart(r, o) {
  if (r === undefined) return el('div', { class: 'season-chart', 'aria-busy': 'true' }, el('span', { class: 'skel season-chart-skel' }));
  const bars = r && seasonBars(r, o, true);
  if (!bars) return null;
  const trend = seasonTrend(r), end = o?.tone === 'done' || o?.tone === 'stop';
  return el('div', { class: 'season-chart' },
    el('div', { class: 'season-chart-head' }, el('b', {}, 'Puntaje por temporada'),
      el('span', { class: 'season-chart-meta' },
        end ? el('span', { class: `season-end ${o.tone}`, title: 'No hay más temporadas' }, icon(o.tone === 'done' ? 'flag' : 'ban', 12), o.label) : null,
        trend ? el('span', { class: `season-trend ${trend.tone}` }, icon(trend.icon, 13), trend.text) : null,
        el('span', { class: 'season-chart-src' }, 'IMDb'))),
    bars);
}

/** Qué viene después de la última temporada (2026-11-16): punto fantasma del gráfico y tarjeta
 *  punteada de la lista. `last`: última temporada numerada. null = la fuente no lo sabe. */
const SHOW_STATES = { returning: 'Renovada', 'in-production': 'En producción', planned: 'Planeada', ended: 'Terminada', canceled: 'Cancelada' };
function seasonOutlook(st, last) {
  const label = st && SHOW_STATES[st.state];
  if (!label) return null;
  if (st.state === 'ended' || st.state === 'canceled') return { tone: st.state === 'ended' ? 'done' : 'stop', label };
  const next = st.next && new Date(`${st.next.date}T12:00:00`) > new Date() ? st.next : null;
  if (!next) return { tone: 'wait', label, season: last + 1 };
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const days = Math.round((new Date(`${next.date}T12:00:00`) - today) / 864e5);
  return { tone: 'go', label: 'En emisión', season: next.season, episode: next.episode, date: next.date, days };
}

function nextSeasonTile(o) {
  if (!o) return null;
  const end = o.tone === 'done' || o.tone === 'stop';
  const title = end ? `Serie ${o.label.toLowerCase()}` : o.episode > 1 ? `T${o.season} E${o.episode}` : `Temporada ${o.season}`;
  const detail = end ? 'No hay más temporadas'
    : o.date ? `${o.days <= 1 ? `Se estrena ${o.days ? 'mañana' : 'hoy'}` : `Se estrena en ${o.days} días`} · ${shortDate(o.date)}`
    : `${o.label} · sin fecha anunciada`;
  return el('div', { id: 'cat-season-next', class: `season-tile next ${o.tone}` },
    el('span', { class: 'season-tile-num' }, end ? icon(o.tone === 'done' ? 'flag' : 'ban', 22) : String(o.season)),
    el('span', { class: 'season-tile-text' }, el('b', {}, title), el('span', {}, detail)));
}

const shortDate = (iso) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function sideBody(s) {
  if (s.videoId) return el('div', { id: 'cat-streams' });
  if (!s.meta) return el('div', { class: 'side-skeleton' }, Array.from({ length: 5 }, () => el('span', { class: 'skel' })));
  const eps = s.meta.episodes;
  if (s.season == null) {
    // Temporadas: tarjetas sin imagen (las de episodios pueden spoilear, pedido 2026-11-15).
    const seasons = [...new Set(eps.map((e) => e.season))].sort((a, b) => (a || 999) - (b || 999));
    const outlook = seasonOutlook(s.seasonRatings?.status, Math.max(0, ...seasons));
    const tiles = seasons.map((n) => {
      const list = eps.filter((e) => e.season === n);
      const years = [...new Set(list.map((e) => e.released?.slice(0, 4)).filter(Boolean))];
      return el('button', { class: 'season-tile', id: `cat-season-${n}`, onclick: () => goSeason(n) },
        el('span', { class: 'season-tile-num' }, n === 0 ? '★' : String(n)),
        el('span', { class: 'season-tile-text' },
          el('b', {}, n === 0 ? 'Especiales' : `Temporada ${n}`),
          el('span', {}, [`${list.length} episodios`, years.length && (years.length > 1 ? `${years[0]}–${years.at(-1)}` : years[0])].filter(Boolean).join(' · '))));
    });
    // La tarjeta punteada va después de la última temporada, antes de Especiales.
    tiles.splice(seasons.includes(0) ? tiles.length - 1 : tiles.length, 0, nextSeasonTile(outlook));
    return el('div', { class: 'season-grid' }, seasonChart(s.seasonRatings, outlook), tiles);
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
  // Sin asistente (2026-11-16): la lista se ve enseguida y se completa sola (fuentes → trackers); el
  // análisis profundo se pide con "Chequear <resolución>". `status`: null | 'run' | 'done'.
  state.side.deep = { status: null, hashes: [] };
  state.side.subsStarted = false;
  openRes = null;
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
  // Subtítulos de fondo apenas hay una opción (2026-11-16): su release afina la coincidencia.
  if (update.candidates.length && !state.side.subsStarted) { state.side.subsStarted = true; fetchSubs(); }
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
  // Consulta de trackers del analizador: si ya se contó a fondo no aporta nada (2026-11-16: parecía
  // que el análisis no terminaba).
  if (e.status?.kind === 'scraping') return counted.has(c.info_hash) ? { cls: 'none', text: '' } : { cls: 'measuring', text: 'consultando trackers…' };
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

/** Por seeders, leechers y peso (lo usan los subtítulos y el desempate de `sortOptions`). */
const bySeeds = (a, b) => tierOf(b) - tierOf(a) || (knownSeeds(b) ?? -1) - (knownSeeds(a) ?? -1) || (leechersOf(b) ?? -1) - (leechersOf(a) ?? -1) || (b.size_bytes ?? 0) - (a.size_bytes ?? 0);

/** Orden de las opciones (2026-11-16), recalculado en cada redibujo (también con los conteos
 *  parciales mientras analiza): arriba las que se están analizando; después las analizadas a fondo, por salud y, entre las de salud buena,
 *  la más pesada (mejor calidad: la salud ya dice que alcanza para su bitrate; los packs van después
 *  porque su peso es de varios episodios); entre las demás, la de más margen. Debajo, las sin analizar
 *  por seeders y leechers (`bySeeds`): con números de trackers la salud no es confiable. Devuelve
 *  `{list, best}`: `best` = la primera por ese orden; arriba de todo, igual, va lo que se reproduce o
 *  baja (que quede a la vista). */
function sortOptions(cands) {
  const key = (c) => {
    // Las que se están contando, arriba (2026-11-16: se ve el análisis avanzar); el resto, `bySeeds`.
    const tier = counting.has(c.info_hash) ? 3 : tierOf(c);
    if (tier !== 2) return [-tier];
    const h = health(c);
    const lvl = h?.level ?? 3;
    const good = lvl === 0;
    const bySize = good && h.exact && !c.is_pack; // el peso de un pack es de varios episodios
    return [-tierOf(c), lvl, good && !bySize ? 1 : 0, bySize ? -(c.size_bytes ?? 0) : -(h?.ratio ?? -1)];
  };
  const byKey = (ka, kb) => ka.map((x, i) => x - (kb[i] ?? 0)).find((d) => d !== 0) ?? 0;
  const list = cands.map((c) => [key(c), c]).sort(([ka, a], [kb, b]) => byKey(ka, kb) || bySeeds(a, b)).map(([, c]) => c);
  const active = new Set([...lib.playbacks.values()].filter((r) => r.state.kind !== 'failed').map((r) => r.key.split(':')[0]));
  return { list: [...list.filter((c) => active.has(c.info_hash)), ...list.filter((c) => !active.has(c.info_hash))], best: list[0] };
}

/** Grupo para ordenar: 2 = analizado a fondo (arriba), 1 = el resto (trackers, fuente o una
 *  medición vieja de la biblioteca), 0,5 = sin respuesta pero con peers conocidos (no está muerto,
 *  2026-11-16), 0 = nadie lo comparte. */
function tierOf(c) {
  const n = counted.get(c.info_hash);
  return !n ? 1 : n.reached !== false ? 2 : n.peers ? 0.5 : 0;
}
/** Seeders que se saben de una opción, de lo más confiable a lo menos: contados al analizar
 *  (aunque sea 0), medidos al reproducir o cargar, según los trackers y, por último, la fuente. */
function knownSeeds(c) {
  const partial = liveCount.get(c.info_hash);
  return counted.get(c.info_hash)?.seeds ?? (partial?.reached ? partial.seeds : null)
    ?? rowsOf(c.info_hash).find((e) => e.live)?.live.seeds ?? seedsOf(c);
}
/** Leechers (desempate): conectados sin el archivo completo al contar, o los del scrape automático. */
function leechersOf(c) {
  const partial = liveCount.get(c.info_hash);
  const n = counted.get(c.info_hash) ?? (partial?.reached ? partial : null) ?? rowsOf(c.info_hash).find((e) => e.live)?.live;
  if (n?.reached === false) return null; // nadie respondió: esos peers solo los conoce la DHT
  return n ? Math.max(0, n.peers - n.seeds) : c.leechers ?? null;
}

let onlyHdr = safeGet('streamonte.catalog.onlyHdr') === '1';
function setOnlyHdr(v) { onlyHdr = v; safeSet('streamonte.catalog.onlyHdr', v ? '1' : '0'); }
/** Lo que entra en un análisis: esa resolución (o todas, sin `res`) y, si se pidió, solo HDR. */
const inScope = (c, res) => (!res || resKey(c) === res) && (!onlyHdr || c.hdr.length);

/** Arriba de la lista (2026-11-16): a la izquierda el panel de búsqueda y análisis completo; a la
 *  derecha, chicos, subtítulos y filtro HDR. La lista se ordena siempre por seeders. */
function optionsHead() {
  return el('div', { class: 'cat-opt-head' },
    deepPanel(),
    el('div', { class: 'cat-opt-tools' },
      subsButton(),
      el('button', {
        id: 'cat-only-hdr', class: `cat-tool ${onlyHdr ? 'active' : ''}`, 'aria-pressed': String(onlyHdr),
        title: 'Mostrar solo HDR / Dolby Vision',
        onclick: () => { setOnlyHdr(!onlyHdr); renderStreamsOnly(); },
      }, onlyHdr ? icon('check', 13) : null, 'Solo HDR')));
}

/** "Análisis completo" (2026-11-16): análisis profundo del grupo de resolución abierto. Un solo
 *  panel con sus estados: buscando torrents, listo para empezar, analizando (con barra) y hecho
 *  (para esa resolución; con otra abierta vuelve a ofrecerlo). */
function deepPanel() {
  const u = state.update, d = state.side.deep, res = openRes;
  const resText = res === 'other' ? 'las otras resoluciones' : resLabel(res);
  const panel = (cls, ic, title, sub, ...extra) => el('div', { id: 'cat-deep', class: `cat-deep ${cls}`, role: 'status' },
    el('span', { class: 'cat-deep-icon', 'aria-hidden': 'true' }, ic),
    el('span', { class: 'cat-deep-text' }, el('span', { class: 'cat-deep-title' }, title), el('span', { class: 'cat-deep-sub' }, sub)), ...extra);
  const spin = () => el('span', { class: 'cat-deep-spin' });
  if (!u?.done) {
    const answered = u ? u.addons.filter((a) => a.state !== 'pending').length : 0;
    return panel('waiting', spin(), el('b', {}, 'Buscando torrents'),
      u?.addons.length ? `${answered} de ${u.addons.length} fuentes · ${u.candidates.length} encontrados` : 'Consultando las fuentes…');
  }
  if (d.status === 'run') {
    const { done, n, frac } = deepStatus(d);
    const what = d.single ? (n === 1 ? '1 torrent' : `${n} torrents`) : d.res === 'other' ? 'otras' : resLabel(d.res);
    return panel('running', spin(), el('b', {}, `Analizando ${what} · ${done} de ${n}`),
      'Conectándose a cada torrent y contando los seeders reales',
      el('button', { id: 'cat-deep-stop', class: 'cat-deep-go', onclick: (ev) => { ev.currentTarget.disabled = true; stopDeep(); } }, 'Detener'),
      el('span', { class: 'cat-deep-bar' }, el('i', { style: `width:${Math.max(4, Math.round(frac * 100))}%` })));
  }
  if (!res) return panel('idle', icon('radar', 16), el('b', {}, 'Análisis completo'), 'Abrí una resolución para analizarla a fondo');
  const doneHere = d.status === 'done' && d.res === res;
  const start = () => reanalyze(u.candidates.filter((c) => inScope(c, res)).map((c) => c.info_hash), res);
  if (doneHere) {
    const inRes = u.candidates.filter((c) => inScope(c, res));
    const checkedN = inRes.filter((c) => counted.has(c.info_hash)).length;
    const alive = inRes.filter((c) => counted.get(c.info_hash)?.seeds > 0).length;
    // Quedan sin contar (y no muertos): se ofrece otra tanda, solo si el usuario quiere (2026-11-16).
    const more = Math.min(TOP, inRes.filter((c) => !counted.has(c.info_hash) && !unlikely(c)).length);
    const next = more ? el('button', { id: 'cat-deep-more', class: 'cat-deep-go', onclick: () => runDeep(state.side.videoId, res) }, `Analizar ${more} más`)
      : el('button', { id: 'cat-deep-go', class: 'cat-deep-go', onclick: start }, 'Repetir');
    // Ninguna con salud buena (2026-11-16): se recomienda analizar la resolución siguiente más baja.
    const lower = RES_ORDER.slice(RES_ORDER.indexOf(res) + 1).find((r) => r !== 'other' && u.candidates.some((c) => inScope(c, r)));
    const anyGood = inRes.some((c) => counted.get(c.info_hash)?.reached && health(c)?.level === 0);
    if (!anyGood && lower) {
      const goLower = () => {
        openRes = lower;
        reanalyze(u.candidates.filter((c) => inScope(c, lower)).map((c) => c.info_hash), lower);
        document.getElementById(`cat-group-${lower}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      };
      return panel('done warn', icon('radar', 16), el('b', {}, `Ninguna de ${resText} llega a salud buena`),
        `Con estos seeders y tu conexión probablemente se corte. En ${resLabel(lower)} hay más chances.`,
        el('button', { id: 'cat-deep-lower', class: 'cat-deep-go', onclick: goLower }, `Analizar ${resLabel(lower)}`));
    }
    return panel('done', icon('check', 16), el('b', {}, 'Análisis completo'), `${resText}: ${alive} de ${checkedN} con seeders reales`, next);
  }
  // Sin analizar, todo el panel es el botón (variante F, 2026-11-16): la acción recomendada es obvia.
  return el('button', { id: 'cat-deep-go', class: 'cat-deep-cta', onclick: start },
    el('span', { class: 'cat-deep-cta-ic', 'aria-hidden': 'true' }, icon('radar', 18)),
    el('span', { class: 'cat-deep-cta-text' }, el('b', {}, 'Encontrar el mejor torrent'),
      el('span', {}, `Recomendado · cuenta seeders reales de las ${TOP} mejores de ${resText} · ${DEEP_ETA}`)),
    el('span', { class: 'cat-deep-cta-arrow', 'aria-hidden': 'true' }, icon('arrow', 18)));
}

/** "Detener" el análisis (2026-11-16): corta los conteos en curso; lo ya contado queda. Los cortados
 *  se marcan en `stopped` para no tomarlos como "nadie respondió". */
const stopped = new Set();
function stopDeep() {
  const d = state.side?.deep;
  counting.forEach((h) => stopped.add(h));
  if (d) d.stopped = true;
  api.catalogStopSwarm().catch(showError);
}

/** Avance del análisis profundo en curso (`runDeep`): cuántos respondieron y fracción 0–1. */
function deepStatus(d) {
  const n = d.hashes.length;
  const done = d.hashes.filter((h) => deepDone.has(h)).length;
  return { done, n, frac: n ? done / n : 0 };
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
let subsLang = safeGet('streamonte.catalog.subsLang') === 'en' ? 'en' : 'es';
/** Hashes con un recuento en curso: el spinner sobrevive a los redibujos (varios a la vez). */
const counting = new Set();
/** Conteo parcial de los que están contando (evento `catalog-swarm-progress`), hash → SwarmCount. */
const liveCount = new Map();
let liveRender = null;
/** ▶ tocado: info_hash → `key` del video (null mientras se agrega). Spinner hasta que la
 *  reproducción arranca o falla (evento `playback-updated`), no solo hasta que vuelve el invoke. */
const starting = new Map();
const PB_STARTING = new Set(['fetching-metadata', 'preparing']);

/** Bytes del archivo que se ve. En un pack (2026-11-16) no sirve el peso del pack entero: el del
 *  episodio si ya se analizó o reprodujo (fila de la biblioteca `hash:sXeY`: el archivo real leído
 *  de los metadatos, `live.file_size`; `video_size` a veces trae el de otra fuente), el que da la fuente si
 *  señala el archivo (`file_name`), o el del pack ÷ los episodios de la temporada. Un pack de varias
 *  temporadas sin más datos: null. */
function fileBytes(c) {
  if (!c.is_pack) return c.size_bytes ?? null;
  const [, season, episode] = (state.side?.videoId ?? '').split(':');
  const e = episode && state.library.get(`${c.info_hash}:s${season}e${episode}`);
  if (e?.live?.file_size || e?.video_size) return e.live?.file_size || e.video_size;
  if (!c.size_bytes) return null;
  if (c.file_name) return c.size_bytes;
  if (/\bS\d{1,2}\s*-\s*S?\d{1,2}\b|complete\s*series|integral/i.test(c.release_name)) return null;
  const eps = (state.side?.meta?.episodes ?? []).filter((x) => String(x.season) === season).length;
  return eps ? c.size_bytes / eps : null;
}
/** Bytes/s que hay que bajar sostenidos para verlo sin cortes = archivo ÷ duración (la real si se
 *  analizó, si no la de la ficha). `null` sin alguno de los dos. */
function neededBps(c) {
  const [, season, episode] = (state.side?.videoId ?? '').split(':');
  const e = c.is_pack && episode ? state.library.get(`${c.info_hash}:s${season}e${episode}`) : rowsOf(c.info_hash)[0];
  const secs = e?.live?.duration_secs ?? (state.side?.runtime && state.side.runtime * 60);
  const bytes = fileBytes(c);
  return bytes && secs ? bytes / secs : null;
}
/** Mbps típicos por resolución (2026-11-16) cuando no se sabe cuánto pide (pack sin analizar): un
 *  4K web anda en 15–25, un 1080p en 5–10. Mejor una estimación que solo contar seeders. */
const TYPICAL_MBPS = { '2160p': 25, '1080p': 8, '720p': 4 };
const toMbps = (bps) => (bps * 8) / 1e6;
/** "Pesado" (2026-11-15): solo una precaución. */
const HEAVY_MBPS = 35; // un remux 4K anda en 60–80; un 4K web en 15–25; un 1080p en 5–10
function heavyBadge(c, badge) {
  const bps = neededBps(c);
  if (!bps || toMbps(bps) < HEAVY_MBPS) return null;
  const need = toMbps(bps);
  return badge('Pesado', 'cat-heavy', `Necesita ~${Math.round(need)} Mbps sostenidos (tamaño ÷ duración del episodio o película). Con pocos seeders puede cortarse: conviene cargarlo en background (⤓) para ver si la velocidad alcanza, o elegir uno más liviano.`);
}

/** Salud estimada del stream (2026-11-15): lo que aportarían seeders y leechers contra los Mbps que
 *  pide (tamaño ÷ duración), con techo en la velocidad de internet (2026-11-16: el test de velocidad;
 *  sin él, lo más rápido que bajó esta PC). El aporte por seeder sale de lo medido en esta PC
 *  (`health-calib.js`); un leecher aporta una fracción fija. Ordena la lista (`sortOptions`) y da el
 *  ícono de señal. `level`: 0 bueno (≥ 2×), 1 justo (≥ 1×), 2 malo; null sin seeders conocidos o si
 *  nadie respondió. Sin saber cuánto pide (pack sin analizar, sin duración) se usa lo típico de su
 *  resolución (`exact = false`). Tres niveles: la estimación es gruesa; más serían ruido. */
const LEECH_SHARE = 1 / 6;
function health(c) {
  const seeds = knownSeeds(c);
  if (seeds == null || counted.get(c.info_hash)?.reached === false) return null;
  const leech = leechersOf(c) ?? 0;
  const bps = neededBps(c);
  const need = bps ? toMbps(bps) : TYPICAL_MBPS[c.resolution] ?? 3;
  const cal = renderCal ?? healthCalibration(state.library.values());
  // Lo medido de este torrent manda sobre la estimación (2026-11-16): reproduciendo o cargando en
  // background (≥ MIN_SECS), o la medición del análisis.
  const pb = playbackOf(c.info_hash);
  const now = pb && speedOf(pb.key);
  const measuredBps = now?.n >= MIN_SECS ? now.avg : rowsOf(c.info_hash).find((e) => e.live?.avg_speed_bps > 0)?.live.avg_speed_bps;
  const raw = (seeds + leech * LEECH_SHARE) * cal.seedMbps;
  const supply = measuredBps ? toMbps(measuredBps) : cal.capMbps ? Math.min(raw, cal.capMbps) : raw;
  const ratio = supply / need;
  const level = ratio >= 2 ? 0 : ratio >= 1 ? 1 : 2;
  return { level, ratio, supply, need, exact: !!bps, measured: !!measuredBps, seeds, leech, cal };
}

/** Ícono de señal de la salud: solo con los seeders reales contados (análisis profundo). Una
 *  palabra, no "N×": no es una velocidad medida (eso lo da la carga en background). */
function healthBadge(c) {
  if (!counted.get(c.info_hash)?.reached) return null; // sin contar o nadie respondió (ya se ve con ✕)
  const { level, ratio, supply, need, exact, measured, seeds, leech, cal } = health(c);
  const [text, cls, bars] = [['Buena salud', 'cat-health-good', 3], ['Puede cortarse', 'cat-health-fair', 2], ['Mala salud', 'cat-health-risky', 1]][level];
  // Ícono de señal (2026-11-15): tantas barras llenas como el nivel; el cálculo, corto, en el tooltip
  // (el detalle y la calibración, en el botón de velocidad de arriba).
  const verdict = ['sobra el doble de lo que pide', 'alcanza apenas; si la velocidad baja, se corta', 'no alcanza, se va a cortar'][level];
  const internet = cal.capMbps ? ` (tope: tu internet, ${Math.round(cal.capMbps)} Mbps)` : '';
  const asks = exact ? `pide ~${Math.round(need)}` : `un ${resLabel(resKey(c))} suele pedir ~${Math.round(need)} (el tamaño real del episodio se sabe al analizarlo)`;
  const tipText = measured
    ? `${text}: ${verdict}\nMedido: bajó a ~${Math.round(supply)} Mbps y ${asks} (${nf1(ratio)}×).`
    : `${text}: ${verdict}\nLe llegarían ~${Math.round(supply)} Mbps y ${asks} (${nf1(ratio)}×).\n${seeds} seeders y ${leech} leechers × ${nf1(cal.seedMbps)} Mbps por seeder${internet}.\nEs una estimación: cargar en background (⤓) lo mide de verdad.`;
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

/** Menú ▾ de ▶ abierto (hash de la opción) — ahí vive "Cargar en background" (2026-11-16). */
let playMenu = null;
/** ▶ tocado en una opción sin contar: el botón pasa a ofrecer "Analizar primero" o reproducir igual. */
let playAsk = null;
document.addEventListener('click', (ev) => {
  if ((playMenu || playAsk) && !ev.target.closest?.('.cat-split, .cat-ask')) { playMenu = playAsk = null; renderStreamsOnly(); }
});

/** La reproducción de ese torrent que importa ahora: un torrent puede tener varias (otro episodio del
 *  pack, una vieja que se está cerrando); gana la más viva. */
/** Estados en que la opción muestra Detener en vez de ▶. */
const PB_LIVE = new Set(['fetching-metadata', 'preparing', 'playing', 'download-paused', 'background', 'ask-after-close']);
const PB_RANK = ['playing', 'preparing', 'fetching-metadata', 'download-paused', 'ask-after-close', 'background', 'paused', 'stopping', 'failed'];
function playbackOf(hash) {
  return [...lib.playbacks.values()].filter((r) => r.key.split(':')[0] === hash)
    .sort((a, b) => PB_RANK.indexOf(a.state.kind) - PB_RANK.indexOf(b.state.kind))[0];
}

/** Una opción: peso con sus etiquetas, seeders (tocar = analizar), "Analizar" recomendado y ▶ con
 *  menú (cargar en background). */
function optionRow(c, best = false) {
  const light = lightOf(c);
  const bg = bgText(c);
  // Al dar ▶, los estados de la reproducción en la card (2026-11-15).
  const pb = playbackOf(c.info_hash);
  // La de "Cargar en background" la cuenta `bgText` (velocidad y si alcanza).
  const pbStatus = starting.has(c.info_hash) && !pb ? 'preparando…' : pb && !(pb.state.kind === 'background' && bgLoads.has(c.info_hash)) ? playbackText(pb) : null;
  const live = rowsOf(c.info_hash).find((e) => e.live)?.live ?? null;
  const scraped = counted.get(c.info_hash);
  const busy = counting.has(c.info_hash);
  const tip = [c.release_name, c.resolution && `Resolución: ${c.resolution}`, c.file_name && `Archivo: ${c.file_name}`, c.is_pack && 'Pack: varios episodios en un torrent', `Fuentes: ${c.addons.join(' + ')}${c.sites.length ? ` (${c.sites.join(', ')})` : ''}`].filter(Boolean).join('\n');
  const badge = (text, cls = '', title = '') => el('span', { class: `cat-tag ${cls}`, title }, text);
  const hdrTip = c.hdr.map((x) => HDR_TIP[x]).filter(Boolean).join('\n');
  const checked = checkedBy(c);
  const partial = busy ? liveCount.get(c.info_hash) : null; // en vivo mientras cuenta
  const seedsNow = partial?.reached ? partial.seeds : knownSeeds(c);
  const dead = scraped?.reached === false;
  const seedsTip = skipped.has(c.info_hash) && !scraped ? (skipped.get(c.info_hash) === 'dead'
    ? 'No se analizó: los trackers y la fuente dan 0 seeders y 0 leechers (casi seguro muerto). Tocá para analizarlo igual.'
    : `No se analizó a fondo: quedó fuera de los ${TOP} mejores según los trackers. Tocá para analizarlo.`)
    : dead
    ? (scraped.peers ? `Sin respuesta: la red tiene ${scraped.peers} direcciones de peers para este torrent, pero no se pudo conectar con ninguna (direcciones viejas, peers llenos o, lo más común, los dos detrás de un router con el puerto cerrado). No quiere decir que esté muerto. Tocá para reintentar.` : 'Nadie lo está compartiendo ahora (0 peers). Casi seguro muerto. Tocá para analizarlo.')
    : scraped ? `Conectado al enjambre: ${scraped.seeds} seeders (archivo completo) de ${scraped.peers} peers${c.seeders != null ? ` (los trackers anuncian ${c.seeders}, sin verificar)` : ''}. Es lo que respondió de verdad; al reproducir suelen aparecer algunos más. Tocá para analizarlo.`
    : live && live.seeds === 0 ? 'Al analizarlo no se vio ningún seeder conectado (puede ser el momento). Tocá para analizarlo.'
    : live ? `Seeders vistos al analizarlo: ${live.seeds} (${live.peers} peers conectados). Tocá para analizarlo.`
      : checked === 'trackers' ? `${TRACKERS_TIP} ${c.seeders} seeders, ${c.leechers ?? 0} leechers. Tocá para el análisis profundo (se conecta y cuenta los reales).`
        : 'Según la fuente (los trackers no lo conocen o no respondieron). Tocá para el análisis profundo.';
  // "Mejor opción" solo con el análisis profundo terminado (mientras corre, el orden cambia) y salud
  // buena: si no alcanza, no se recomienda (2026-11-16).
  const confirmed = best && counted.has(c.info_hash) && state.side.deep?.status === 'done' && health(c)?.level === 0;
  return el('li', { class: `cat-opt light-${light.cls} ${confirmed ? 'best' : ''} ${skipped.has(c.info_hash) ? 'skipped' : ''}`, title: tip, 'data-hash': c.info_hash,
    // Cada redibujo recrea la fila: la fase sale del reloj para que la animación no reinicie.
    style: busy ? `--live-phase:-${Date.now() % 3600}ms` : null },
    confirmed ? el('span', { class: 'cat-best-tags' }, el('span', { class: 'cat-best-tag' }, 'Mejor opción')) : null,
    el('span', { class: 'cat-size-cell' },
      // Etiquetas chicas al lado del peso (2026-11-16): antes eran una columna propia.
      el('span', { class: 'cat-size-line' }, el('span', { class: 'cat-size' }, humanBytes(c.size_bytes)),
        hdrTip ? badge('HDR', 'cat-hdr', hdrTip) : null, latBadge(c, badge), heavyBadge(c, badge)),
      // Reproduciéndose o bajando (2026-11-16): el estado va en grande al centro; seeds y salud,
      // en chico debajo del peso.
      pbStatus ? el('span', { class: 'cat-mini-stats' }, `${seedsNow ?? '—'} seeds · ${leechersOf(c) ?? 0} leechers`, healthBadge(c))
        : bg ? el('span', { class: `cat-speed bg-${bg.cls}`, title: bg.tip ?? '', role: 'status' }, bg.text)
        : light.text ? el('span', { class: 'cat-speed', title: 'Velocidad medida · margen' }, light.text) : null),
    pbStatus ? statusPill(pb, pbStatus) :
    // Seeds/leechers y, a su derecha, la salud estimada que sale de ellos (2026-11-15).
    el('span', { class: 'cat-stats-cell' }, el('button', {
      id: `cat-seeds-${c.info_hash}`, class: `cat-seeds-btn ${checked === 'deep' ? 'analyzed' : ''} ${dead ? 'dead' : ''} ${busy ? 'busy' : ''}`, title: seedsTip,
      'aria-label': `${seedsNow ?? 'Sin dato de'} seeders: análisis profundo`, 'aria-busy': busy ? 'true' : null, disabled: busy,
      onclick: () => reanalyze([c.info_hash]),
    }, // Seeds primero y grande; leechers y profundidad como una línea chica debajo.
    el('span', { class: 'cat-stat seeds' }, el('span', { class: 'cat-seeds-n' }, seedsNow ?? '—'), el('span', { class: 'cat-stat-label' }, 'seeds'),
      busy ? null // ya lo dice "analizando · N peers" debajo
        : dead && !scraped.peers ? el('span', { class: 'cat-seeds-dead', 'aria-hidden': 'true' }, '✕')
        : checked === 'deep' ? el('span', { class: 'cat-deep-ic', title: 'Análisis profundo: se conectó al enjambre y contó los seeders reales.', role: 'img', 'aria-label': 'Análisis profundo' }, icon('radar', 14))
          : el('span', { class: 'cat-seeds-hint', 'aria-hidden': 'true' }, icon('refresh', 13))),
    // Corto y en una línea (2026-11-16): el punto que late ya dice "analizando"; el detalle, en el tooltip.
    busy ? el('span', { class: 'cat-stat-sub cat-live', title: !partial ? 'Analizando: buscando peers' : partial.reached ? `Analizando: ${partial.peers} peers conectados` : `Analizando: la red tiene ${partial.peers} direcciones de peers; probando conectarse (no todas responden)` },
      el('span', { class: 'cat-live-dot', 'aria-hidden': 'true' }),
      !partial ? 'buscando peers…' : partial.reached ? `${partial.peers} conectados` : `probando ${partial.peers} peers…`)
    : dead && scraped.peers ? el('span', { class: 'cat-stat-sub cat-noanswer' }, 'sin respuesta · ', el('u', {}, 'reintentar'))
    : el('span', { class: 'cat-stat-sub' },
      leechersOf(c) != null ? el('span', { title: 'Leechers: bajando ahora; comparten los pedazos que ya tienen' }, `${leechersOf(c)} leechers`) : null)),
    // Sin analizar (2026-11-16): en lugar del ícono de salud, el botón que la averigua.
    healthBadge(c) ?? (busy || scraped ? null : el('button', { id: `cat-check-${c.info_hash}`, class: 'cat-check-health', title: 'Se conecta al torrent y cuenta los seeders reales (1 a 2 min). No baja el video.', onclick: () => reanalyze([c.info_hash]) }, icon('radar', 14), 'Verificar salud'))),
    el('span', { class: 'cat-opt-actions' },
      playSplit(c)));
}

/** Estado de la reproducción de una opción, en grande (2026-11-16): ícono (o barras que se mueven
 *  si se está viendo), el texto y, si va bajando, la barra de lo bajado. */
function statusPill(pb, text) {
  const k = pb?.state.kind ?? 'preparing';
  const ic = { paused: 'pause', 'download-paused': 'pause', background: 'download', failed: 'ban', 'ask-after-close': 'pause' }[k];
  const lead = k === 'playing' ? el('span', { class: 'cat-eq', 'aria-hidden': 'true' }, el('i'), el('i'), el('i'))
    : ic ? icon(ic, 15) : el('span', { class: 'cat-deep-spin small', 'aria-hidden': 'true' });
  const progress = pb && ['playing', 'background', 'paused', 'download-paused'].includes(k) ? pb.progress ?? 0 : null;
  return el('span', { class: `cat-status st-${k}`, role: 'status' },
    el('span', { class: 'cat-status-line' }, lead, el('b', {}, text.charAt(0).toUpperCase() + text.slice(1))),
    progress != null ? el('span', { class: 'cat-status-bar', title: `${Math.floor(progress * 100)} % bajado` }, el('i', { style: `width:${Math.max(2, Math.round(progress * 100))}%` })) : null);
}

/** ▶ Reproducir con un ▾ al lado: el menú tiene "Cargar en background" (o cancelarla). */
function playSplit(c) {
  const hash = c.info_hash, loading = bgLoads.has(hash), open = playMenu === hash, busy = starting.has(hash);
  // Sin sus seeders reales contados (2026-11-16), ▶ primero pregunta: analizar (recomendado) o reproducir igual.
  if (playAsk === hash) {
    return el('span', { class: 'cat-ask' },
      el('button', { id: `cat-ask-analyze-${hash}`, class: 'cat-ask-analyze', title: 'Recomendado: se conecta al torrent y cuenta los seeders reales (1 a 2 min). No baja el video.',
        onclick: () => { playAsk = null; reanalyze([hash]); } }, icon('radar', 15), 'Analizar primero'),
      el('button', { id: `cat-ask-play-${hash}`, class: 'cat-ask-play', title: 'Reproducir igual, sin analizar', 'aria-label': 'Reproducir igual',
        onclick: (ev) => { playAsk = null; playOption(hash, ev.currentTarget); } }, icon('play', 16)));
  }
  // Reproduciéndose o bajando (2026-11-16): en lugar de ▶, Detener. "Cargar en background" se cancela
  // desde su menú.
  const pb = playbackOf(hash);
  if (pb && PB_LIVE.has(pb.state.kind) && !loading) {
    return el('button', { id: `cat-stop-${hash}`, class: 'cat-stop', title: 'Detener: cierra el reproductor y la descarga queda pausada y guardada',
      onclick: (ev) => { ev.currentTarget.disabled = true; api.playbackAction(pb.id, 'stop').catch(showError); } }, icon('stop', 16), 'Detener');
  }
  const ask = !counted.has(hash) && !counting.has(hash);
  return el('span', { class: `cat-split ${loading ? 'bg-on' : ''}` },
    el('button', { id: `cat-play-${hash}`, class: `cat-play ${busy ? 'busy' : ''}`, title: busy ? 'Preparando la reproducción…' : 'Reproducir ya',
      'aria-label': 'Reproducir', 'aria-busy': busy ? 'true' : null, disabled: busy,
      onclick: (ev) => { if (ask) { ev.stopPropagation(); playMenu = null; playAsk = hash; renderStreamsOnly(); } else playOption(hash, ev.currentTarget); } }, icon('play', 18)),
    el('button', { id: `cat-play-more-${hash}`, class: 'cat-play-more', 'aria-haspopup': 'menu', 'aria-expanded': String(open), 'aria-label': 'Más opciones',
      title: loading ? 'Cargando en background' : 'Más opciones',
      onclick: (ev) => { ev.stopPropagation(); playMenu = open ? null : hash; renderStreamsOnly(); } }, icon('chev', 14)),
    open ? el('div', { class: 'cat-play-menu', role: 'menu' },
      el('button', { id: `cat-bg-${hash}`, role: 'menuitem', onclick: (ev) => { playMenu = null; toggleBg(hash, ev.currentTarget); } },
        icon(loading ? 'stop' : 'download', 15),
        el('span', {}, el('b', {}, loading ? 'Cancelar carga en background' : 'Cargar en background'),
          el('small', {}, loading ? 'Lo bajado queda guardado' : 'Baja sin abrir el reproductor y dice si la velocidad alcanza')))) : null);
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
  const pick = (lang) => () => { subsMenuOpen = false; subsLang = lang; safeSet('streamonte.catalog.subsLang', lang); fetchSubs(); };
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
    // Detenido por el usuario: lo que no llegó a contarse queda sin contar (no "nadie respondió").
    for (const h of todo) {
      if (found[h] || !stopped.has(h)) counted.set(h, found[h] ?? { seeds: 0, peers: 0, reached: false });
      deepDone.add(h);
      stopped.delete(h);
    }
    if (todo.length === 1 && !found[todo[0]]) setStatus('No se pudo contar ese torrent: nadie respondió a tiempo.');
  } catch (e) { showError(e); } finally {
    todo.forEach((h) => { counting.delete(h); liveCount.delete(h); });
    const d = state.side?.deep;
    if (d?.single && !counting.size) Object.assign(d, { status: d.after, single: false, hashes: [] });
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
const DEEP_ETA = '1 a 4 min'; // 10 a la vez: metadatos hasta 90 s mientras haya novedades + conteo hasta 85 s
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
    // El panel de arriba muestra también los sueltos (2026-11-16): durante un lote suman a su "N de
    // M"; sin lote, el panel pasa a "Analizando N" y al terminar vuelve a lo que había (el usuario no
    // eligió analizar en lote).
    const d = state.side?.deep;
    if (d && d.status !== 'run') Object.assign(d, { status: 'run', single: true, after: d.status, hashes: [] });
    if (d && !d.hashes.includes(hashes[0])) { d.hashes.push(hashes[0]); deepDone.delete(hashes[0]); }
    countSeeds(hashes);
  } else {
    runDeep(video, res);
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
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const now = performance.now();
  let fresh = 0;
  for (const n of rows()) {
    const hash = n.dataset.hash, old = before.get(hash);
    // Filas nuevas (llegan de las fuentes o se abrió el grupo): entran deslizándose, escalonadas.
    if (!old) n.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: Math.min(fresh++, 10) * 35, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
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
  if (!u || !u.done) {
    // Esqueleto con forma de fila hasta que terminan fuentes y trackers (2026-11-16): antes los
    // números no son finales y la lista se reacomodaba a la vista. Mientras llegan torrents solo se
    // cambia el encabezado: el esqueleto queda en la página y su animación sigue sin reiniciarse.
    const head = el('div', { class: 'cat-sticky' }, optionsHead());
    const sticky = box.querySelector(':scope > .opt-skeleton') && box.querySelector(':scope > .cat-sticky');
    if (sticky) { sticky.replaceWith(head); return; }
    box.replaceChildren(head, el('div', { class: 'opt-skeleton', 'aria-busy': 'true' }, Array.from({ length: 6 }, (_, i) =>
      el('div', { class: 'opt-skel', style: `animation-delay:${i * 70}ms` },
        el('span', { class: 'skel tall' }), el('span', { class: 'skel' }), el('span', { class: 'skel' }), el('span', { class: 'skel pill' })))));
    return;
  }
  box.replaceChildren();
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
    renderStreamsOnly();
    if (openRes) document.getElementById(`cat-group-${r}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  box.append(el('div', { class: 'cat-sticky' }, optionsHead()));
  if (!present.length) { box.append(el('p', { class: 'pop-empty' }, 'Ninguna opción con HDR / Dolby Vision.')); return; }
  box.append(...present.map((r) => {
    const open = r === openRes;
    // Mientras corre el análisis profundo, el borde del grupo abierto gira (2026-11-16).
    const analyzing = open && state.side.deep?.status === 'run';
    return el('section', { class: `cat-group ${open ? 'open' : ''} ${analyzing ? 'analyzing' : ''}`, id: `cat-group-${r}`, 'aria-busy': analyzing ? 'true' : null,
      style: analyzing ? `--group-phase:-${Date.now() % 4000}ms` : null },
      el('button', { id: `cat-res-${r}`, class: 'cat-group-head', 'aria-expanded': String(open), onclick: () => toggle(r) },
        el('span', { class: 'cat-group-name' }, resLabel(r)),
        el('span', { class: 'cat-res-count' }, `${groups.get(r).length} ${groups.get(r).length === 1 ? 'opción' : 'opciones'}`),
        el('span', { class: 'cat-chev' }, icon('chev', 18))),
      open ? (() => {
        const { list: sorted, best } = sortOptions(groups.get(r));
        return el('ul', { class: 'cat-options' }, sorted.map((c) => optionRow(c, c === best)));
      })() : null);
  }));
  if (body) body.scrollTop = scroll;
}

/** Análisis profundo (2026-11-15): los trackers ya respondieron al cargar las opciones (el núcleo
 *  los consulta solo), así que de ahí sale el orden: se descartan los `unlikely` y se cuentan a
 *  fondo, todos a la vez, los `TOP` mejores. El progreso va en `state.side.deep.hashes` / `deepDone`. Se
 *  corta al salir del video. */
async function runDeep(video, res) {
  const d = state.side.deep;
  if (d.status === 'run') return;
  d.status = 'run';
  d.res = res;
  const all = (state.update?.candidates ?? []).filter((c) => inScope(c, res));
  const todo = all.filter((c) => !counted.has(c.info_hash) && !counting.has(c.info_hash));
  todo.forEach((c) => skipped.delete(c.info_hash)); // reanalizar decide de nuevo
  todo.filter(unlikely).forEach((c) => skipped.set(c.info_hash, 'dead'));
  // Solo los TOP mejores según los trackers (más abajo casi nunca se ven bien).
  const ranked = todo.filter((c) => !skipped.has(c.info_hash)).sort((a, b) => (seedsOf(b) ?? -1) - (seedsOf(a) ?? -1));
  ranked.slice(TOP).forEach((c) => skipped.set(c.info_hash, 'rest'));
  d.hashes = ranked.slice(0, TOP).map((c) => c.info_hash);
  deepDone.clear();
  renderStreamsOnly();
  if (d.hashes.length) await countSeeds(d.hashes);
  // Detenido: vuelve a ofrecer el análisis en lote; si no, queda hecho para esa resolución.
  if (state.side?.deep === d) { d.status = d.stopped ? null : 'done'; d.stopped = false; renderStreamsOnly(); }
  // Los finalistas, además, con análisis rápido (metadatos, duración, idiomas reales).
  if (state.side?.videoId === video) quickAnalyze(finalists(all));
}

/** Grupos de resolución (2026-11-15): 4K, 1080p, 720p y "Otras" (1440p, SD y sin dato). */
const RES_ORDER = ['2160p', '1080p', '720p', 'other'];
const resKey = (c) => (['2160p', '1080p', '720p'].includes(c.resolution) ? c.resolution : 'other');
const resLabel = (r) => ({ '2160p': '4K', other: 'Otras' }[r] ?? r);
/** Grupo de resolución abierto (uno a la vez). Cada video arranca con la mejor que tenga (2026-11-16). */
let openRes = null;

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
    el('div', { class: 'key-line' }, input,
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
// La primera vez: "películas con mejor puntaje IMDb de hace 1 año a hoy con 50.000+ votos en inglés
// o español de todos los géneros". Después, los últimos usados, también entre aperturas de la app
// (`FILTER_KEYS`, pedido 2026-11-16). Los filtros valen para cualquier tipo y orden.
const browse = {
  kind: 'movie',
  sort: 'rating',
  // Género de Cinemeta (solo `Documentary`, para "documentales").
  genre: null,
  // Hay key de TMDB (se consulta al pedir la primera página). Sin key (2026-11-16) se muestra lo que
  // está en tendencia (Cinemeta, gratis) y se invita a cargarla para los filtros. null = no se sabe.
  tmdb: null,
  // Filtros de IMDb: piso de votos e idioma original.
  minVotes: 50000,
  langs: ['en', 'es'],
  // Rango móvil en meses hacia atrás (0 = hoy), con la ruedita.
  backFrom: 12,
  backTo: 0,
  // Géneros elegidos (badges): filtran lo ya cargado, sin pedir de nuevo. Vacío = todos.
  genres: [],
  items: [], shown: 0, skip: 0, hasMore: true, loading: false, error: null, gen: 0,
};
/** Lo que se recuerda de `browse` (el resto es estado de la carga). */
const FILTER_KEYS = ['kind', 'sort', 'genre', 'minVotes', 'langs', 'backFrom', 'backTo', 'genres'];
const FILTERS_STORE = 'streamonte.catalog.filters';
try {
  const saved = JSON.parse(safeGet(FILTERS_STORE) ?? '{}');
  // Solo valores del mismo tipo que el default (`genre` puede ser null o texto): algo viejo o roto no rompe la lista.
  const fits = (v, d) => (d === null ? v === null || typeof v === 'string' : typeof v === typeof d && Array.isArray(v) === Array.isArray(d));
  for (const k of FILTER_KEYS) if (k in saved && fits(saved[k], browse[k])) browse[k] = saved[k];
} catch { /* guardado ilegible: quedan los de fábrica */ }
const saveFilters = () => safeSet(FILTERS_STORE, JSON.stringify(Object.fromEntries(FILTER_KEYS.map((k) => [k, browse[k]]))));

/** Un solo temporizador para todos los filtros (pedido 2026-11-15): cualquier cambio (menú, clic en
 *  la lista o ruedita) lo reinicia, y la lista se pide una vez, SPIN_APPLY_MS después del último.
 *  Al vencer se aplican también los cambios de ruedita pendientes. Mientras, lo anterior se atenúa. */
let browseTimer = null;
function scheduleLoad(wait) {
  clearTimeout(browseTimer);
  browseTimer = setTimeout(() => {
    browseTimer = null;
    flushSpins();
    if (!browse.items.length) loadMore(); // sin cambios reales (volvió al valor que tenía) no se pide de nuevo
  }, wait);
}

/** `wait`: cuánto esperar antes de pedir; `null` = no programa nada (lo hace quien llama). */
function setBrowse(changes, wait = SPIN_APPLY_MS) {
  // Cambios de ruedita pendientes en otras píldoras: se asientan antes de que el redibujo las borre.
  if (wait !== null && pendingSpins.size) flushSpins();
  // Lo que se veía queda atenuado hasta que llega lo nuevo (sin vaciar la pantalla).
  // `gen` invalida lo que esté cargando con el filtro anterior.
  toTop();
  Object.assign(browse, changes);
  saveFilters();
  Object.assign(browse, { items: [], shown: 0, skip: 0, hasMore: true, error: null, loading: false, gen: browse.gen + 1 });
  if (wait !== null) scheduleLoad(wait);
  render();
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
      // La key se puede cargar o borrar en Ajustes en cualquier momento: se mira en cada lista nueva.
      if (!browse.skip) {
        const tmdb = (await api.apiKeys()).some((k) => k.service === 'tmdb' && k.configured);
        if (gen !== browse.gen) return;
        if (tmdb !== browse.tmdb) { browse.tmdb = tmdb; renderFilters(); }
      }
      const from = isoDay(monthsAgo(browse.backFrom)), to = browse.backTo ? isoDay(monthsAgo(browse.backTo)) : null;
      const page = browse.tmdb
        ? await api.catalogBrowseTop(browse.kind, browse.sort, from, to, browse.minVotes, browse.langs, browse.genre)
        : await api.catalogTrending(browse.kind, browse.genre, browse.skip);
      if (gen !== browse.gen) return; // cambió el filtro: otra carga ya está en curso
      const seen = new Set(browse.items.map((p) => p.id));
      browse.items.push(...page.items.filter((p) => !seen.has(p.id)));
      browse.skip += page.items.length;
      browse.hasMore = page.has_more && page.items.length > 0;
    } catch (e) {
      if (gen !== browse.gen) return;
      browse.error = e?.message ?? String(e);
      browse.hasMore = false;
    } finally {
      if (gen === browse.gen) browse.loading = false;
    }
  }
  browse.shown += PAGE;
  render();
}

function browseItems() {
  let list = browse.items.filter((p) => !(state.hideJapanese && p.excluded));
  // Alcanza con que tenga uno de los géneros elegidos (Cinemeta no trae géneros: solo con TMDB).
  if (browse.tmdb && browse.genres.length) list = list.filter((p) => p.genres?.some((g) => browse.genres.includes(g)));
  return list;
}

// ---------- frase de filtros (pedido 2026-11-15, diseño design/filtros-frase.html) ----------
// "Mostrando [películas] [con mejor puntaje IMDb] de [hace 1 año] a [hoy] con [votos] en [idioma]
// de [géneros]": cada palabra abre su menú o gira con la ruedita.
const MIN_YEAR = 1950;
const thisYear = () => new Date().getFullYear();
const isoDay = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
/** Rango móvil "de hace N a hace M" en meses, cambiado con la ruedita (pedido 2026-11-15). */
/** Pasos de la ruedita en meses hacia atrás: hoy, 1…11 meses, después de a 1 año hasta 1950. */
const BACK_STEPS = [...Array.from({ length: 12 }, (_, i) => i), ...Array.from({ length: thisYear() - MIN_YEAR }, (_, i) => (i + 1) * 12)];
const backLabel = (m) => (m === 0 ? 'hoy' : m < 12 ? `hace ${m} ${m === 1 ? 'mes' : 'meses'}` : `hace ${m / 12} ${m === 12 ? 'año' : 'años'}`);
const monthsAgo = (m) => { const d = new Date(); d.setMonth(d.getMonth() - m); return d; };
const VOTE_STEPS = [0, 1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000];
const LANGS = [['en,es', 'inglés o español'], ['', 'cualquier idioma']];
const votesLabel = (v) => (v ? `${v.toLocaleString('es-AR')}+ votos` : 'cualquier cantidad de votos');
const NEEDS_TMDB = 'Key de TMDB: es gratis y en un minuto la tenés. Con ella filtrás por fecha, votos de IMDb, idioma y géneros, y aparecen pósters que faltan.\nClic para cargarla en Ajustes.';
/** Abre Ajustes en la key de TMDB; al cerrarlos se vuelve a pedir la lista (la key pudo cambiar). */
async function askTmdbKey() {
  $('#dlg-settings').addEventListener('close', () => setBrowse({ tmdb: null }), { once: true });
  await openSettings();
  const input = $('#key-tmdb');
  input?.scrollIntoView({ block: 'center' });
  input?.focus();
}

const KINDS = [
  { label: 'películas', kind: 'movie', genre: null },
  { label: 'series', kind: 'series', genre: null },
  { label: 'documentales', kind: 'movie', genre: 'Documentary' },
];
const BROWSE_SORTS = [
  ['popular', 'más populares en IMDb'],
  ['rating', 'con mejor puntaje IMDb'],
];
/** Popover de géneros abierto ('genres' | null). */
let menu = null;

/** Filtro de lista (2026-11-16, reemplaza a la ruedita): una píldora que abre hacia abajo su
 *  lista de opciones, de alto moderado. La ruedita sobre la píldora (o ↑ ↓) mueve la elegida de a
 *  una y la lista se corre sola cuando llega a un borde; sobre la lista, scrollea normal. Un clic en una opción la elige y cierra.
 *  El cambio queda pendiente y se aplica con el temporizador compartido de los filtros
 *  (`scheduleLoad`), con Enter, o al vencer; una barra en la píldora muestra cuánto falta. */
// Clic afuera cierra la lista abierta (un cambio pendiente se aplica igual al vencer la espera).
document.addEventListener('click', (ev) => {
  for (const n of document.querySelectorAll('.picker.open')) if (!n.contains(ev.target)) n.classList.remove('open');
});
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const SPIN_APPLY_MS = 2500;
/** Tocar otro filtro cierra la lista del anterior y deja su cambio pendiente; todos se aplican
 *  juntos al vencer el temporizador compartido (`scheduleLoad`). */
const pendingSpins = new Map(); // píldora → asentar su cambio (sin pedir)
function flushSpins() {
  const commits = [...pendingSpins.values()];
  pendingSpins.clear();
  for (const commit of commits) commit();
}
/** `name`: id de la píldora; `labels[k]`: texto de cada opción; `apply(k)`: asentar la elegida. */
function picker(name, labels, index, apply, lo = 0, hi = labels.length - 1) {
  let i = Math.min(hi, Math.max(lo, index)), acc = 0, progress = null;
  const label = el('span', { class: 'picker-label' }, labels[i]);
  const bar = el('span', { class: 'picker-bar', 'aria-hidden': 'true' });
  const rows = [];
  for (let k = lo; k <= hi; k++) {
    rows.push(el('span', {
      id: `cat-${name}-opt-${k}`, class: 'picker-item', role: 'option', 'aria-selected': String(k === i),
      onclick: (ev) => { ev.stopPropagation(); show(k); pend(); close(); },
    }, labels[k]));
  }
  const list = el('span', { class: 'picker-list', role: 'listbox' }, rows);
  const node = el('button', {
    id: `cat-word-${name}`, class: 'cat-word picker', 'aria-haspopup': 'listbox', 'aria-expanded': 'false',
    onclick: () => (node.classList.contains('open') ? close() : open()),
  }, label, bar, list);
  const row = () => rows[i - lo];
  // Que la elegida se vea: centrada al abrir; al moverla, la lista se corre solo si llega a un borde.
  const reveal = (center) => {
    const r = row();
    const top = center ? r.offsetTop - (list.clientHeight - r.offsetHeight) / 2
      : r.offsetTop < list.scrollTop ? r.offsetTop
        : r.offsetTop + r.offsetHeight > list.scrollTop + list.clientHeight ? r.offsetTop + r.offsetHeight - list.clientHeight
          : null;
    if (top !== null) list.scrollTo({ top, behavior: center || reduceMotion() ? 'auto' : 'smooth' });
  };
  const open = () => {
    for (const n of document.querySelectorAll('.picker.open')) if (n !== node) n.classList.remove('open');
    if (!node.classList.contains('open')) { node.classList.add('open'); node.setAttribute('aria-expanded', 'true'); reveal(true); }
  };
  const close = () => { node.classList.remove('open'); node.setAttribute('aria-expanded', 'false'); };
  const commit = () => { close(); progress?.cancel(); node.classList.remove('pending'); apply(i); };
  const show = (n) => {
    i = n;
    label.textContent = labels[i];
    rows.forEach((r, k) => r.setAttribute('aria-selected', String(k + lo === i)));
    reveal(false);
  };
  // Elegir o mover deja el cambio pendiente y reinicia la espera de todos los filtros.
  const pend = () => {
    pendingSpins.set(node, commit);
    node.classList.add('pending');
    scheduleLoad(SPIN_APPLY_MS);
    progress?.cancel();
    progress = bar.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: SPIN_APPLY_MS, easing: 'linear' });
  };
  const step = (d) => {
    open();
    const n = Math.min(hi, Math.max(lo, i + d));
    if (n !== i) { show(n); pend(); }
  };
  // Se acumula el desplazamiento: un "click" de rueda es ~100; los touchpads mandan muchos pasos chicos.
  node.addEventListener('wheel', (ev) => {
    if (list.contains(ev.target)) return; // dentro de la lista abierta: scroll normal
    ev.preventDefault();
    acc += ev.deltaY;
    if (Math.abs(acc) < 50) return;
    step(acc > 0 ? 1 : -1);
    acc = 0;
  }, { passive: false });
  node.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); step(ev.key === 'ArrowDown' ? 1 : -1); }
    else if (ev.key === 'Enter' && pendingSpins.size) { ev.preventDefault(); ev.stopPropagation(); scheduleLoad(0); }
    else if (ev.key === 'Escape' && node.classList.contains('open')) {
      show(Math.min(hi, Math.max(lo, index)));
      pendingSpins.delete(node);
      node.classList.remove('pending');
      progress?.cancel();
      close();
    }
  });
  return node;
}

/** Inicio o fin del rango móvil (abajo = más atrás); si se cruzan, el otro extremo se corre. */
function backPicker(which) {
  const key = which === 'from' ? 'backFrom' : 'backTo';
  const lo = which === 'from' ? 1 : 0, hi = BACK_STEPS.length - (which === 'from' ? 1 : 2);
  return picker(which, BACK_STEPS.map(backLabel), BACK_STEPS.indexOf(browse[key]), (i) => {
    const v = BACK_STEPS[i];
    if (v === browse[key]) return;
    const next = (x) => BACK_STEPS.find((y) => y > x), prev = (x) => BACK_STEPS.findLast((y) => y < x);
    if (which === 'from') setBrowse({ backFrom: v, backTo: Math.min(browse.backTo, prev(v)) }, null);
    else setBrowse({ backTo: v, backFrom: Math.max(browse.backFrom, next(v)) }, null);
  }, lo, hi);
}

/** Géneros como badges (multi-selección); el número es cuántas de la lista cargada lo tienen. */
const GENRE_NAMES = ['Acción', 'Aventura', 'Animación', 'Comedia', 'Crimen', 'Documental', 'Drama', 'Familia', 'Fantasía', 'Historia', 'Terror', 'Música', 'Misterio', 'Romance', 'Ciencia ficción', 'Suspenso', 'Bélica', 'Western', 'Película de TV'];
function genresLabel() {
  const g = browse.genres;
  if (!g.length) return 'todos los géneros';
  return g.length <= 2 ? g.join(' o ') : `${g.length} géneros`;
}
function setGenres(genres) {
  browse.genres = genres;
  saveFilters();
  render(); // filtra lo cargado: no hace falta pedir de nuevo
}
function genreMenu() {
  const counts = new Map();
  for (const p of browse.items) if (!(state.hideJapanese && p.excluded)) for (const g of p.genres ?? []) counts.set(g, (counts.get(g) ?? 0) + 1);
  const chips = GENRE_NAMES.map((g) => {
    const on = browse.genres.includes(g), n = counts.get(g) ?? 0;
    return el('button', {
      id: `cat-genre-${g}`, class: `cat-chip genre ${on ? 'on' : ''} ${n ? '' : 'empty'}`, 'aria-pressed': String(on),
      onclick: () => setGenres(on ? browse.genres.filter((x) => x !== g) : [...browse.genres, g]),
    }, g, el('span', { class: 'n' }, ` · ${n}`));
  });
  return [el('div', { class: 'cat-genres' }, chips),
    browse.genres.length ? el('button', { id: 'cat-genres-clear', class: 'cat-more-link', onclick: () => setGenres([]) }, 'Quitar géneros') : null];
}

function sentence(searching) {
  // Géneros: multi-selección con chips en un popover (los demás filtros son `picker`).
  const genresWord = () => el('span', { class: 'cat-dd' },
    el('button', {
      id: 'cat-word-genres', class: `cat-word ${menu === 'genres' ? 'open' : ''}`, 'aria-haspopup': 'menu', 'aria-expanded': String(menu === 'genres'),
      onclick: () => { menu = menu === 'genres' ? null : 'genres'; renderFilters(); },
    }, genresLabel()),
    menu === 'genres' ? el('div', { id: 'cat-pop-genres', class: 'cat-pop genres', role: 'menu' }, genreMenu()) : null);
  const kind = KINDS.find((k) => k.kind === browse.kind && k.genre === browse.genre) ?? KINDS[0];
  if (searching) return el('div', { class: 'cat-sentence' }, 'Películas y series');
  const lang = LANGS.find(([v]) => v === browse.langs.join(','))?.[1] ?? LANGS[0][1];
  // Cada conector va pegado a su píldora: al partirse la línea no queda un "con" suelto al final.
  const pair = (text, node) => el('span', { class: 'cat-pair' }, text, node);
  const kindIdx = KINDS.indexOf(kind);
  const sortIdx = Math.max(0, BROWSE_SORTS.findIndex(([v]) => v === browse.sort));
  const votesIdx = Math.max(0, VOTE_STEPS.findIndex((v) => v >= browse.minVotes));
  const langIdx = Math.max(0, LANGS.findIndex(([v]) => v === browse.langs.join(',')));
  const kindPicker = () => picker('kind', KINDS.map((k) => k.label), kindIdx, (i) => i !== kindIdx && setBrowse({ kind: KINDS[i].kind, genre: KINDS[i].genre }, null));
  // Sin key de TMDB: lo que está en tendencia y una invitación a la key para los filtros.
  if (browse.tmdb === false) return el('div', { class: 'cat-sentence' },
    pair('Mostrando', kindPicker()), 'en tendencia ahora',
    el('button', { id: 'cat-tmdb-cta', class: 'cat-tmdb-cta', title: NEEDS_TMDB, onclick: askTmdbKey },
      icon('lock', 13), 'Filtrá por fecha, votos, idioma y géneros', el('span', { class: 'cat-tmdb-cta-key' }, 'key gratis de TMDB'), icon('arrow', 13)));
  return el('div', { class: 'cat-sentence' },
    pair('Mostrando', kindPicker()),
    picker('sort', BROWSE_SORTS.map(([, l]) => l), sortIdx, (i) => i !== sortIdx && setBrowse({ sort: BROWSE_SORTS[i][0] }, null)),
    pair('de', backPicker('from')), pair('a', backPicker('to')),
    pair('con', picker('votes', VOTE_STEPS.map(votesLabel), votesIdx, (i) => i !== votesIdx && setBrowse({ minVotes: VOTE_STEPS[i] }, null))),
    pair('en', picker('lang', LANGS.map(([, l]) => l), langIdx, (i) => i !== langIdx && setBrowse({ langs: LANGS[i][0].split(',').filter(Boolean) }, null))),
    pair('de', genresWord()));
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
  const waiting = browse.loading || !!browseTimer;
  // Cargando (2026-11-16): esqueletos de tarjeta; si ya hay tarjetas, una fila más al final.
  if (items.length) root.append(el('div', { class: 'cat-grid' }, items.map(cardFor)));
  if (waiting) root.append(skeletonGrid(items.length ? 6 : 12));
  if (browse.error) root.append(el('p', { class: 'hint' }, browse.error));
  else if (!items.length && !waiting) root.append(el('p', { class: 'hint' }, 'No hay títulos con ese filtro.'));
  if (waiting && !items.length && browse.tmdb) root.append(el('p', { class: 'hint' }, 'La primera vez baja los puntajes de IMDb y las fichas de TMDB: puede tardar medio minuto.'));
  else if (!waiting && (browse.hasMore || browseItems().length > browse.shown)) {
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
    if (!browse.items.length && browse.hasMore && !browse.loading && !browseTimer) loadMore();
    renderBrowse(root);
  }
}

async function init() {
  $('#catalog').append(
    el('div', { class: 'cat-main' },
      // Buscador y filtros en la barra fija (siempre visibles al bajar, 2026-11-15).
      el('div', { id: 'cat-bar', class: 'cat-bar' },
        el('div', { class: 'cat-search' },
          el('input', { id: 'cat-q', type: 'search', placeholder: 'Buscar película o serie…', autocomplete: 'off', oninput: onQueryInput })),
        el('div', { id: 'cat-filters' })),
      el('div', { id: 'cat-body' })),
    el('aside', { id: 'cat-side', class: 'cat-side', 'aria-label': 'Opciones' }));
  const main = $('#catalog .cat-main');
  main.addEventListener('scroll', () => $('#cat-bar').classList.toggle('scrolled', main.scrollTop > 4), { passive: true });
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
  // Reproducciones (2026-11-16): se dibujan con lo que app.js ya guardó en `lib.playbacks` (avisa con
  // `playback-changed` después de guardar). Oír el evento del núcleo directo dibujaba a veces con la
  // fila vieja ("preparando 0 %" reproduciendo, o una pausada ya borrada): el orden entre oyentes
  // no está garantizado.
  window.addEventListener('playback-changed', ({ detail: event }) => {
    if (event.type === 'playback-removed') { if (state.update) renderStreamsOnly(); return; }
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
  });
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
      default: break;
    }
  });
  render();
}

init().catch(showError);
