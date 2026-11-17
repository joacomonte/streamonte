// Catálogo (F4b, spec 09 §11): Buscar / Explorar → al tocar una película o serie se abre un panel
// a la derecha (pedido 2026-11-15). Película: sus opciones. Serie: Serie › Temporada › Episodio ›
// opciones, como migas de pan. Cada opción: análisis profundo, cargar en background o Reproducir.
// Todo texto que viene de Cinemeta o de los addons entra como texto, nunca como HTML (NFR-24).

import { api, onCoreEvent } from './api.js';
import { play } from './audio-picker.js';
import { openSettings } from './dialogs.js';
import { $, el, icon, setStatus } from './dom.js';
import { humanBytes, playbackText } from './format.js';
import { bgText, cardSig, measurePlayback, onPlaybackRow, onStreams, renderStreamsOnly, starting, subsProgress } from './catalog-options.js';
import { closeSide, GENRE_ES, openSide, renderSide, seasonMini, seasonOutlook } from './catalog-side.js';
import { safeGet, safeSet, showError, state } from './catalog-state.js';
import { onSwarmEvent } from './catalog-tests.js';

let searchSeq = 0;
let searchTimer = null;

/** Una lista nueva (búsqueda o filtros) arranca desde arriba. */
export const toTop = () => document.querySelector('.cat-main')?.scrollTo({ top: 0 });

// ---------- búsqueda (FR-36) ----------
/** Se pide recién cuando se deja de tipear un momento (2026-11-16: no un pedido por letra). */
export const SEARCH_WAIT_MS = 900;
export function onQueryInput() {
  clearTimeout(searchTimer);
  searchSeq++; // lo que esté en vuelo ya no se muestra
  const q = $('#cat-q').value.trim();
  if (q.length < 2) { state.results = null; state.searching = false; render(); return; }
  if (!state.searching) { state.searching = true; render(); toTop(); }
  searchTimer = setTimeout(() => search(q), SEARCH_WAIT_MS);
}

export async function search(q) {
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
export const cards = new Map();
export function cardFor(p, i) {
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

export function posterCard(p) {
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

/** Detalles sobre el póster al pasar el mouse (2026-11-16): géneros, puntaje y premios (sin sinopsis desde 2026-11-17), sobre un
 *  degradado a oscuro. Sale de la ficha (Cinemeta, guardada en la caché de datos). */
/** Categoría por puntaje de IMDb (2026-11-17, tabla del usuario). Las series puntúan más alto en
 *  IMDb, por eso sus cortes son otros. `[corte película, corte serie, emoji, nombre]`, de mayor a menor. */
export const RATING_TIERS = [
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
export function ratingTier(kind, rating) {
  const r = Number(rating);
  if (!(r > 0)) return null;
  return RATING_TIERS.find(([movie, series]) => r >= (kind === 'series' ? series : movie));
}

export async function fillCardInfo(info, p) {
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
    m.genres.length ? el('span', { class: 'cat-info-genres' }, m.genres.slice(0, 3).map((g) => el('span', {}, GENRE_ES[g] ?? g))) : null,
    seasonsBox,
    // Duración solo en películas: en series depende del capítulo.
    el('span', { class: 'cat-info-meta' }, [m.year, m.imdb_rating && `★ ${m.imdb_rating}`, p.kind === 'movie' && m.runtime_min && `${m.runtime_min} min`].filter(Boolean).join(' · ')),
    (() => { const t = ratingTier(p.kind, m.imdb_rating); return t ? el('span', { class: 'cat-info-tier' }, `${t[2]} ${t[3]}`) : null; })(),
    m.awards ? el('span', { class: 'cat-info-awards' }, icon('award', 13), m.awards) : null].filter(Boolean));
}

/** Resultados de la búsqueda: películas y series juntas, ya ordenadas por el núcleo (lo más popular
 *  primero). */
export function renderResults(root) {
  const list = state.results.filter((p) => !(state.hideJapanese && state.excluded.has(p.id)));
  root.append(list.length
    ? el('div', { class: 'cat-grid' }, list.map(cardFor))
    : el('p', { class: 'hint' }, 'Sin resultados para esa búsqueda.'));
}

/** Cards de carga mientras se tipea (2026-11-15). */
export function skeletonGrid(n = 12) {
  return el('div', { class: 'cat-grid', 'aria-busy': 'true', 'aria-label': 'Buscando…' },
    Array.from({ length: n }, () => el('div', { class: 'cat-card skeleton' }, el('span', { class: 'skel poster' }))));
}

// ---------- Fuentes (FR-41) ----------
export async function openSources() {
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
export const PAGE = 20;
// La primera vez: "películas con mejor puntaje IMDb de hace 1 año a hoy con 50.000+ votos en inglés
// o español de todos los géneros". Después, los últimos usados, también entre aperturas de la app
// (`FILTER_KEYS`, pedido 2026-11-16). Los filtros valen para cualquier tipo y orden.
export const browse = {
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
export const FILTER_KEYS = ['kind', 'sort', 'genre', 'minVotes', 'langs', 'backFrom', 'backTo', 'genres'];
export const FILTERS_STORE = 'streamonte.catalog.filters';
try {
  const saved = JSON.parse(safeGet(FILTERS_STORE) ?? '{}');
  // Solo valores del mismo tipo que el default (`genre` puede ser null o texto): algo viejo o roto no rompe la lista.
  const fits = (v, d) => (d === null ? v === null || typeof v === 'string' : typeof v === typeof d && Array.isArray(v) === Array.isArray(d));
  for (const k of FILTER_KEYS) if (k in saved && fits(saved[k], browse[k])) browse[k] = saved[k];
} catch { /* guardado ilegible: quedan los de fábrica */ }
export const saveFilters = () => safeSet(FILTERS_STORE, JSON.stringify(Object.fromEntries(FILTER_KEYS.map((k) => [k, browse[k]]))));

/** Un solo temporizador para todos los filtros (pedido 2026-11-15): cualquier cambio (menú, clic en
 *  la lista o ruedita) lo reinicia, y la lista se pide una vez, SPIN_APPLY_MS después del último.
 *  Al vencer se aplican también los cambios de ruedita pendientes. Mientras, lo anterior se atenúa. */
let browseTimer = null;
export function scheduleLoad(wait) {
  clearTimeout(browseTimer);
  browseTimer = setTimeout(() => {
    browseTimer = null;
    flushSpins();
    if (!browse.items.length) loadMore(); // sin cambios reales (volvió al valor que tenía) no se pide de nuevo
  }, wait);
}

/** `wait`: cuánto esperar antes de pedir; `null` = no programa nada (lo hace quien llama). */
export function setBrowse(changes, wait = SPIN_APPLY_MS) {
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

export async function loadMore() {
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

export function browseItems() {
  let list = browse.items.filter((p) => !(state.hideJapanese && p.excluded));
  // Alcanza con que tenga uno de los géneros elegidos (Cinemeta no trae géneros: solo con TMDB).
  if (browse.tmdb && browse.genres.length) list = list.filter((p) => p.genres?.some((g) => browse.genres.includes(g)));
  return list;
}

// ---------- frase de filtros (pedido 2026-11-15, diseño design/filtros-frase.html) ----------
// "Mostrando [películas] [con mejor puntaje IMDb] de [hace 1 año] a [hoy] con [votos] en [idioma]
// de [géneros]": cada palabra abre su menú o gira con la ruedita.
export const MIN_YEAR = 1950;
export const thisYear = () => new Date().getFullYear();
export const isoDay = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
/** Rango móvil "de hace N a hace M" en meses, cambiado con la ruedita (pedido 2026-11-15). */
/** Pasos de la ruedita en meses hacia atrás: hoy, 1…11 meses, después de a 1 año hasta 1950. */
export const BACK_STEPS = [...Array.from({ length: 12 }, (_, i) => i), ...Array.from({ length: thisYear() - MIN_YEAR }, (_, i) => (i + 1) * 12)];
export const backLabel = (m) => (m === 0 ? 'hoy' : m < 12 ? `hace ${m} ${m === 1 ? 'mes' : 'meses'}` : `hace ${m / 12} ${m === 12 ? 'año' : 'años'}`);
export const monthsAgo = (m) => { const d = new Date(); d.setMonth(d.getMonth() - m); return d; };
export const VOTE_STEPS = [0, 1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000];
export const LANGS = [['en,es', 'inglés o español'], ['', 'cualquier idioma']];
export const votesLabel = (v) => (v ? `${v.toLocaleString('es-AR')}+ votos` : 'cualquier cantidad de votos');
export const NEEDS_TMDB = 'Key de TMDB: es gratis y en un minuto la tenés. Con ella filtrás por fecha, votos de IMDb, idioma y géneros, y aparecen pósters que faltan.\nClic para cargarla en Ajustes.';
/** Cambió la key de TMDB en Ajustes (2026-11-17): la lista se vuelve a pedir ya (con o sin sus
 *  filtros) y, si hay un título abierto, sus datos de TMDB. */
document.addEventListener('streamonte:tmdb-key', () => {
  setBrowse({ tmdb: null });
  const s = state.side;
  if (s) {
    s.similar = undefined;
    api.catalogDetails(s.kind, s.id).then((d) => { if (state.side === s) { s.details = d; renderSide(); } }).catch(() => {});
  }
});
/** Abre Ajustes en la key de TMDB. */
export async function askTmdbKey() {
  await openSettings();
  const input = $('#key-tmdb');
  input?.scrollIntoView({ block: 'center' });
  input?.focus();
}

export const KINDS = [
  { label: 'películas', kind: 'movie', genre: null },
  { label: 'series', kind: 'series', genre: null },
  { label: 'documentales', kind: 'movie', genre: 'Documentary' },
];
export const BROWSE_SORTS = [
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
export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const SPIN_APPLY_MS = 2500;
/** Tocar otro filtro cierra la lista del anterior y deja su cambio pendiente; todos se aplican
 *  juntos al vencer el temporizador compartido (`scheduleLoad`). */
export const pendingSpins = new Map(); // píldora → asentar su cambio (sin pedir)
export function flushSpins() {
  const commits = [...pendingSpins.values()];
  pendingSpins.clear();
  for (const commit of commits) commit();
}
/** `name`: id de la píldora; `labels[k]`: texto de cada opción; `apply(k)`: asentar la elegida. */
export function picker(name, labels, index, apply, lo = 0, hi = labels.length - 1) {
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
export function backPicker(which) {
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
export const GENRE_NAMES = ['Acción', 'Aventura', 'Animación', 'Comedia', 'Crimen', 'Documental', 'Drama', 'Familia', 'Fantasía', 'Historia', 'Terror', 'Música', 'Misterio', 'Romance', 'Ciencia ficción', 'Suspenso', 'Bélica', 'Western', 'Película de TV'];
export function genresLabel() {
  const g = browse.genres;
  if (!g.length) return 'todos los géneros';
  return g.length <= 2 ? g.join(' o ') : `${g.length} géneros`;
}
export function setGenres(genres) {
  browse.genres = genres;
  saveFilters();
  render(); // filtra lo cargado: no hace falta pedir de nuevo
}
export function genreMenu() {
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

export function sentence(searching) {
  // Géneros: multi-selección con chips en un popover (los demás filtros son `picker`).
  const genresWord = () => el('span', { class: 'cat-dd' },
    el('button', {
      id: 'cat-word-genres', class: `cat-word ${menu === 'genres' ? 'open' : ''}`, 'aria-haspopup': 'menu', 'aria-expanded': String(menu === 'genres'),
      onclick: () => { menu = menu === 'genres' ? null : 'genres'; renderFilters(); },
    }, genresLabel()),
    menu === 'genres' ? el('div', { id: 'cat-pop-genres', class: 'cat-pop genres', role: 'menu' }, genreMenu()) : null);
  const kind = KINDS.find((k) => k.kind === browse.kind && k.genre === browse.genre) ?? KINDS[0];
  if (searching) return el('div', { class: 'cat-sentence' }, 'Películas y series');
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
export function pastedSection() {
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
export function refreshPasted() {
  if (state.results || state.searching) return;
  const now = pastedSection();
  const old = $('#cat-pasted');
  if (old && now) old.replaceWith(now);
  else if (old) old.remove();
  else if (now) $('#cat-body')?.prepend(now);
}

export function renderBrowse(root) {
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
export function renderFilters() {
  $('#cat-filters').replaceChildren(sentence(!!(state.searching || state.results)));
}

export function render() {
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

export async function init() {
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
