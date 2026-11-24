# catalog/ — búsqueda, fichas y torrents de addons
Cinemeta + TMDB + datasets IMDb para buscar y enriquecer; addons Stremio y fuentes propias para torrents, en una lista única. No conoce engine/analyzer/playback.

## Para X → andá a Y
- Búsqueda, trending, ficha base → `cinemeta.rs`, `mod.rs` (`Catalog`).
- Campo de la ficha de TMDB (dónde verla, gente, idioma) → `tmdb.rs` `Details`.
- Premios / subgéneros de IMDb → `awards.rs` / `interests.rs`. Top e IMDb dataset → `top.rs`; temporadas → `seasons.rs`.
- Torrents: addons `addons.rs`, `protocol.rs`; parseo `normalize.rs`; unión y orden `aggregate.rs`.
- Fuentes propias → `wpreact.rs`, `elitetorrent.rs`, `latteam.rs`, `torbox.rs`. Pistas de un MKV → `mkv.rs`.

## Relación
Lo orquesta `app/catalog.rs`. Reglas con golden: ver `packages/golden/CLAUDE.md`.

## Trampas
- La versión de caché va en el nombre de archivo (`tmdb-detalle-vN`, `ficha-vN`, `torbox2`, `imdb-temporadas-vN`): si cambia la forma serializada, subirla (no se migra).
- Sin key de TMDB → vacío/`None` sin error; la key va en la URL: nunca loguear URL (`http::redact`).
- Exclusión anime en 3 lugares: `cinemeta::is_excluded`, `tmdb.rs best_hit`, `people.rs pick` (= `keep()` de la web).
- Dedup por info hash; orden idioma → sub es → resolución → seeders → tamaño → hash. Candidato sin idioma nunca se descarta.
- wpreact/elitetorrent solo películas; latteam solo toma el hash. TorBox siempre directo con la key del usuario; `requestdl` la lleva en la URL (no loguear).

## Cómo se prueba
Addon falso: `crates/core/tests/it/catalog_mock.rs`.
