// Panel lateral del catálogo (separado de catalog.js, 2026-11-17): dueño de `state.side` (ficha elegida, temporada, episodio). Lo que se
// ve lo dibuja `SidePanel.svelte` con la `TitleView` compartida con la web, a través de `side-panel.svelte.ts`; las opciones del video
// elegido las dibuja `catalog-options.ts` en `#cat-streams`. Acá queda también `genreName`.

import * as core from './core.ts';
import { openSettings } from './dialog-flows.ts';
import { $, setStatus } from './dom.ts';
import { langs, t } from './i18n.ts';
import { loadStreams, renderStreamsOnly } from './catalog-options.ts';
import { showError, state, view, type PickedPerson, type Side } from './catalog-state.ts';
import { leaveTests } from './catalog-tests.ts';
import { pickPerson, reduceMotion } from './catalog.ts';
import { actions, panel } from './side-panel.svelte.ts';
import type { MediaKind } from './types.ts';

export async function openSide(kind: MediaKind, id: string, name: string): Promise<void> {
  await leaveTests();
  const seq = ++view.sideSeq;
  core.catalogStopStreams().catch(() => {});
  const side: Side = (state.side = { kind, id, name, meta: null, season: null, episode: null, videoId: null });
  state.update = null;
  markActiveCard();
  // TMDB (2026-11-17): idioma original y cadenas para elegir el audio; la ficha de la pantalla la pide `TitleView` por su cuenta.
  core.catalogDetails(kind, id).then((d) => { if (seq === view.sideSeq) { side.details = d; renderSide(); } }).catch(() => {});
  // Película: no hace falta la ficha (el título ya se eligió); se piden las opciones directo.
  // De fondo, la duración para el aviso de "Pesado".
  if (kind === 'movie') {
    loadStreams(id);
    core.catalogMeta(kind, id).then((m) => {
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
    const meta = await core.catalogMeta(kind, id);
    if (seq !== view.sideSeq) return;
    side.meta = meta;
    side.runtime = meta.runtime_min;
    setStatus(t('Elegí temporada y episodio.'));
    renderSide();
  } catch (e) { if (seq === view.sideSeq) showError(e); }
}

/** Abre una serie directo en un capítulo ("Vistos recientemente"): temporada, episodio y sus opciones. */
export async function openEpisode(id: string, name: string, season: number, episode: number): Promise<void> {
  await openSide('series', id, name);
  if (state.side?.id !== id || !state.side.meta) return;
  await goSeason(season);
  actions.episode(season, episode);
}

export async function closeSide(): Promise<void> {
  await leaveTests();
  view.sideSeq++;
  core.catalogStopStreams().catch(() => {});
  state.side = null;
  state.update = null;
  markActiveCard();
  renderSide();
}

/** Volver a un paso de la serie (miga de pan): `null` = elegir temporada; número = elegir episodio. */
export async function goSeason(season: number | null): Promise<void> {
  await leaveTests();
  core.catalogStopStreams().catch(() => {});
  if (!state.side) return;
  Object.assign(state.side, { season, episode: null, videoId: null });
  state.update = null;
  renderSide();
  $('#cat-side').scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
}

/** Título en el idioma elegido para los títulos (TMDB) o, sin eso, el de Cinemeta. */
const titleOf = (s: Side): string => s.details?.details?.title ?? s.meta?.name ?? s.name;

export function markActiveCard(): void {
  document.querySelectorAll<HTMLElement>('.cat-card').forEach((c) => c.classList.toggle('active', c.dataset.id === state.side?.id));
}

/** Pasa lo que cambió en `state.side` al panel (`SidePanel.svelte`) y marca el catálogo con el panel abierto. */
export function renderSide(): void {
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
  episode: async (season: number, episode: number) => {
    const s = state.side;
    if (!s) return;
    await leaveTests();
    s.episode = episode;
    loadStreams(`${s.id}:${season}:${episode}`);
  },
  person: (p: PickedPerson) => { closeSide(); pickPerson(p); },
  openTitle: (kind: 'movie' | 'tv', id: string, name: string) => openSide(kind === 'tv' ? 'series' : 'movie', id, name),
  imdb: (imdb: string) => core.catalogOpenImdb(imdb).catch(showError),
  setupTmdb: () => openSettings('keys'),
  optionsMounted: renderStreamsOnly,
});

/** Géneros de Cinemeta (en inglés) a español; los que no están se muestran tal cual. */
const GENRE_ES: Record<string, string> = { Action: 'Acción', Adventure: 'Aventura', Animation: 'Animación', Biography: 'Biografía', Comedy: 'Comedia', Crime: 'Crimen', Documentary: 'Documental', Drama: 'Drama', Family: 'Familia', Fantasy: 'Fantasía', 'Film-Noir': 'Cine negro', History: 'Historia', Horror: 'Terror', Music: 'Música', Musical: 'Musical', Mystery: 'Misterio', Romance: 'Romance', 'Sci-Fi': 'Ciencia ficción', 'Science Fiction': 'Ciencia ficción', Short: 'Corto', Sport: 'Deportes', Thriller: 'Suspenso', War: 'Bélica', Western: 'Western', 'Reality-TV': 'Reality', 'Talk-Show': 'Talk show', 'Game-Show': 'Concurso', News: 'Noticias' };

/** Género de Cinemeta en el idioma de la app (en inglés, tal cual viene). */
export const genreName = (g: string): string => (langs.app === 'en' ? g : GENRE_ES[g] ?? g);

