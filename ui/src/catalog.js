// Catálogo (F4b, spec 09 §11): Buscar / Explorar → al tocar una película o serie se abre un panel
// a la derecha (pedido 2026-11-15). Película: sus opciones. Serie: Serie › Temporada › Episodio ›
// opciones, como migas de pan. Cada opción: análisis profundo, cargar en background o Reproducir.
// Explorar (2026-11-20, como la web): tipo, orden, "Estrenos desde" con atajos y una línea de tiempo que se arrastra,
// y los filtros avanzados (géneros de TMDB, votos, idioma) en un desplegable con su resumen; scroll infinito.
// Todo texto que viene de Cinemeta o de los addons entra como texto, nunca como HTML (NFR-24).

import { api, onCoreEvent } from './api.js';
import { play } from './audio-picker.js';
import { openSettings } from './dialogs.js';
import { $, el, icon, setStatus } from './dom.js';
import { humanBytes, playbackText } from './format.js';
import { locale, t } from './i18n.js';
import { bgText, cardSig, measurePlayback, onPlaybackRow, onStreams, renderStreamsOnly, starting } from './catalog-options.js';
import { magnetHash, openMagnet } from './catalog-magnet.js';
import { subsProgress } from './catalog-subs.js';
import { closeSide, genreName, openSide, renderSide, seasonMini, seasonOutlook } from './catalog-side.js';
import { safeGet, safeSet, showError, state, view } from './catalog-state.js';
import { onSwarmEvent } from './catalog-tests.js';
import { isTouring } from './welcome.js';

let searchSeq = 0;
let searchTimer = null;

/** Una lista nueva (búsqueda o filtros) arranca desde arriba. */
export const toTop = () => document.querySelector('.cat-main')?.scrollTo({ top: 0 });
export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- búsqueda (FR-36) ----------
/** Se pide recién cuando se deja de tipear un momento (2026-11-16: no un pedido por letra). */
const SEARCH_WAIT_MS = 900;
function onQueryInput() {
  clearTimeout(searchTimer);
  searchSeq++; // lo que esté en vuelo ya no se muestra
  const raw = $('#cat-q').value;
  $('#cat-q-clear').hidden = !raw;
  // Un magnet pegado en el buscador va al mismo camino que "Pegados" (2026-11-20), no se busca como texto.
  if (/^\s*magnet:\?/i.test(raw)) { pasteMagnet(raw.trim()); return; }
  const q = raw.trim();
  if (q.length < 2) { state.results = null; state.searching = false; render(); return; }
  if (!state.searching) { state.searching = true; render(); toTop(); }
  searchTimer = setTimeout(() => search(q), SEARCH_WAIT_MS);
}

/** Vuelve al catálogo con los filtros, arriba de todo. */
function clearSearch() {
  $('#cat-q').value = '';
  onQueryInput();
  toTop();
}

/** Magnet pegado en el buscador: se agrega a Pegados; con TorBox, además se abre lo que TorBox sabe de él. */
async function pasteMagnet(raw) {
  $('#cat-q').value = '';
  $('#cat-q-clear').hidden = true;
  if (state.results || state.searching) { state.results = null; state.searching = false; render(); }
  try {
    await api.addSelected([raw]);
    setStatus(t('Magnet pegado: queda en Pegados.'));
    const hash = magnetHash(raw);
    if (hash && view.torboxKey) openMagnet(hash, new URLSearchParams(raw.split('?')[1] ?? '').get('dn') ?? '');
  } catch (e) { showError(e); }
}

async function search(q) {
  const seq = ++searchSeq;
  setStatus(t('Buscando "{q}"…', { q }));
  try {
    const r = await api.catalogSearch(q);
    if (seq !== searchSeq) return;
    state.searching = false;
    state.results = r;
    setStatus(r.length ? t('Elegí una película o serie.') : t('No encontré "{q}". Probá con el título en inglés.', { q }));
    render();
  } catch (e) {
    if (seq === searchSeq) { state.searching = false; render(); showError(e); }
  }
}

// ---------- tarjetas ----------
/** Cards ya armadas, por título: re-renderizar no recrea los <img> (no recargan ni parpadean). */
const cards = new Map();
/** Entrada de cada tarjeta (2026-11-20, como la web): se da vuelta como una figurita apenas asoma, escalonada con las
 *  que entran juntas, y el puntaje cuenta hasta su valor. Las que llegan scrolleando, una entrada más corta. Solo
 *  transform y opacity; con movimiento reducido, nada. Mientras la bienvenida tapa la portada, esperan. */
const waiting = new Set();
const counting = new WeakMap();
const seen = new IntersectionObserver((entries) => {
  if (isTouring()) return;
  const scrolled = (document.querySelector('.cat-main')?.scrollTop ?? 0) > 0;
  let i = 0;
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    seen.unobserve(e.target);
    waiting.delete(e.target);
    playEntry(e.target, Math.min(i++, 12), scrolled);
  }
});
function playEntry(card, i, late) {
  card.classList.toggle('late', late);
  card.style.setProperty('--i', String(i));
  card.style.setProperty('--play', 'running');
  // Terminada la entrada (la última animación es el pop del número), se saca: re-insertarla no la repite.
  setTimeout(() => card.classList.remove('enter', 'late'), (late ? 900 : 2300) + i * 70);
  const text = card.querySelector('.num')?.firstChild;
  const end = Number(text?.nodeValue);
  if (!(end > 0)) return;
  const start = performance.now() + i * 70 + 500;
  let last = '', wrote = 0;
  const tick = (now) => {
    const p = Math.min(1, Math.max(0, (now - start) / 700));
    // Solo toca el DOM cuando cambia el número y cada ~60 ms.
    const v = (end * (1 - (1 - p) ** 3)).toFixed(1);
    if (v !== last && (p === 1 || now - wrote > 60)) { text.nodeValue = last = v; wrote = now; }
    if (p < 1) counting.set(card, requestAnimationFrame(tick));
  };
  counting.set(card, requestAnimationFrame(tick));
}
/** Termina la bienvenida: las que esperaban tapadas entran ahora. */
window.addEventListener('welcome-done', () => {
  for (const n of waiting) { seen.unobserve(n); seen.observe(n); }
  const cat = $('#catalog');
  cat.classList.add('intro');
  setTimeout(() => cat.classList.remove('intro'), 1500);
});

function cardFor(p) {
  let card = cards.get(p.id);
  if (!card) {
    if (cards.size > 600) cards.clear(); // shortcut: tope simple, alcanza para varias páginas
    card = posterCard(p);
    if (!reduceMotion()) {
      card.classList.add('enter');
      seen.observe(card);
      waiting.add(card);
    }
    cards.set(p.id, card);
  }
  card.classList.toggle('active', state.side?.id === p.id);
  return card;
}

function posterCard(p) {
  // Sin póster (Cinemeta no tiene imagen para muchos títulos nuevos): uno dibujado con el título.
  const hue = [...p.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const noPoster = () => el('div', { class: 'cat-noposter', style: `--hue:${hue}` },
    el('span', { class: 'cat-noposter-title' }, p.name), p.year ? el('span', { class: 'cat-noposter-year' }, p.year) : null);
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
    id: `cat-card-${p.id}`, class: `cat-card ${state.side?.id === p.id ? 'active' : ''}`, 'data-id': p.id,
    onclick: () => openSide(p.kind, p.id, p.name),
    // Detalles al detenerse un momento encima (no al pasar de largo): la ficha queda en caché.
    onmouseenter: () => { if (!info.childElementCount) hoverT = setTimeout(() => fillCardInfo(info, p), 250); },
    onmouseleave: () => clearTimeout(hoverT),
  },
  // Título y año sobre el póster, con un degradado chico siempre visible (2026-11-16).
  el('span', { class: 'cat-poster' }, img,
    el('span', { class: 'cat-card-caption' }, el('span', { class: 'cat-card-name' }, p.name),
      el('span', { class: 'cat-card-year' }, p.year,
        p.imdb_rating ? [p.year ? ' · ' : null, el('span', { class: 'cat-card-rate' }, icon('star', 11), el('span', { class: 'num' }, p.imdb_rating))] : null)),
    info));
}

/** Categoría por puntaje de IMDb (2026-11-17, tabla del usuario). Las series puntúan más alto en
 *  IMDb, por eso sus cortes son otros. `[corte película, corte serie, emoji, nombre]`, de mayor a menor. */
const RATING_TIERS = [
  [8.5, 9.0, '🎞️', 'Clásico eterno'],
  [8.0, 8.6, '🏆', 'De Óscar'],
  [7.5, 8.3, '👏', 'Ovación de pie'],
  [7.0, 8.0, '🎟️', 'Vale la entrada'],
  [6.5, 7.6, '🍿', 'Pochoclera'],
  [6.0, 7.2, '🛋️', 'Peli de domingo'],
  [5.0, 6.5, '🎲', 'Depende del gusto'],
  [4.0, 5.5, '🧩', 'Para fans del género'],
  [-Infinity, -Infinity, '🎉', 'De culto entre amigos'],
];
function ratingTier(kind, rating) {
  const r = Number(rating);
  if (!(r > 0)) return null;
  return RATING_TIERS.find(([movie, series]) => r >= (kind === 'series' ? series : movie));
}

/** Detalles sobre el póster al pasar el mouse (2026-11-16): géneros, puntaje y premios, sobre un degradado a oscuro.
 *  Sale de la ficha (Cinemeta, guardada en la caché de datos). */
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
  // replaceChildren escribe null como texto: se filtran los ausentes.
  info.replaceChildren(...[
    m.genres.length ? el('span', { class: 'cat-info-genres' }, m.genres.slice(0, 3).map((g) => el('span', {}, genreName(g)))) : null,
    seasonsBox,
    // Duración solo en películas: en series depende del capítulo.
    el('span', { class: 'cat-info-meta' }, [m.year, m.imdb_rating && `★ ${m.imdb_rating}`, p.kind === 'movie' && m.runtime_min && `${m.runtime_min} min`].filter(Boolean).join(' · ')),
    (() => { const tier = ratingTier(p.kind, m.imdb_rating); return tier ? el('span', { class: 'cat-info-tier' }, `${tier[2]} ${t(tier[3])}`) : null; })(),
    m.awards ? el('span', { class: 'cat-info-awards' }, icon('award', 13), m.awards) : null].filter(Boolean));
}

/** Resultados de la búsqueda: películas y series juntas, ya ordenadas por el núcleo (lo más popular primero). */
function renderResults(root) {
  const list = state.results.filter((p) => !(state.hideJapanese && state.excluded.has(p.id)));
  root.append(list.length
    ? el('div', { class: 'cat-grid' }, list.map(cardFor))
    : el('p', { class: 'hint' }, t('Sin resultados para esa búsqueda.')));
}

/** Cards de carga mientras se tipea (2026-11-15) o mientras llega la página siguiente. */
function skeletonGrid(n = 12) {
  return el('div', { class: 'cat-grid', 'aria-busy': 'true', 'aria-label': t('Cargando…') },
    Array.from({ length: n }, () => el('div', { class: 'cat-card skeleton' }, el('span', { class: 'skel poster' }))));
}

/** Primera carga (2026-11-20, como la web): un proyector en loop (rollos girando, cinta corriendo, haz que titila). */
function projector() {
  return el('div', { class: 'cat-leader', role: 'status', 'aria-label': t('Cargando el catálogo') },
    el('div', { class: 'cat-projector', 'aria-hidden': 'true' },
      el('span', { class: 'reel-wheel' }), el('span', { class: 'reel-wheel' }), el('span', { class: 'proj-body' }),
      el('span', { class: 'proj-beam' }), el('span', { class: 'proj-strip' })),
    el('p', { class: 'cat-leader-msg', 'aria-hidden': 'true' },
      el('span', {}, t('Apagando las luces…')), el('span', {}, t('Haciendo pochoclos…')), el('span', {}, t('Rebobinando la cinta…'))));
}

// ---------- Fuentes (FR-41) ----------
async function openSources() {
  let dlg = $('#dlg-sources');
  if (!dlg) {
    dlg = el('dialog', { id: 'dlg-sources', class: 'dialog wide' });
    document.body.append(dlg);
  }
  const addons = await api.catalogAddons().catch((e) => { showError(e); return []; });
  const input = el('input', { id: 'cat-add-url', type: 'text', placeholder: t('Pegá la URL del manifest (https://…/manifest.json)'), class: 'cat-add-url' });
  const msg = el('p', { class: 'hint' });
  const refresh = () => openSources();
  dlg.replaceChildren(
    el('h3', {}, t('Fuentes de torrents')),
    el('p', { class: 'hint' }, t('Addons de Stremio que se consultan al abrir una película o episodio. La app no indexa contenido: solo junta lo que devuelven. En P2P tu IP es visible para los demás del torrent.')),
    el('ul', { class: 'cat-sources' }, addons.map((a) => el('li', {},
      el('label', {}, el('input', { id: `cat-addon-${a.id}`, type: 'checkbox', checked: a.enabled, onchange: (ev) => api.catalogSetAddonEnabled(a.id, ev.target.checked).catch(showError) }), ` ${a.name}`),
      el('span', { class: 'hint cat-url' }, a.display_url),
      a.own ? null : el('button', { id: `cat-addon-rm-${a.id}`, class: 'small danger', onclick: () => api.catalogRemoveAddon(a.id).then(refresh, showError) }, t('Quitar'))))),
    el('div', { class: 'key-line' }, input,
      el('button', { id: 'cat-add-addon', onclick: async () => {
        msg.textContent = t('Validando…');
        try {
          const a = await api.catalogAddAddon(input.value);
          setStatus(t('{n} ✓ agregado.', { n: a.name }));
          refresh();
        } catch (e) { msg.textContent = t(e?.message ?? String(e)); }
      } }, t('Agregar'))),
    msg,
    el('div', { class: 'dialog-actions' },
      el('button', { id: 'cat-sources-reset', onclick: () => api.catalogResetAddons().then(refresh, showError) }, t('Restaurar lista por defecto')),
      el('button', { id: 'cat-sources-close', onclick: () => dlg.close() }, t('Cerrar'))),
  );
  if (!dlg.open) dlg.showModal();
}

// ---------- Explorar ----------
/** Tarjetas que se suman por vez (scroll infinito; la lista de TMDB llega entera, Cinemeta de a 50). */
const PAGE = 20;
const MIN_YEAR = 1950;
const thisYear = () => new Date().getFullYear();
const isoDay = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const monthsAgo = (m) => { const d = new Date(); d.setMonth(d.getMonth() - m); return d; };
/** Meses hacia atrás que se pueden elegir: hoy, 1…11 meses, después de a 1 año hasta 1950. */
const BACK_STEPS = [...Array.from({ length: 12 }, (_, i) => i), ...Array.from({ length: thisYear() - MIN_YEAR }, (_, i) => (i + 1) * 12)];
const backLabel = (m) => (m === 0 ? t('hoy') : m < 12 ? t(m === 1 ? 'hace {n} mes' : 'hace {n} meses', { n: m }) : t(m === 12 ? 'hace {n} año' : 'hace {n} años', { n: m / 12 }));
const VOTE_STEPS = [0, 1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000];
const votesLabel = (v) => (v ? t('{n}+ votos', { n: v.toLocaleString(locale()) }) : t('Cualquier cantidad de votos'));
const LANGS = [['en,es', 'Inglés o español'], ['', 'Cualquier idioma']];
const KINDS = [['movie', 'Películas', 'film'], ['series', 'Series', 'tv']];
const SORTS = [['rating', 'Mejor puntaje', 'star'], ['popular', 'Más populares', 'flame']];
const NEEDS_TMDB = 'Key de TMDB: es gratis y en un minuto la tenés. Con ella filtrás por fecha, votos de IMDb, idioma y géneros, y aparecen pósters que faltan.\nClic para cargarla en Ajustes.';

/** Lo que se recuerda entre aperturas (2026-11-16). La primera vez: películas con mejor puntaje de IMDb, del último
 *  año, con 10.000+ votos, en inglés o español, de todos los géneros (como la web). */
const DEFAULTS = { kind: 'movie', sort: 'rating', backFrom: 12, backTo: 0, minVotes: 10000, langs: ['en', 'es'], genres: [] };
const browse = {
  ...structuredClone(DEFAULTS),
  // Hay key de TMDB (se consulta al pedir cada lista nueva). Sin key (2026-11-16) se muestra lo que está en
  // tendencia (Cinemeta, gratis) y se invita a cargarla para los filtros. null = no se sabe.
  tmdb: null,
  /** Géneros de TMDB por tipo, en el idioma de la app: [{id, name}]. */
  genreList: {},
  items: [], shown: 0, skip: 0, hasMore: true, loading: false, error: null, gen: 0,
};
// v2 (2026-11-20): géneros por id de TMDB y sin "documentales" como tipo; lo guardado antes queda afuera.
const FILTERS_STORE = 'streamonte.catalog.filters.v2';
/** Valores válidos de cada filtro: algo viejo o roto no rompe la lista. */
const VALID = {
  kind: (v) => KINDS.some(([k]) => k === v), sort: (v) => SORTS.some(([k]) => k === v),
  backFrom: (v) => BACK_STEPS.indexOf(v) >= 1, backTo: (v) => BACK_STEPS.includes(v), minVotes: (v) => VOTE_STEPS.includes(v),
  langs: (v) => LANGS.some(([l]) => l === v?.join?.(',')), genres: (v) => Array.isArray(v) && v.every(Number.isInteger),
};
try {
  const saved = JSON.parse(safeGet(FILTERS_STORE) ?? '{}');
  for (const k of Object.keys(DEFAULTS)) if (k in saved && VALID[k](saved[k])) browse[k] = saved[k];
  if (browse.backTo >= browse.backFrom) browse.backTo = 0;
} catch { /* guardado ilegible: quedan los de fábrica */ }
const saveFilters = () => safeSet(FILTERS_STORE, JSON.stringify(Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, browse[k]]))));

/** Cambios seguidos (géneros, votos) se juntan en un pedido: la lista se pide LOAD_WAIT_MS después del último. */
const LOAD_WAIT_MS = 400;
let browseTimer = null;
function setBrowse(changes) {
  toTop();
  if (changes.kind && changes.kind !== browse.kind) { changes.genres = []; loadGenres(changes.kind); }
  Object.assign(browse, changes);
  saveFilters();
  // `gen` invalida lo que esté cargando con el filtro anterior.
  Object.assign(browse, { items: [], shown: 0, skip: 0, hasMore: true, error: null, loading: false, gen: browse.gen + 1 });
  clearTimeout(browseTimer);
  browseTimer = setTimeout(() => { browseTimer = null; loadMore(); }, LOAD_WAIT_MS);
  render();
}
const resetFilters = () => setBrowse({ minVotes: DEFAULTS.minVotes, langs: [...DEFAULTS.langs], genres: [] });
/** Filtros avanzados que no están en su valor por defecto (el número del botón "Filtros"). */
const changedFilters = () => Number(browse.minVotes !== DEFAULTS.minVotes) + Number(browse.langs.join(',') !== DEFAULTS.langs.join(',')) + browse.genres.length;

async function loadGenres(kind) {
  if (browse.genreList[kind] || !browse.tmdb) return;
  const list = await api.catalogGenres(kind).catch(() => null);
  if (!list) return;
  browse.genreList[kind] = list;
  renderControls();
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
        if (tmdb !== browse.tmdb) { browse.tmdb = tmdb; loadGenres(browse.kind); }
      }
      const from = isoDay(monthsAgo(browse.backFrom)), to = browse.backTo ? isoDay(monthsAgo(browse.backTo)) : null;
      const page = browse.tmdb
        ? await api.catalogBrowseTop(browse.kind, browse.sort, from, to, browse.minVotes, browse.langs, browse.genres)
        : await api.catalogTrending(browse.kind, browse.skip);
      if (gen !== browse.gen) return; // cambió el filtro: otra carga ya está en curso
      const known = new Set(browse.items.map((p) => p.id));
      browse.items.push(...page.items.filter((p) => !known.has(p.id)));
      browse.skip += page.items.length;
      browse.hasMore = page.has_more && page.items.length > 0;
    } catch (e) {
      if (gen !== browse.gen) return;
      browse.error = t(e?.message ?? String(e));
      browse.hasMore = false;
    } finally {
      if (gen === browse.gen) browse.loading = false;
    }
  }
  browse.shown += PAGE;
  render();
}

const browseItems = () => browse.items.filter((p) => !(state.hideJapanese && p.excluded));
const moreToShow = () => browse.hasMore || browseItems().length > browse.shown;
/** Scroll infinito (2026-11-20): el final está a menos de ~2 pantallas → se suman más, antes de llegar (sin huecos).
 *  Se mira al scrollear y después de cada página (si la nueva no alejó el final, se sigue pidiendo). */
function checkNear() {
  const end = $('#cat-end');
  if (!end || browse.loading || browseTimer || browse.error || !moreToShow()) return;
  if (end.getBoundingClientRect().top < innerHeight + 1600) loadMore();
}

/** Abre Ajustes en la key de TMDB. */
async function askTmdbKey() {
  await openSettings();
  const input = $('#key-tmdb');
  input?.scrollIntoView({ block: 'center' });
  input?.focus();
}
/** Cambió la key de TMDB en Ajustes (2026-11-17): la lista se vuelve a pedir ya (con o sin sus filtros) y, si hay un
 *  título abierto, sus datos de TMDB. */
document.addEventListener('streamonte:tmdb-key', () => {
  browse.genreList = {};
  setBrowse({ tmdb: null });
  const s = state.side;
  if (s) {
    s.similar = undefined;
    api.catalogDetails(s.kind, s.id).then((d) => { if (state.side === s) { s.details = d; renderSide(); } }).catch(() => {});
  }
});

// ---------- Estrenos desde → hasta (2026-11-20, como la web) ----------
// Atajos (3 meses… Todo) con una píldora que salta, y una tira de película que se arrastra: despacio afina de a un mes
// o año, rápido salta años (con inercia al soltar) y con el puntero en un borde sigue sola. El zoom se abre cuanto más
// atrás va el valor. Un segundo cabezal ("hasta") se abre tocando "hoy". Flechas ±1, Re/Av Pág ±10.
const YEAR = thisYear();
const LAST = BACK_STEPS.length - 1;
const MAX = BACK_STEPS[LAST];
const PRESETS = [[3, '3 meses'], [12, '1 año'], [60, '5 años'], [120, '10 años'], [MAX, 'Todo']];
/** Meses (continuos) → paso más cercano: meses sueltos bajo el año, años enteros arriba. */
const snap = (m) => (m < 11.5 ? Math.max(0, Math.round(m)) : Math.min(MAX, Math.round(m / 12) * 12));
const valueText = (m) => (m < 12 ? backLabel(m) : String(YEAR - m / 12));

function sinceControl() {
  /** Meses mientras se arrastra, desde y hasta (-1 = quieto). */
  let scrub = -1, scrubTo = -1, untilOpen = false;
  /** v: velocidad suavizada (px/ms); stop: este toque frenó una inercia; l/w: la tira; edge: 1 = en el borde izquierdo. */
  let drag = null, glide = 0, edgeRaf = 0;
  const fromM = () => BACK_STEPS[Math.max(1, BACK_STEPS.indexOf(browse.backFrom))];
  const shownM = () => (scrub >= 0 ? scrub : fromM());
  const shownIdx = () => BACK_STEPS.indexOf(shownM());
  const shownTo = () => (scrubTo >= 0 ? scrubTo : Math.min(browse.backTo, BACK_STEPS[shownIdx() - 1]));
  const toIdx = () => BACK_STEPS.indexOf(shownTo());
  const showTo = () => untilOpen || browse.backTo > 0;
  /** Zoom: la tira muestra `span` meses (hoy a la derecha), con aire a la izquierda del valor. */
  const spanFor = (m) => Math.min(MAX, Math.max(24, m * 2.2));
  let span = spanFor(fromM()), zoomTo = span, zoomRaf = 0;
  const at = (m) => Math.max(0, 100 * (1 - m / span));
  /** Rango del cabezal que se mueve: siempre queda al menos un paso entre hasta y desde. */
  const range = (to) => (to ? [0, BACK_STEPS[shownIdx() - 1]] : [BACK_STEPS[toIdx() + 1], MAX]);

  const fromSlot = el('span', { class: 'since-from' });
  const toSlot = el('span', { class: 'to-slot' });
  const toX = el('span', { class: 'since-to-x' }, icon('close', 11));
  const toBtn = el('button', { id: 'since-to', type: 'button', class: 'since-to', onclick: () => {
    if (!showTo()) { untilOpen = true; sync(); return; }
    untilOpen = false;
    if (browse.backTo) setBrowse({ backTo: 0 }); else sync();
  } }, toSlot, toX);
  const val = el('span', { class: 'since-val' }, fromSlot, el('span', { class: 'since-dash', 'aria-hidden': 'true' }, '–'), toBtn);
  const pill = el('span', { class: 'preset-pill', 'aria-hidden': 'true' });
  const presetBtns = PRESETS.map(([m, l]) => el('button', { id: `since-${m}`, type: 'button', role: 'radio',
    onclick: () => { untilOpen = false; setBrowse({ backFrom: m, backTo: 0 }); } }, t(l)));
  const presets = el('div', { class: 'presets', role: 'radiogroup', 'aria-label': t('Estrenos desde') }, pill, presetBtns);
  const lit = el('span', { class: 'reel-lit', 'aria-hidden': 'true' });
  const years = el('span', { class: 'reel-years', 'aria-hidden': 'true' });
  const head = el('span', { class: 'playhead', 'aria-hidden': 'true' });
  const until = el('span', { id: 'until-slider', class: 'playhead until', role: 'slider', 'aria-label': t('Hasta'), 'aria-valuemin': 0, 'aria-valuemax': LAST - 1,
    onkeydown: (e) => { e.stopPropagation(); const s = keyStep(e); if (!s) return; e.preventDefault(); setBrowse({ backTo: BACK_STEPS[Math.min(shownIdx() - 1, Math.max(0, toIdx() + s))] }); } });
  const reel = el('div', { id: 'since-slider', class: 'reel', role: 'slider', tabindex: 0, title: t('Despacio afina, rápido salta años'),
    'aria-label': t('Estrenos desde'), 'aria-valuemin': 1, 'aria-valuemax': LAST,
    onpointerdown: down, onpointermove: move, onpointerup: up, onpointercancel: up,
    onkeydown: (e) => { const s = keyStep(e); if (!s) return; e.preventDefault(); setBrowse({ backFrom: BACK_STEPS[Math.min(LAST, Math.max(toIdx() + 1, shownIdx() + s))] }); },
  }, lit, years, head, until);
  const node = el('div', { id: 'cat-since', class: 'since' },
    el('div', { class: 'since-head' }, el('span', { class: 'since-label' }, t('Estrenos desde')), val, presets), reel);

  /** Flechas ±1 paso, Re/Av Pág ±10. */
  function keyStep(e) {
    return ({ ArrowLeft: 1, ArrowDown: 1, ArrowRight: -1, ArrowUp: -1, PageDown: 10, PageUp: -10 })[e.key] ?? 0;
  }
  /** El texto nuevo entra con su animación (se reemplaza el nodo para que se repita). */
  function setText(slot, text) {
    if (slot.textContent === text) return;
    slot.replaceChildren(el('b', { class: 'tick-in' }, text));
  }
  /** Posiciones según el zoom actual (cada cuadro del zoom). */
  function paint() {
    reel.style.setProperty('--at', `${at(shownM())}%`);
    reel.style.setProperty('--to-at', `${at(shownTo())}%`);
    // Rayitas: cada 1/3/12/60 meses, que no queden más de ~80; años rotulados de a 1/2/5/10/20, lejos de los bordes.
    const tick = [1, 3, 12].find((s) => span / s <= 80) ?? 60;
    reel.style.setProperty('--tick', `${(100 * tick) / span}%`);
    const every = [1, 2, 5, 10].find((s) => span / 12 / s <= 8) ?? 20;
    const ys = Array.from({ length: Math.floor(span / 12) }, (_, i) => YEAR - 1 - i)
      .filter((y) => y >= MIN_YEAR && y % every === 0 && ((YEAR - y) * 12) / span > 0.06 && ((YEAR - y) * 12) / span < 0.94);
    if (years.dataset.list !== ys.join()) {
      years.dataset.list = ys.join();
      years.replaceChildren(...ys.map((y) => el('span', { class: 'decade', 'data-y': y }, String(y))));
    }
    for (const d of years.children) d.style.left = `${at((YEAR - Number(d.dataset.y)) * 12)}%`;
  }
  function zoom() {
    const target = spanFor(shownM());
    if (target === zoomTo) return;
    zoomTo = target;
    cancelAnimationFrame(zoomRaf);
    if (reduceMotion()) { span = target; paint(); return; }
    reel.classList.add('zooming');
    let t0 = performance.now();
    const step = (now) => {
      span += (zoomTo - span) * (1 - Math.exp(-(now - t0) / 140));
      t0 = now;
      if (Math.abs(zoomTo - span) < 0.3) { span = zoomTo; reel.classList.remove('zooming'); paint(); return; }
      paint();
      zoomRaf = requestAnimationFrame(step);
    };
    zoomRaf = requestAnimationFrame(step);
  }
  /** Todo desde el estado (filtros guardados o lo que se arrastra). */
  function sync() {
    const m = shownM(), to = shownTo(), open = showTo();
    setText(fromSlot, valueText(m));
    setText(toSlot, to === 0 ? t('hoy') : valueText(to));
    toBtn.classList.toggle('on', open);
    toBtn.setAttribute('aria-pressed', String(open));
    toBtn.title = t(open ? 'Volver a hasta hoy' : 'Elegir hasta cuándo');
    toX.hidden = !open;
    const live = scrub >= 0;
    val.classList.toggle('live', live);
    reel.classList.toggle('live', live);
    reel.setAttribute('aria-valuenow', String(shownIdx()));
    reel.setAttribute('aria-valuetext', backLabel(m));
    until.classList.toggle('on', open);
    until.tabIndex = open ? 0 : -1;
    until.setAttribute('aria-hidden', String(!open));
    until.setAttribute('aria-valuenow', String(toIdx()));
    until.setAttribute('aria-valuetext', backLabel(to));
    presetBtns.forEach((b, i) => b.setAttribute('aria-checked', String(!live && browse.backFrom === PRESETS[i][0] && !browse.backTo)));
    // La píldora salta al atajo elegido (necesita el layout: un cuadro después de insertarse).
    requestAnimationFrame(() => {
      const on = presets.querySelector('[aria-checked="true"]');
      pill.classList.toggle('on', !!on);
      if (on) { pill.style.setProperty('--x', `${on.offsetLeft}px`); pill.style.setProperty('--w', `${on.offsetWidth}px`); }
    });
    zoom();
    paint();
  }

  /** Agarra el cabezal más cercano al puntero y congela ambos valores. */
  function down(e) {
    if (e.button !== 0) return;
    reel.setPointerCapture(e.pointerId);
    const r = reel.getBoundingClientRect();
    const x = (100 * (e.clientX - r.left)) / r.width;
    const to = showTo() && Math.abs(x - at(shownTo())) < Math.abs(x - at(shownM()));
    const stop = glide > 0;
    cancelAnimationFrame(glide);
    glide = 0;
    drag = { x: e.clientX, t: e.timeStamp, m: to ? shownTo() : shownM(), v: 0, moved: 0, to, stop, l: r.left, w: r.width, edge: 0 };
    [scrub, scrubTo] = [shownM(), shownTo()];
    sync();
  }
  /** Mueve el cabezal `dx` px (o `dx` meses si `months`); true si topó con un límite. Se mide en meses, no en píxeles
   *  de la tira, así el zoom no cambia la velocidad. */
  function nudge(d, dx, months = false) {
    const gain = months ? 1 : (d.m < 12 ? 1 : 12) * 0.04 + Math.min(1, Math.abs(d.v) / 2) ** 2 * 3; // meses por px
    const [lo, hi] = range(d.to);
    d.m = Math.min(hi, Math.max(lo, d.m - dx * gain));
    const m = Math.min(hi, Math.max(lo, snap(d.m)));
    if (m !== (d.to ? scrubTo : scrub)) {
      if (d.to) scrubTo = m; else scrub = m;
      sync();
    }
    return d.m === lo || d.m === hi;
  }
  function move(e) {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    // Velocidad suavizada: un tirón suelto no dispara saltos.
    drag.v += (dx / Math.max(1, e.timeStamp - drag.t) - drag.v) * 0.3;
    drag.moved += Math.abs(dx);
    drag.x = e.clientX;
    drag.t = e.timeStamp;
    nudge(drag, dx);
    // Puntero en un borde: sigue yendo solo hacia ese lado, cada vez más rápido.
    const dir = drag.moved < 4 ? 0 : e.clientX < drag.l + 28 ? 1 : e.clientX > drag.l + drag.w - 28 ? -1 : 0;
    if (dir === drag.edge) return;
    cancelAnimationFrame(edgeRaf);
    edgeRaf = 0;
    drag.edge = dir;
    if (!dir) return;
    const d = drag;
    let t0 = performance.now(), held = 0;
    const step = (now) => {
      held += (now - t0) / 1000;
      const pace = Math.min(30, 3 + 8 * held); // pasos (meses o años) por segundo
      if (nudge(d, (-dir * (d.m < 12 ? 1 : 12) * pace * (now - t0)) / 1000, true)) { edgeRaf = 0; return; }
      t0 = now;
      edgeRaf = requestAnimationFrame(step);
    };
    edgeRaf = requestAnimationFrame(step);
  }
  function commit() {
    const [from, to] = [scrub, scrubTo];
    scrub = scrubTo = -1;
    if (from !== browse.backFrom || to !== browse.backTo) setBrowse({ backFrom: from, backTo: to });
    else sync();
  }
  /** Suelta: aplica. Un clic sin arrastrar salta a donde se tocó; soltar rápido sigue de largo frenando de a poco. */
  function up(e) {
    if (!drag) return;
    cancelAnimationFrame(edgeRaf);
    edgeRaf = 0;
    if (drag.moved < 4 && !drag.stop) {
      const r = reel.getBoundingClientRect();
      const [lo, hi] = range(drag.to);
      const m = Math.min(hi, Math.max(lo, snap((1 - (e.clientX - r.left) / r.width) * span)));
      if (drag.to) scrubTo = m; else scrub = m;
    }
    const d = drag;
    drag = null;
    if (d.moved >= 4 && Math.abs(d.v) > 0.4 && e.timeStamp - d.t < 80 && !reduceMotion()) {
      let t0 = performance.now();
      const step = (now) => {
        d.v *= Math.exp(-(now - t0) / 325);
        const hit = nudge(d, d.v * (now - t0));
        t0 = now;
        if (hit || Math.abs(d.v) < 0.05) { glide = 0; commit(); return; }
        glide = requestAnimationFrame(step);
      };
      glide = requestAnimationFrame(step);
      return;
    }
    commit();
  }
  sync();
  return { node, sync };
}
let since = null;

// ---------- barra de filtros ----------
/** Desplegable de filtros avanzados abierto. */
let filtersOpen = false;
/** Tipo recién tocado: solo ese hace el "pop" (al cargar no rebota). */
let popped = '';

function segment(id, label, items, current, pick) {
  const i = Math.max(0, items.findIndex(([v]) => v === current));
  return el('div', { id, class: 'cat-seg', role: 'radiogroup', 'aria-label': label, style: `--i:${i};--n:${items.length}` },
    el('span', { class: 'cat-seg-thumb', 'aria-hidden': 'true' }),
    items.map(([v, l, ic]) => el('button', { id: `${id}-${v || 'any'}`, type: 'button', role: 'radio', 'aria-checked': String(v === current),
      onclick: () => v !== current && pick(v) }, el('span', { class: `cat-seg-in ${popped === v ? 'pop' : ''}` }, ic ? icon(ic, 16) : null, t(l)))));
}

function filtersPanel() {
  const genres = browse.genreList[browse.kind];
  const toggleGenre = (id) => setBrowse({ genres: browse.genres.includes(id) ? browse.genres.filter((g) => g !== id) : [...browse.genres, id] });
  const changed = changedFilters();
  return el('div', { id: 'cat-filters-pop', class: 'cat-pop cat-filters-pop', role: 'dialog', 'aria-label': t('Filtros avanzados') },
    el('h4', { class: 'cat-pop-h first' }, t('Géneros')),
    genres ? el('div', { class: 'cat-genres' }, genres.map((g) => el('button', {
      id: `cat-genre-${g.id}`, type: 'button', class: `cat-chip genre ${browse.genres.includes(g.id) ? 'on' : ''}`, 'aria-pressed': String(browse.genres.includes(g.id)),
      onclick: () => toggleGenre(g.id) }, g.name)))
      : el('div', { class: 'cat-genres', 'aria-busy': 'true' }, Array.from({ length: 8 }, () => el('span', { class: 'skel cat-chip-skel' }))),
    el('h4', { class: 'cat-pop-h', id: 'cat-votes-h' }, t('Votos mínimos')),
    el('div', { class: 'cat-genres', role: 'radiogroup', 'aria-labelledby': 'cat-votes-h' }, VOTE_STEPS.map((v) => el('button', {
      id: `cat-votes-${v}`, type: 'button', role: 'radio', class: `cat-chip ${browse.minVotes === v ? 'on' : ''}`, 'aria-checked': String(browse.minVotes === v),
      onclick: () => browse.minVotes !== v && setBrowse({ minVotes: v }) }, v ? `${(v / 1000).toLocaleString(locale())}k+` : t('Cualquiera')))),
    el('h4', { class: 'cat-pop-h', id: 'cat-lang-h' }, t('Idioma original')),
    segment('cat-lang', t('Idioma original'), LANGS, browse.langs.join(','), (v) => setBrowse({ langs: v.split(',').filter(Boolean) })),
    el('div', { class: 'cat-pop-actions' },
      el('button', { id: 'cat-filters-reset', type: 'button', disabled: !changed, onclick: resetFilters }, t('Restablecer')),
      el('button', { id: 'cat-filters-done', type: 'button', class: 'primary', onclick: () => { filtersOpen = false; renderControls(); } }, t('Ver resultados'))));
}

/** Tipo, orden y filtros (se redibuja entero); "Estrenos desde" es un nodo fijo que se actualiza (se arrastra). */
function renderControls() {
  const box = $('#cat-controls');
  const searching = !!(state.searching || state.results);
  box.hidden = searching;
  $('#cat-since').hidden = searching || browse.tmdb === false;
  if (searching) return;
  const kind = segment('cat-kind', t('Tipo'), KINDS, browse.kind, (v) => { popped = v; setBrowse({ kind: v }); });
  // Sin key de TMDB: lo que está en tendencia y una invitación a la key para los filtros.
  if (browse.tmdb === false) {
    box.replaceChildren(kind, el('span', { class: 'cat-trending' }, t('En tendencia ahora')),
      el('button', { id: 'cat-tmdb-cta', class: 'cat-tmdb-cta', title: t(NEEDS_TMDB), onclick: askTmdbKey },
        icon('lock', 13), t('Filtrá por fecha, votos, idioma y géneros'), el('span', { class: 'cat-tmdb-cta-key' }, t('key gratis de TMDB')), icon('arrow', 13)));
    return;
  }
  const sort = el('div', { id: 'cat-sort-browse', class: `cat-sortsw ${browse.sort}`, role: 'radiogroup', 'aria-label': t('Orden') },
    SORTS.map(([v, l, ic]) => el('button', { id: `sort-${v}`, type: 'button', role: 'radio', class: 'marquee', 'aria-checked': String(browse.sort === v),
      onclick: () => browse.sort !== v && setBrowse({ sort: v }) }, icon(ic, 14), t(l))));
  // Resumen de lo aplicado (ni el idioma ni las fechas, que ya se ven) y el botón con cuántos filtros cambiaron.
  const names = (browse.genreList[browse.kind] ?? []).filter((g) => browse.genres.includes(g.id)).map((g) => g.name);
  const summary = [browse.minVotes ? votesLabel(browse.minVotes) : '', names.join(', ')].filter(Boolean);
  const changed = changedFilters();
  const open = () => { filtersOpen = !filtersOpen; renderControls(); };
  box.replaceChildren(kind, sort,
    el('div', { class: 'cat-filters-line' },
      summary.length ? el('button', { id: 'cat-filters-summary', type: 'button', class: 'cat-summary', onclick: open, 'aria-label': t('Filtros aplicados: {f}. Cambiar', { f: summary.join(', ') }) },
        summary.flatMap((part, i) => [i ? el('span', { class: 'sep', 'aria-hidden': 'true' }) : null, el('span', {}, part)])) : null,
      el('span', { class: 'cat-dd' },
        el('button', { id: 'cat-open-filters', type: 'button', class: `cat-trigger ${changed ? 'on' : ''} ${filtersOpen ? 'open' : ''}`, 'aria-expanded': String(filtersOpen), 'aria-haspopup': 'dialog', onclick: open },
          icon('sliders', 16), t('Filtros'), changed ? el('span', { class: 'n' }, String(changed)) : null),
        filtersOpen ? filtersPanel() : null)));
}
// Clic afuera o Escape cierra el desplegable (ignora clics en nodos que un re-render ya sacó).
document.addEventListener('click', (ev) => {
  if (filtersOpen && ev.target.isConnected && !ev.target.closest('.cat-dd')) { filtersOpen = false; renderControls(); }
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && filtersOpen) { filtersOpen = false; renderControls(); }
});

function renderFilters() {
  renderControls();
  if (!$('#cat-since').hidden) since.sync();
}

// ---------- Pegados ----------
/** Magnets pegados (portapapeles o buscador; sin ficha del catálogo), arriba de todo (2026-11-15: reemplaza a "Mis
 *  magnets"). Lo más nuevo primero. Con key de TorBox, cada uno abre lo que TorBox sabe de él (2026-11-20). */
function pastedSection() {
  const rows = [...state.library.values()].filter((e) => !e.origin)
    .sort((a, b) => String(b.added_at ?? '').localeCompare(String(a.added_at ?? '')));
  if (!rows.length) return null;
  const name = (e) => {
    const r = e.release;
    const ep = r?.season != null && r?.episode != null ? ` T${r.season}·E${r.episode}` : '';
    return r?.title ? `${r.title}${ep}` : e.torrent_name || e.name;
  };
  return el('section', { id: 'cat-pasted', class: 'cat-pasted', 'aria-label': t('Pegados') },
    el('h3', {}, t('Pegados')),
    el('ul', {}, rows.map((e) => el('li', { class: 'cat-pasted-row' },
      el('span', { class: 'cat-pasted-name', title: e.torrent_name || e.name }, name(e)),
      e.video_size ? el('span', { class: 'cat-pasted-size' }, humanBytes(e.video_size)) : null,
      view.torboxKey ? el('button', { id: `cat-pasted-torbox-${e.key}`, class: 'cat-icon-btn', title: t('Ver en TorBox: si lo tiene, al instante; si no, bajarlo en sus servidores'), 'aria-label': t('Ver en TorBox'),
        onclick: () => openMagnet(e.info_hash, e.torrent_name || e.name) }, icon('cloud', 16)) : null,
      el('button', { id: `cat-pasted-rm-${e.key}`, class: 'cat-icon-btn', title: t('Quitar de Pegados'), 'aria-label': t('Quitar'), onclick: () => api.remove(e.key).catch(showError) }, '✕'),
      el('button', { id: `cat-pasted-play-${e.key}`, class: 'cat-icon-btn primary', title: t('Reproducir'), 'aria-label': t('Reproducir'), onclick: (ev) => play(e.key, ev.currentTarget, e) }, icon('play', 16))))));
}
/** Redibuja solo la sección de pegados (llega una fila nueva, se quita una o se sabe si hay key de TorBox). */
export function refreshPasted() {
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
  if (items.length) root.append(el('div', { class: 'cat-grid' }, items.map(cardFor)));
  // Primera carga: el proyector; con tarjetas, esqueletos donde van a caer las siguientes.
  if (waiting) root.append(items.length ? skeletonGrid(8) : projector());
  if (waiting && !items.length && browse.tmdb) root.append(el('p', { class: 'hint cat-first-hint' }, t('La primera vez baja los puntajes de IMDb y las fichas de TMDB: puede tardar medio minuto.')));
  if (browse.error) {
    root.append(el('div', { class: 'cat-state' }, el('p', { class: 'error', role: 'alert' }, browse.error),
      el('div', { class: 'cat-state-actions' },
        el('button', { id: 'cat-retry', type: 'button', onclick: () => setBrowse({}) }, t('Reintentar')),
        el('button', { id: 'cat-settings', type: 'button', onclick: openSettings }, t('Ir a Ajustes')))));
  } else if (!items.length && !waiting) {
    const changed = changedFilters();
    root.append(el('div', { class: 'cat-state' }, el('p', { class: 'hint' }, t('No hay títulos con estos filtros.')),
      changed ? el('button', { id: 'cat-empty-reset', type: 'button', onclick: resetFilters }, t('Restablecer filtros')) : null));
  }
  root.append(el('div', { id: 'cat-end', class: 'cat-end', 'aria-hidden': 'true' }));
  if (!waiting) requestAnimationFrame(checkNear);
}

// ---------- render ----------
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
          el('input', { id: 'cat-q', type: 'search', placeholder: t('Buscar película o serie, o pegar un magnet…'), autocomplete: 'off', oninput: onQueryInput,
            onkeydown: (e) => { if (e.key === 'Escape' && e.target.value) { e.stopPropagation(); clearSearch(); } } }),
          el('button', { id: 'cat-q-clear', type: 'button', class: 'cat-q-clear', hidden: true, 'aria-label': t('Limpiar búsqueda'), onclick: clearSearch }, icon('close', 13))),
        el('div', { id: 'cat-controls', class: 'cat-controls' }),
        el('div', { id: 'cat-since' })),
      el('div', { id: 'cat-body' })),
    el('aside', { id: 'cat-side', class: 'cat-side', 'aria-label': t('Opciones') }));
  since = sinceControl();
  $('#cat-since').replaceWith(since.node);
  const main = $('#catalog .cat-main');
  main.addEventListener('scroll', () => { $('#cat-bar').classList.toggle('scrolled', main.scrollTop > 4); checkNear(); }, { passive: true });
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
      case 'catalog-swarm-counted': onSwarmEvent(event); break;
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
