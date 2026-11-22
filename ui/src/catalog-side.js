// @ts-check
// Panel lateral del catálogo (separado de catalog.js, 2026-11-17): dueño de `state.side` (ficha elegida, temporada, episodio). Lo que se
// ve lo dibuja `SidePanel.svelte` con la `TitleView` compartida con la web, a través de `side-panel.svelte.ts`; las opciones del video
// elegido las dibuja `catalog-options.ts` en `#cat-streams`. Acá queda también `genreName`.

import { api } from './api.js';
import { openSettings } from './dialogs.js';
import { $, setStatus } from './dom.js';
import { langs, t } from './i18n.js';
import { loadStreams, renderStreamsOnly } from './catalog-options.ts';
import { showError, state, view } from './catalog-state.js';
import { leaveTests } from './catalog-tests.ts';
import { pickPerson, reduceMotion } from './catalog.js';
import { actions, panel } from './side-panel.svelte.ts';
/** @typedef {import('./catalog-state.js').Side} Side */

/** @param {import('./types.js').MediaKind} kind @param {string} id @param {string} name */
export async function openSide(kind, id, name) {
  await leaveTests();
  const seq = ++view.sideSeq;
  api.catalogStopStreams().catch(() => {});
  /** @type {Side} */
  const side = (state.side = { kind, id, name, meta: null, season: null, episode: null, videoId: null });
  state.update = null;
  markActiveCard();
  // TMDB (2026-11-17): idioma original y cadenas para elegir el audio; la ficha de la pantalla la pide `TitleView` por su cuenta.
  api.catalogDetails(kind, id).then((d) => { if (seq === view.sideSeq) { side.details = d; renderSide(); } }).catch(() => {});
  // Película: no hace falta la ficha (el título ya se eligió); se piden las opciones directo.
  // De fondo, la duración para el aviso de "Pesado".
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
  renderSide();
  $('#cat-side').scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
}

/** Título en el idioma elegido para los títulos (TMDB) o, sin eso, el de Cinemeta. */
/** @param {Side} s */
const titleOf = (s) => s.details?.details?.title ?? s.meta?.name ?? s.name;

export function markActiveCard() {
  document.querySelectorAll('.cat-card').forEach((c) => /** @type {HTMLElement} */ (c).classList.toggle('active', /** @type {HTMLElement} */ (c).dataset.id === state.side?.id));
}

/** Pasa lo que cambió en `state.side` al panel (`SidePanel.svelte`) y marca el catálogo con el panel abierto. */
export function renderSide() {
  const s = state.side;
  $('#catalog').classList.toggle('side-open', !!s);
  if (!s) { panel.open = false; return; }
  const kind = s.kind === 'series' ? 'tv' : 'movie';
  if (panel.id !== s.id || panel.kind !== kind) panel.hasKey = null;
  const hasKey = s.details?.has_key ?? null;
  // Cambió la key de TMDB (Ajustes): la ficha se vuelve a pedir; la primera respuesta (null → valor) no cuenta.
  if (panel.hasKey !== null && hasKey !== null && hasKey !== panel.hasKey) panel.epoch++;
  Object.assign(panel, { open: true, kind, id: s.id, title: titleOf(s), season: s.season, episode: s.episode, hasKey });
}

Object.assign(actions, {
  close: closeSide,
  season: goSeason,
  /** @param {number} season @param {number} episode */
  episode: async (season, episode) => {
    const s = state.side;
    if (!s) return;
    await leaveTests();
    s.episode = episode;
    loadStreams(`${s.id}:${season}:${episode}`);
  },
  /** @param {import('./catalog-state.js').PickedPerson} p */
  person: (p) => { closeSide(); pickPerson(p); },
  /** @param {'movie'|'tv'} kind @param {string} id @param {string} name */
  openTitle: (kind, id, name) => openSide(kind === 'tv' ? 'series' : 'movie', id, name),
  /** @param {string} imdb */
  imdb: (imdb) => api.catalogOpenImdb(imdb).catch(showError),
  /** @param {string} youtube */
  trailer: (youtube) => api.catalogOpenTrailer(youtube).catch(showError),
  setupTmdb: openSettings,
  optionsMounted: renderStreamsOnly,
});

/** Géneros de Cinemeta (en inglés) a español; los que no están se muestran tal cual. */
/** @type {Record<string, string>} */
const GENRE_ES = { Action: 'Acción', Adventure: 'Aventura', Animation: 'Animación', Biography: 'Biografía', Comedy: 'Comedia', Crime: 'Crimen', Documentary: 'Documental', Drama: 'Drama', Family: 'Familia', Fantasy: 'Fantasía', 'Film-Noir': 'Cine negro', History: 'Historia', Horror: 'Terror', Music: 'Música', Musical: 'Musical', Mystery: 'Misterio', Romance: 'Romance', 'Sci-Fi': 'Ciencia ficción', 'Science Fiction': 'Ciencia ficción', Short: 'Corto', Sport: 'Deportes', Thriller: 'Suspenso', War: 'Bélica', Western: 'Western', 'Reality-TV': 'Reality', 'Talk-Show': 'Talk show', 'Game-Show': 'Concurso', News: 'Noticias' };

/** Género de Cinemeta en el idioma de la app (en inglés, tal cual viene). */
/** @param {string} g */
export const genreName = (g) => (langs.app === 'en' ? g : GENRE_ES[g] ?? g);

