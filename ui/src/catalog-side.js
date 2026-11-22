// @ts-check
// Panel lateral del catálogo (2026-11-17, separado de catalog.js): ficha, temporadas, similares y
// migas de pan. Las opciones del video elegido las dibuja `catalog-options.js`.

import { api } from './api.js';
import { openSettings } from './dialogs.js';
import { $, el, icon, setStatus } from './dom.js';
import { langs, locale, t } from './i18n.js';
import { loadStreams, renderStreamsOnly } from './catalog-options.js';
import { onlyCinema } from './format.js';
import { showError, state, view } from './catalog-state.js';
import { leaveTests } from './catalog-tests.js';
import { pickPerson, reduceMotion } from './catalog.js';
/** @typedef {import('./types.js').Meta} Meta */
/** @typedef {import('./catalog-state.js').Side} Side */
/** @typedef {import('./season.js').SeasonRatings} SeasonRatings */
/** @typedef {import('./season.js').Outlook} Outlook */

import { barHeight, seasonOutlook, seasonTone, seasonTrend as trendOf } from './season.js';

export { seasonOutlook, seasonTone };

/** Versión chica del gráfico de temporadas para la tarjeta (2026-11-16): las mismas barras que el
 *  panel (`seasonBars`) y qué viene después; con fecha, una cuenta regresiva destacada. */
/** @param {SeasonRatings} r @param {Outlook|null} o @returns {HTMLElement[]} */
export function seasonMini(r, o) {
  const out = [seasonBars(r, o, false)];
  if (o?.tone === 'go') {
    const when = o.days <= 1 ? t(o.days ? 'mañana' : 'hoy') : t('en {n} días', { n: o.days });
    out.push(el('span', { class: 'cat-mini-next soon' },
      el('span', { class: 'cat-mini-soon' }, icon('clock', 12), when),
      `T${o.season}${o.episode > 1 ? ` E${o.episode}` : ''} · ${dayMonth(o.date)}`));
  } else if (o) {
    const end = o.tone === 'done' || o.tone === 'stop';
    out.push(el('span', { class: `cat-mini-next ${o.tone}` }, el('span', { class: 'show-status-dot', 'aria-hidden': 'true' }),
      end ? t(o.tone === 'done' ? 'Serie terminada' : 'Serie cancelada') : t('{s} · sin fecha', { s: t(o.label) })));
  }
  return /** @type {HTMLElement[]} */ (out.filter(Boolean));
}

/** @param {import('./types.js').MediaKind} kind @param {string} id @param {string} name */
export async function openSide(kind, id, name) {
  await leaveTests();
  const seq = ++view.sideSeq;
  api.catalogStopStreams().catch(() => {});
  /** @type {Side} */
  const side = (state.side = { kind, id, name, meta: null, season: null, episode: null, videoId: null });
  state.update = null;
  markActiveCard();
  // TMDB (2026-11-17): idioma original, cadenas y similares; sin key, el panel ofrece configurarla.
  api.catalogDetails(kind, id).then((d) => { if (seq === view.sideSeq) { side.details = d; renderSide(); } }).catch(() => {});
  // Película: no hace falta la ficha (el título ya se eligió); se piden las opciones directo.
  // De fondo, la ficha: cabecera (póster, año, puntaje) y duración para el aviso de "Pesado".
  if (kind === 'movie') {
    loadStreams(id);
    api.catalogMeta(kind, id).then((m) => {
      if (seq !== view.sideSeq) return;
      side.meta = m;
      side.runtime = m.runtime_min;
      renderSide();
    }).catch(() => {});
    return;
  }
  renderSide();
  setStatus(t('Abriendo la serie…'));
  try {
    const meta = await api.catalogMeta(kind, id);
    if (seq !== view.sideSeq) return;
    side.meta = meta;
    side.runtime = meta.runtime_min;
    setStatus(t('Elegí temporada y episodio.'));
    renderSide();
    // Puntaje por temporada de fondo (2026-11-16); la primera vez sin key baja datasets de IMDb.
    api.catalogSeasonRatings(id).then((r) => { if (seq === view.sideSeq) { side.seasonRatings = r; renderSide(); } })
      .catch(() => { if (seq === view.sideSeq) { side.seasonRatings = null; renderSide(); } });
  } catch (e) { if (seq === view.sideSeq) showError(e); }
}

export async function closeSide() {
  await leaveTests();
  view.sideSeq++;
  api.catalogStopStreams().catch(() => {});
  state.side = null;
  state.update = null;
  markActiveCard();
  renderSide();
}

/** Volver a un paso de la serie (miga de pan): `null` = elegir temporada; número = elegir episodio. */
/** @param {number|null} season */
export async function goSeason(season) {
  await leaveTests();
  api.catalogStopStreams().catch(() => {});
  if (!state.side) return;
  Object.assign(state.side, { season, episode: null, videoId: null });
  state.update = null;
  loadEpisodeTexts(season);
  renderSide();
  $('#cat-side').scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
}

/** Títulos y sinopsis de los episodios en los idiomas elegidos (TMDB; Cinemeta los trae en inglés). Sin key de TMDB
 *  o con todo en inglés quedan los de Cinemeta. Una vez por temporada abierta. */
/** @param {number|null} season */
function loadEpisodeTexts(season) {
  const s = state.side;
  if (!s || season == null || !s.details?.has_key || s.epTexts?.[season] || (langs.app === 'en' && langs.titles === 'en')) return;
  const texts = (s.epTexts = { ...s.epTexts, [season]: new Map() });
  api.catalogEpisodes(s.id, season).then((list) => {
    if (state.side !== s) return;
    texts[season] = new Map(list.map((x) => [x.episode, x]));
    if (s.season === season) renderSide();
  }).catch(() => {});
}

/** Título en el idioma elegido para los títulos (TMDB) o, sin eso, el de Cinemeta. */
/** @param {Side} s */
const titleOf = (s) => s.details?.details?.title ?? s.meta?.name ?? s.name;

export function markActiveCard() {
  document.querySelectorAll('.cat-card').forEach((c) => /** @type {HTMLElement} */ (c).classList.toggle('active', /** @type {HTMLElement} */ (c).dataset.id === state.side?.id));
}

/** @param {Side} s */
export function crumbs(s) {
  // Serie › Temporada › Episodio como píldoras: las anteriores llevan de vuelta a ese paso.
  /** @type {{label: string, back?: (() => void)|null, cls?: string}[]} */
  const steps = [{ label: titleOf(s), back: s.season != null ? () => goSeason(null) : null, cls: 'root' }];
  if (s.season != null) steps.push({ label: s.season === 0 ? t('Especiales') : t('Temporada {n}', { n: s.season }), back: s.episode != null ? () => goSeason(s.season) : null });
  if (s.episode != null) steps.push({ label: t('Episodio {n}', { n: s.episode }) });
  const up = steps.at(-2)?.back;
  return el('nav', { class: 'crumbs', 'aria-label': t('Serie') },
    up ? el('button', { id: 'cat-crumb-up', class: 'crumb-up', title: t('Volver'), 'aria-label': t('Volver'), onclick: up }, '←') : null,
    el('ol', { class: 'crumb-path' }, steps.map((st, i) => el('li', {},
      st.back
        ? el('button', { id: `cat-crumb-${i}`, class: `crumb ${st.cls ?? ''}`, title: st.label, onclick: st.back }, st.label)
        : el('span', { class: `crumb current ${st.cls ?? ''}`, title: st.label, 'aria-current': 'page' }, st.label)))));
}

export function renderSide() {
  const aside = $('#cat-side');
  const s = state.side;
  $('#catalog').classList.toggle('side-open', !!s);
  if (!s) { aside.replaceChildren(); return; }
  // Todo el panel scrollea junto (2026-11-17); se conserva la posición al redibujar.
  const scroll = aside.scrollTop;
  const prev = /** @type {HTMLElement|null} */ (aside.querySelector('.side-intro'));
  const prevH = prev?.offsetHeight ?? 0;
  // Elegida una temporada, la cabecera y la ficha se pliegan: ya se leyeron o no interesan.
  const collapsed = s.season != null;
  const intro = s.meta ? el('div', { class: `side-intro ${collapsed ? 'collapsed' : ''}`, 'aria-hidden': collapsed ? 'true' : null, inert: collapsed || null },
    hero(s.meta), about(s.meta, s)) : null;
  aside.replaceChildren(.../** @type {HTMLElement[]} */ ([
    el('button', { id: 'cat-side-close', class: 'side-close', title: t('Cerrar (Esc)'), 'aria-label': t('Cerrar panel'), onclick: closeSide }, '✕'),
    intro,
    // Migas solo en series (2026-11-17): en una película quedaba una franja vacía.
    s.kind === 'series' ? el('div', { class: 'side-head' }, crumbs(s)) : null,
    el('div', { id: 'cat-side-body', class: 'side-body' }, sideBody(s))].filter(Boolean)));
  aside.scrollTop = scroll;
  if (intro && prev && prev.classList.contains('collapsed') !== collapsed && !reduceMotion()) {
    const h = collapsed ? 0 : intro.offsetHeight;
    intro.animate([{ height: `${prevH}px`, opacity: prevH ? 1 : 0 }, { height: `${h}px`, opacity: h ? 1 : 0 }],
      { duration: 360, easing: 'cubic-bezier(.16, 1, .3, 1)' });
  }
  renderStreamsOnly();
}

/** Géneros de Cinemeta (en inglés) a español; los que no están se muestran tal cual. */
/** @type {Record<string, string>} */
const GENRE_ES = { Action: 'Acción', Adventure: 'Aventura', Animation: 'Animación', Biography: 'Biografía', Comedy: 'Comedia', Crime: 'Crimen', Documentary: 'Documental', Drama: 'Drama', Family: 'Familia', Fantasy: 'Fantasía', 'Film-Noir': 'Cine negro', History: 'Historia', Horror: 'Terror', Music: 'Música', Musical: 'Musical', Mystery: 'Misterio', Romance: 'Romance', 'Sci-Fi': 'Ciencia ficción', 'Science Fiction': 'Ciencia ficción', Short: 'Corto', Sport: 'Deportes', Thriller: 'Suspenso', War: 'Bélica', Western: 'Western', 'Reality-TV': 'Reality', 'Talk-Show': 'Talk show', 'Game-Show': 'Concurso', News: 'Noticias' };

/** Género de Cinemeta en el idioma de la app (en inglés, tal cual viene). */
/** @param {string} g */
export const genreName = (g) => (langs.app === 'en' ? g : GENRE_ES[g] ?? g);

/** Cabecera de la serie o película: fondo, póster y datos. */
const compact = new Intl.NumberFormat(locale(), { notation: 'compact' });
const LANG_NAMES = new Intl.DisplayNames([langs.app], { type: 'language' });
/** @param {string} iso */
const dayMonth = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }).replace('.', '');
/** @param {Meta} m */
export function hero(m) {
  // Año, puntaje y duración como datos; IMDb y el tráiler son botones redondos debajo (2026-11-22, como la web).
  const rating = m.imdb_rating ? el('span', { class: 'side-rate', title: m.imdb_votes ? t('{n} votos', { n: compact.format(m.imdb_votes) }) : null }, `★ ${m.imdb_rating}`) : null;
  const facts = [m.year, m.runtime_min && `${m.runtime_min} min`, rating].filter(Boolean).flatMap((f, i) => (i ? ['  ·  ', f] : [f]));
  // Géneros en una línea sutil debajo del año y el puntaje (2026-11-20); con TMDB, en el idioma de la app.
  const tm = state.side?.details?.details;
  const genres = (tm?.genres?.length ? tm.genres : m.genres.map(genreName)).join(' · ');
  return el('div', { class: 'side-hero' },
    m.background ? el('div', { class: 'side-hero-bg', style: `background-image:url("${encodeURI(m.background)}")` }) : null,
    m.poster ? el('img', { class: 'side-hero-poster', src: m.poster, alt: '', referrerpolicy: 'no-referrer', onerror: (ev) => ev.target.remove() }) : null,
    el('div', { class: 'side-hero-text' }, el('h2', {}, titleOf(/** @type {Side} */ (state.side))), el('p', {}, facts),
      genres ? el('p', { class: 'side-hero-genres' }, genres) : null,
      tm?.companies?.length ? el('p', { class: 'side-hero-companies' }, tm.companies.join(' · ')) : null));
}

/** Dónde verla (logos apilados; al tocar se abren con nombre), tráiler e IMDb. El estado abierto vive en la ficha. */
/** @param {Meta} m @param {Side} s */
function actions(m, s) {
  const providers = s.details?.details?.providers ?? [];
  const open = !!s.providersOpen;
  const pill = providers.length ? el('button', { id: 'cat-providers', type: 'button', class: `side-providers ${open ? 'open' : ''}`, 'aria-expanded': String(open), 'aria-label': t('Dónde verla'), title: t('Para ver en Argentina'),
    onclick: () => { s.providersOpen = !open; renderSide(); } },
  ...(open ? providers : providers.slice(0, 3)).map((p, i) => el('span', { id: `cat-provider-${i}`, class: 'side-prov' },
    p.logo ? el('img', { src: p.logo, alt: '', width: 28, height: 28, referrerpolicy: 'no-referrer', onerror: (ev) => ev.target.remove() }) : el('span', { class: 'side-prov-empty', 'aria-hidden': 'true' }, p.name[0]),
    open ? el('span', { class: 'side-prov-name' }, p.name) : null)),
  !open && providers.length > 3 ? el('span', { class: 'side-prov-more' }, `+${providers.length - 3}`) : null) : null;
  // El de TMDB (el más viejo: temporada 1) si hay; si no, el primero de Cinemeta.
  const yt = s.details?.details?.trailer ?? m.trailer;
  return el('div', { class: 'side-acts' }, pill, el('span', { class: 'side-acts-gap' }),
    yt ? el('button', { id: 'cat-open-trailer', type: 'button', class: 'side-round', title: t('Ver el tráiler en YouTube'), 'aria-label': t('Tráiler'), onclick: () => api.catalogOpenTrailer(yt).catch(showError) }, icon('play', 15)) : null,
    el('button', { id: 'cat-open-imdb', type: 'button', class: 'side-round imdb', title: t('Ver en IMDb'), onclick: () => api.catalogOpenImdb(m.id).catch(showError) }, 'IMDb'));
}

/** Director y reparto principal con foto; tocar a alguien muestra lo que actuó o dirigió. */
/** @param {Side} s */
function peopleRow(s) {
  const people = s.details?.details?.people ?? [];
  if (!people.length) return null;
  return el('ul', { class: 'side-people', 'aria-label': t('Reparto') }, people.map((p) => el('li', {},
    el('button', { id: `cat-who-${p.role}-${p.id}`, type: 'button', class: 'side-person', title: t(p.role === 'director' ? 'Ver lo que dirigió' : 'Ver lo que actuó'),
      onclick: () => { closeSide(); pickPerson(/** @type {import('./catalog-state.js').PickedPerson} */ (p)); } },
    p.photo ? el('img', { src: p.photo, alt: '', width: 56, height: 56, loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (ev) => ev.target.replaceWith(el('span', { class: 'side-face-empty' }, icon('user', 20))) })
      : el('span', { class: 'side-face-empty', 'aria-hidden': 'true' }, icon('user', 20)),
    el('span', { class: 'side-person-name' }, p.name),
    el('span', { class: 'side-person-note' }, p.role === 'director' ? t('Dirección') : p.note ?? '')))));
}

/** Debajo de la cabecera (pedido 2026-11-15): dónde verla en Argentina (2026-11-20), cadenas y géneros, sinopsis
 *  (clic para verla entera), reparto e idioma original, link a IMDb y similares (2026-11-17). Con TMDB, sinopsis y
 *  géneros en el idioma de la app. Sin key de TMDB, en lugar de lo que viene de TMDB se ofrece configurarla. */
/** @param {Meta} m @param {Side} s */
export function about(m, s) {
  const tm = s.details?.details;
  // Sin TMDB (o sin créditos) el reparto de Cinemeta sigue en el plegable; con TMDB va con fotos arriba.
  const cast = tm?.people?.length ? [] : m.cast;
  /** @type {[string, string|undefined][]} */
  const facts = [];
  if (cast.length) facts.push([t('Reparto'), cast.join(', ')]);
  if (tm?.original_language) facts.push([t('Idioma original'), cap(LANG_NAMES.of(tm.original_language))]);
  const description = tm?.overview ?? m.description;
  // Sinopsis y reparto plegados (2026-11-20, como la web): una fila con la primera línea; al tocarla se despliega.
  // El estado vive en la ficha (`s.aboutOpen`): el panel se redibuja seguido y no tiene que cerrarse solo.
  const fold = description || facts.length ? el('section', { class: `side-fold ${s.aboutOpen ? 'open' : ''}` },
    el('button', { id: 'cat-about-toggle', type: 'button', class: 'side-fold-head', 'aria-expanded': String(!!s.aboutOpen), 'aria-controls': 'cat-about-body',
      onclick: (ev) => { s.aboutOpen = !s.aboutOpen; const sec = ev.currentTarget.parentElement; sec.classList.toggle('open', s.aboutOpen); ev.currentTarget.setAttribute('aria-expanded', String(s.aboutOpen)); sec.lastChild.inert = !s.aboutOpen; } },
      el('span', { class: 'side-fold-text' }, el('b', {}, description && cast.length ? t('Sinopsis y reparto') : description ? t('Sinopsis') : t('Reparto')),
        description ? el('span', { class: 'side-fold-peek' }, description) : null),
      el('span', { class: 'side-fold-chev', 'aria-hidden': 'true' }, icon('chev', 16))),
    el('div', { id: 'cat-about-body', class: 'side-fold-body', inert: s.aboutOpen ? null : '' },
      el('div', { class: 'side-fold-in' },
        description ? el('p', { class: 'side-desc' }, description) : null,
        facts.length ? el('dl', { class: 'side-facts' }, facts.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])) : null))) : null;
  const networks = (tm?.networks ?? []).map((n) => el('span', { class: 'side-genre network' }, n));
  return el('div', { class: 'side-about' },
    actions(m, s),
    peopleRow(s),
    m.kind === 'movie' && m.released && onlyCinema(m.released) ? el('p', { id: 'cat-cine-note', class: 'side-cine' }, icon('film', 15),
      el('span', {}, t('Probablemente todavía no haya torrents de buena calidad: se estrenó hace pocas semanas y por ahora suele haber solo copias filmadas en el cine.'))) : null,
    networks.length ? el('div', { class: 'side-genres' }, networks) : null,
    fold,
    s.details && !s.details.has_key ? el('div', { class: 'side-tmdb-teaser' },
      el('p', {}, el('b', {}, t('Más datos con TMDB')), t('Idioma original (elige mejor el audio), dónde verla, cadena de la serie y títulos similares. La key es gratis.')),
      el('button', { id: 'cat-tmdb-setup', class: 'pop-btn', onclick: openSettings }, t('Configurar')))
      : s.details?.has_key ? similarBox(s) : null);
}

/** "Similares" plegado (2026-11-17): se piden recién al abrirlo (cada uno cuesta pedidos a TMDB) y
 *  no ocupan lugar si no interesan. `s.similar`: undefined = sin pedir, null = cargando. */
/** @param {Side} s */
export function similarBox(s) {
  const open = !!s.similarOpen;
  const list = s.similar;
  const toggle = () => {
    s.similarOpen = !open;
    if (s.similarOpen && list === undefined) {
      s.similar = null;
      api.catalogSimilar(s.kind, s.id).then((l) => { if (state.side === s) { s.similar = l; renderSide(); } })
        .catch(() => { if (state.side === s) { s.similar = []; renderSide(); } });
    }
    renderSide();
  };
  return el('div', { class: `side-similar ${open ? 'open' : ''}` },
    el('button', { id: 'cat-similar-toggle', class: 'side-similar-head', 'aria-expanded': String(open), onclick: toggle },
      el('span', {}, t('Similares')), icon('chev', 16)),
    !open ? null
      : list == null ? el('div', { class: 'side-similar-grid', 'aria-busy': 'true' }, Array.from({ length: 5 }, () => el('span', { class: 'skel side-similar-skel' })))
        : !list.length ? el('p', { class: 'hint' }, t('TMDB no tiene recomendaciones para este título.'))
          : el('div', { class: 'side-similar-grid' }, list.map((x) => el('button', {
          id: `cat-similar-${x.id}`, class: 'side-similar-card', title: x.year ? `${x.name} (${x.year})` : x.name, onclick: () => openSide(s.kind, x.id, x.name),
        },
        x.poster ? el('img', { src: x.poster, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (ev) => ev.target.remove() }) : null,
        x.rating ? el('span', { class: `side-similar-score ${seasonTone(x.rating)}` }, `★ ${fmtScore(x.rating)}`) : null,
        el('span', { class: 'side-similar-name' }, x.name)))));
}

/** Puntaje por temporada como barras (2026-11-16), el mismo componente en el panel (`large`) y en
 *  la tarjeta. Alto relativo: la mejor temporada llena la barra y la base es un punto debajo de la
 *  peor, así se ve si sube o baja aunque todas estén entre 8 y 9. Color por nota. Si viene otra
 *  temporada, una barra punteada al final. null = no hay nada que mostrar. */
/** @param {number} x */
export const fmtScore = (x) => x.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** @param {string|undefined} x */
const cap = (x) => (x ? x[0].toUpperCase() + x.slice(1) : x);
/** @param {SeasonRatings} r @param {Outlook|null} o @param {boolean} large */
export function seasonBars(r, o, large) {
  const v = r.seasons.map((x) => x.rating);
  const upcoming = (o?.tone === 'wait' || o?.tone === 'go') && o.season > (r.seasons.at(-1)?.season ?? 0) ? o : null;
  if (v.length < 2 && !(v.length && upcoming)) return null;
  const height = (/** @type {number} */ x) => `${barHeight(v, x)}%`;
  const best = v.indexOf(Math.max(...v));
  const col = (/** @type {'button'|'span'} */ tag, /** @type {Record<string, import('./dom.js').ElAttr>} */ attrs, /** @type {string} */ val, /** @type {HTMLElement} */ fill, /** @type {string} */ n) => el(tag, attrs, large ? el('span', { class: 'sbar-val' }, val) : null,
    el('span', { class: 'sbar-track' }, fill), large ? el('span', { class: 'sbar-n' }, n) : null);
  const bars = r.seasons.map((x, i) => col(large ? 'button' : 'span', {
    ...(large ? { id: `cat-season-bar-${x.season}`, onclick: () => goSeason(x.season) } : {}),
    class: `sbar ${seasonTone(x.rating)} ${large && i === best ? 'best' : ''}`,
    title: t('Temporada {s}: {r} ({n} episodios con puntaje)', { s: x.season, r: fmtScore(x.rating), n: x.episodes }),
  }, fmtScore(x.rating), el('i', { style: `height:${height(x.rating)}` }), `T${x.season}`));
  // Lo que viene: punteada, a la altura de la última, con la fecha si se sabe.
  const next = upcoming && col('span', {
    class: `sbar ghost ${upcoming.tone}`, title: t('Temporada {n}', { n: upcoming.season }) + ': ' + (upcoming.tone === 'go' ? shortDate(upcoming.date) : t('{s}, sin fecha anunciada', { s: t(upcoming.label) })),
  }, upcoming.tone === 'go' ? dayMonth(upcoming.date) : '?',
  el('i', { style: `height:${height(v[v.length - 1])}` }), `T${upcoming.season}`);
  return el('span', { class: `sbars ${large ? 'large' : 'small'}` }, bars, next);
}
/** Primera contra última temporada: "Mejoró +0,8" / "Decayó −0,4" / "Estable". */
/** @param {SeasonRatings} r */
export function seasonTrend(r) {
  const tr = trendOf(r);
  if (!tr) return null;
  const text = tr.tone === 'flat' ? t('Estable') : t(tr.delta > 0 ? 'Mejoró +{d}' : 'Decayó −{d}', { d: fmtScore(Math.abs(tr.delta)) });
  return { text, icon: tr.icon, tone: tr.tone };
}

/** Gráfico del panel de la serie. `r`: undefined = cargando (esqueleto). */
/** @param {SeasonRatings|null|undefined} r @param {Outlook|null} o */
export function seasonChart(r, o) {
  if (r === undefined) return el('div', { class: 'season-chart', 'aria-busy': 'true' }, el('span', { class: 'skel season-chart-skel' }));
  const bars = r && seasonBars(r, o, true);
  if (!bars) return null;
  const trend = seasonTrend(r), end = o?.tone === 'done' || o?.tone === 'stop';
  return el('div', { class: 'season-chart' },
    el('div', { class: 'season-chart-head' }, el('b', {}, t('Puntaje por temporada')),
      el('span', { class: 'season-chart-meta' },
        end ? el('span', { class: `season-end ${o.tone}`, title: t('No hay más temporadas') }, icon(o.tone === 'done' ? 'flag' : 'ban', 12), t(o.label)) : null,
        trend ? el('span', { class: `season-trend ${trend.tone}` }, icon(trend.icon, 13), trend.text) : null,
        el('span', { class: 'season-chart-src' }, 'IMDb'))),
    bars);
}

/** Qué viene después de la última temporada (2026-11-16): punto fantasma del gráfico y tarjeta
 *  punteada de la lista (la lógica está en season.js). */
/** @param {Outlook|null} o */
export function nextSeasonTile(o) {
  if (!o) return null;
  // `next`: lo que viene (con o sin fecha); null = la serie terminó o se canceló.
  const next = o.tone === 'done' || o.tone === 'stop' ? null : o;
  const title = !next ? t(o.tone === 'done' ? 'Serie terminada' : 'Serie cancelada') : next.tone === 'go' && next.episode > 1 ? `T${next.season} E${next.episode}` : t('Temporada {n}', { n: next.season });
  const detail = !next ? t('No hay más temporadas')
    : o.tone === 'go' ? `${o.days <= 1 ? t(o.days ? 'Se estrena mañana' : 'Se estrena hoy') : t('Se estrena en {n} días', { n: o.days })} · ${shortDate(o.date)}`
    : t('{s} · sin fecha anunciada', { s: t(o.label) });
  return el('div', { id: 'cat-season-next', class: `season-tile next ${o.tone}` },
    el('span', { class: 'season-tile-num' }, next ? String(next.season) : icon(o.tone === 'done' ? 'flag' : 'ban', 22)),
    el('span', { class: 'season-tile-text' }, el('b', {}, title), el('span', {}, detail)));
}

/** @param {string|null|undefined} iso */
export const shortDate = (iso) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** @param {Side} s */
export function sideBody(s) {
  if (s.videoId) return el('div', { id: 'cat-streams' });
  if (!s.meta) return el('div', { class: 'side-skeleton' }, Array.from({ length: 5 }, () => el('span', { class: 'skel' })));
  const eps = s.meta.episodes;
  if (s.season == null) {
    // Temporadas: tarjetas sin imagen (las de episodios pueden spoilear, pedido 2026-11-15).
    const seasons = [...new Set(eps.map((e) => e.season))].sort((a, b) => (a || 999) - (b || 999));
    const outlook = seasonOutlook(s.seasonRatings?.status, Math.max(0, ...seasons));
    // Puntaje de IMDb de cada temporada (2026-11-20, como la web), del mismo dato que el gráfico.
    const score = new Map((s.seasonRatings?.seasons ?? []).map((x) => [x.season, x.rating]));
    /** @type {(HTMLElement|null)[]} */
    const tiles = seasons.map((n) => {
      const list = eps.filter((e) => e.season === n);
      const years = [...new Set(list.map((e) => e.released?.slice(0, 4)).filter(Boolean))];
      const r = score.get(n);
      return el('button', { class: 'season-tile', id: `cat-season-${n}`, onclick: () => goSeason(n) },
        el('span', { class: 'season-tile-num' }, n === 0 ? '★' : String(n)),
        el('span', { class: 'season-tile-text' },
          el('b', {}, n === 0 ? t('Especiales') : t('Temporada {n}', { n })),
          el('span', {}, [t(list.length === 1 ? '{n} episodio' : '{n} episodios', { n: list.length }), years.length && (years.length > 1 ? `${years[0]}–${years.at(-1)}` : years[0])].filter(Boolean).join(' · '))),
        r ? el('span', { class: `season-tile-score ${seasonTone(r)}`, title: t('Puntaje de IMDb de la temporada') }, icon('star', 12), fmtScore(r)) : null);
    });
    // La tarjeta punteada va después de la última temporada, antes de Especiales.
    tiles.splice(seasons.includes(0) ? tiles.length - 1 : tiles.length, 0, nextSeasonTile(outlook));
    return el('div', { class: 'season-grid' }, seasonChart(s.seasonRatings, outlook), tiles);
  }
  // Episodios: número, título, fecha y sinopsis (sin miniatura: puede spoilear), en los idiomas elegidos si TMDB los tiene.
  const texts = s.epTexts?.[s.season];
  return el('ul', { class: 'ep-list' }, eps.filter((e) => e.season === s.season).map((e) => /** @type {const} */ ([e, texts?.get(e.episode)])).map(([e, x]) => el('li', {},
    el('button', {
      class: 'ep-item', id: `cat-ep-${e.season}-${e.episode}`, disabled: !e.available,
      onclick: async () => { await leaveTests(); s.episode = e.episode; loadStreams(e.id); },
    },
    el('span', { class: 'ep-num' }, e.episode),
    el('span', { class: 'ep-text' },
      el('b', {}, x?.name || e.title || t('Episodio {n}', { n: e.episode })),
      el('span', { class: 'ep-date' }, e.available ? shortDate(e.released) : t('Se estrena {d}', { d: shortDate(e.released) || t('pronto') })),
      (x?.overview ?? e.overview) ? el('span', { class: 'ep-overview', title: x?.overview ?? e.overview }, x?.overview ?? e.overview) : null,
    )))));
}
