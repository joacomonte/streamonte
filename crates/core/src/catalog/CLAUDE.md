# catalog/ — búsqueda, fichas y torrents de addons
Cinemeta + TMDB + datasets IMDb para buscar y enriquecer; addons Stremio y fuentes propias para torrents, en una lista única. No conoce engine/analyzer/playback (salvo `engine::is_video`).

## Para X → andá a Y
- Búsqueda, trending, ficha base → `cinemeta.rs`, `mod.rs` (`Catalog`).
- Campo de la ficha de TMDB (dónde verla, gente, idioma) → `tmdb.rs` `Details`. Buscar por persona → `people.rs`. Puntaje por capítulo → `episode_ratings.rs`.
- Premios / subgéneros de IMDb → `awards.rs` / `interests.rs`. Top e IMDb dataset → `top.rs`; temporadas → `seasons.rs`.
- Torrents: addons `addons.rs`, `protocol.rs`; parseo `normalize.rs`; unión y orden `aggregate.rs`.
- Fuentes propias → `wpreact.rs`, `elitetorrent.rs`, `latteam.rs`, `torbox.rs`. Pistas de un MKV → `mkv.rs`.

## Relación
Lo orquesta `app/catalog.rs`. HTTP propio (timeouts, 2 pedidos por host) → `http.rs`. Reglas con golden: ver `packages/golden/CLAUDE.md`.

## Trampas
- La versión de caché va en el nombre de archivo (`tmdb-detalle-vN`, `ficha-vN`, `torbox2`, `imdb-temporadas-vN`): si cambia la forma serializada, subirla (no se migra).
- Sin key de TMDB → vacío/`None` sin error; la key va en la URL: nunca loguear URL (`http::redact`).
- Dedup por info hash; orden idioma → sub es → resolución → seeders → tamaño → hash. Candidato sin idioma nunca se descarta.
- wpreact/elitetorrent solo películas; latteam solo toma el hash. TorBox usa la key del usuario; si no hay, adopta la de la web (`crate::web`, misma cuenta que Ajustes). `requestdl` la lleva en la URL (no loguear).

## Cómo se prueba
Addon falso: `crates/core/tests/it/catalog_mock.rs`.
