// Catálogo como "Explorar" del desktop (streamonte/crates/core/src/catalog/top.rs): TMDB discover da los títulos
// del rango (y su ficha: IMDb id, idioma, país) y el dataset de IMDb da el puntaje y los votos reales. Se cruzan por IMDb id.
// Fachada: el código vive en `tmdb/{client,cache,lists,title}.ts`.
export { keep } from './tmdb/client.ts';
export { capped, detail } from './tmdb/cache.ts';
export { discover, search, people, personTitles, imdbPage } from './tmdb/lists.ts';
export type { Filters } from './tmdb/lists.ts';
export { providersAr, peopleOf, showStatus, title, namesOf, tmdbOf, season } from './tmdb/title.ts';
export type { Names } from './tmdb/title.ts';
