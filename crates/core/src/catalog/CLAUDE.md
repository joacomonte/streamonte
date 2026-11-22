# catalog (streamonte-core)

Buscar películas/series (Cinemeta + TMDB), enriquecer fichas (TMDB, datasets IMDb) y juntar torrents de addons Stremio y fuentes propias en una lista única (dedup/orden). Solo P2P, sin indexar nada propio. No conoce engine/analyzer/playback: los orquesta `AppCore` (`../app.rs`). Comentarios y mensajes de usuario en español.

## Mapa (rutas relativas a esta carpeta)
- `mod.rs:204 struct Catalog` — estado vivo (http, caches, tokens de cancelación, `latest`); fachada que usa `AppCore`. `:41 MediaKind`, `:72 VideoId` (`tt` o `tt:T:E`), `:56 is_imdb_id`, `:66 recent_key`, `:919 by_relevance` (orden de búsqueda).
- `http.rs:70 struct Http` — único cliente: máx 2 req/host (`:17`), cuerpo 5 MB (`:16`), `get_json` `:103`, `get_json_auth` `:127`, `post_multipart_auth` `:147`, `get_large` `:204`; `FetchError` `:25`.
- `cinemeta.rs` — sin key: `search :84`, `trending :124`, `meta :164`, `is_excluded :321` (regla anime/Japón), `is_youtube_id :257`. Tipos `MetaPreview :18`, `Meta :35`.
- `tmdb.rs` — con key: `Posters :59`, `details :354` (+ `fetch_details :497`), `similar :568`, `episodes :687`, `identify :842` (nombre de release → tt), `names :427` / `localized :402` (títulos es/en), `first_trailer :315`, `providers_ar :275`, `people :224` (cast/director de una ficha).
- `people.rs` — buscar actor/director: `search :94`, `credits :142`, `pick :166` (filtros).
- `top.rs` — Explorar con filtros IMDb: `TopRated :181` (`list :204`, `scored :222`, `ratings :260`), `imdb_dataset :342` (descarga .gz + caché 1 día), `genre_list :123`, `rank :495`.
- `seasons.rs` — puntaje por temporada: `Seasons :79` (`list :97`, `index :123` arma/lee índice serie→temporadas, `status :164`), `build_index :300`.
- `addons.rs` — `Addon::streams :69` (despacha por `SourceKind` a las fuentes propias o al protocolo Stremio), `fetch_manifest :152`, `normalize_url :189`.
- `protocol.rs` — tipos tolerantes del protocolo Stremio (`Manifest :30`, `Stream :91`, `RawMeta :138`, `encode_extra :209`).
- `normalize.rs` — `parse :89` (Stream → `StreamCandidate :15` | NeedsConfig | Skip), `release_tags :240`, `parse_size :400`, `clean :416` (sanea texto externo).
- `aggregate.rs` — `run_inner :363` (fan-out de addons + scrape de seeders + nombres TMDB, emite `StreamsUpdate :58` cada 250 ms), `Merged :67` (`add`, `sorted :121`), `merge :220`, `lang_group :261`, `run_offline :333` (tests).
- Fuentes propias: `wpreact.rs:201` (Hacktorrent/Pelispanda, API JSON), `elitetorrent.rs:275` (RSS+HTML, links ofuscados `decode_link :32`), `latteam.rs:118` (UNIT3D, token), `torbox.rs` (caché/stream/cast de TorBox: `cached :169`, `stream_url :412`, `cast_url :444`, `magnet_status :670`, `api :70`).

## Flujo
- Búsqueda: UI `catalog_search` → `app.rs:1375` → `mod.rs:284 search_flagging_excluded` → `search :252` (Cinemeta movie+series en paralelo, cancela la anterior con `supersede :179`, `by_relevance`) → spawn `find_excluded :596` (pide `meta` de cada resultado, emite excluidos).
- Ficha: `catalog_meta` → `mod.rs:535 meta` → mem (`metas`) → disco `ficha-v3-*` → `cinemeta::meta`; `with_votes :578` pone votos/puntaje IMDb si el dataset ya está en memoria.
- Detalle TMDB: `catalog_details` → `mod.rs:319` → `tmdb::details :354` → `tmdb-detalle-v5-…` o `fetch_details` (find → /movie|tv/{id}?append_to_response=videos,watch/providers,credits).
- Streams: `catalog_streams` → `mod.rs:647 streams` → caché `torrents-<video>.json` 1 h (`:660`) o `enabled_addons :616` → `start_streams :703` (aborta la anterior) → `aggregate::run` → por addon `Addon::streams` → `normalize::parse` → `Merged::add/merge` → scrape → `emit` (evento `StreamsUpdate`, `../events.rs:59`); al `done` con candidatos se guarda.
- Explorar sin key: `trending :444` → `browse_page :462` (caché disco + sirve vencida si falla red). Con key: `browse_top :490` → `top::list` (discover TMDB + fichas + dataset IMDb → `rank`).
- Actor/director: `people :401` → `people::search`; `person_titles :412` → `people::credits` → `top::scored`.
- TorBox: `torbox_cached :729` (caché `torbox2-<video>.json` 1 h) / `torbox_stream :752` / `torbox_cast :768`.
- Arranque: `warm_imdb :309` baja ratings + índice de temporadas en background.

## Conexiones
- Llama a: Cinemeta (`cinemeta.rs:13`), TMDB (`api.themoviedb.org/3`, imágenes `image.tmdb.org`), `datasets.imdbws.com` (`top.rs:23`, `seasons.rs:23`), addons Stremio arbitrarios, hacktorrent.cc/pelispanda.org, elitetorrent.com, lat-team.com, TorBox directo o proxy web `streamonte-web.vercel.app/api/desktop/torbox` (`torbox.rs:28`).
- Internos: `../datacache` (`data.get/put/read/write`, con edad), `../secrets` (keys: `tmdb-api-key`, `torbox-api-key`, `streamonte-web-code`, `lat-team-api-token`; URLs de addons secretos `mod.rs:151`), `../config` (`CatalogConfig`, `AddonEntry`, `SourceKind`), `../trackers` (scrape), `../audio`, `../release`, `../library` (`CatalogOrigin`).
- Quién llama: `../app.rs` (`catalog_*` desde `:1375`; keys/torbox `:728-766`; `torbox::set_shared :275,:702`), comandos Tauri `/Users/monti/Documents/Dev/streamonte/src-tauri/src/commands.rs:272-490` (registrados en `src-tauri/src/lib.rs`), UI vía `invoke` en `/Users/monti/Documents/Dev/streamonte/ui/src/api.js`. Otros usos: `../library.rs:628` (`release_tags`), `../events.rs:59`.

## Reglas / trampas
- Versiones de caché en el nombre de archivo: `tmdb-detalle-v5` (`tmdb.rs:370`), `ficha-v3` (`mod.rs:549`), `torbox2` (`mod.rs:734`), `imdb-temporadas-v1.tsv` (`seasons.rs:27`). Si cambia la forma serializada, subir la versión (lo viejo no se migra).
- TTLs: detalle/similares 7 d (`tmdb.rs:183`), fichas de películas/series terminadas 30 d, en emisión 12 h (`mod.rs:553`), lista de streams y TorBox 1 h (`mod.rs:64`), datasets IMDb 1 día (`top.rs:27`), fichas discover 90 d (`top.rs:29`).
- Sin key de TMDB todo lo de TMDB devuelve vacío/`None` sin error (`tmdb.rs:360`); `top::no_key :372` / `bad_key :379` sí dan error. La key va en la URL: nunca loguear la URL (usar `http::redact`).
- Exclusión anime: `cinemeta::is_excluded :321` (Japón 1º país, o Japón + Animación) y `tmdb.rs:817 best_hit`, `people.rs:166 pick` filtran `ja`. Golden `excluded.json` debe coincidir con la web.
- Límites: `MAX_PEOPLE=3` (`people.rs:19`), `MAX_CREDITS=80` (`:25`), `MIN_EPISODES=3` (cameos, `:23`), `NOT_ACTING` géneros TV (`:21`), reparto en ficha `take(3)` + 1 director solo en películas (`tmdb.rs:240`), `SIMILAR_MAX=8` (`tmdb.rs:182`), `MAX_PAGES=30` de discover (`top.rs:42`), `KEEP_MIN_VOTES=10` (`top.rs:33`), `MAX_STREAMS=1000` por addon (`addons.rs:15`), `MAX_TEXT=300` (`normalize.rs:87`).
- Dedup por info hash; el orden es grupo de idioma → sub es → resolución → seeders (scrape > declarados) → tamaño → hash (`aggregate.rs:121`). Candidato sin idioma nunca se descarta (`unknown`). Torrents de otra película se filtran con `Want` de TMDB (`other_film :183`, solo películas).
- Fuentes propias: wpreact/elitetorrent solo películas (`Unsupported` en series); latteam no probada en vivo y solo toma el hash del magnet (passkey fuera, `latteam.rs:5-9`); elitetorrent no evade Cloudflare.
- TorBox: una sola regla de destino en `torbox::api :70` (modo compartido por defecto `SHARED :30` → proxy web con cookie `code`; si no, key propia). `cached` descarta packs sin video real (`MIN_VIDEO :43`).
- `Http` por host: 2 en vuelo; ratings de IMDb pueden tardar al arrancar, por eso `quick` en `seasons::list :97` no espera al índice.
- Golden compartidos con la web (`/Users/monti/Documents/Dev/streamonte/packages/golden/`): `trailer.json`, `providers_ar.json`, `people.json` (tests en `tmdb.rs:995,1007,1017`), `show_status.json` (`seasons.rs:457`), `release.json` y `excluded.json` (`../../tests/it/golden.rs:14,30`). Salida de Rust = fuente de verdad; la web (`web/src/lib/server/golden.test.ts`) debe igualarla.

## Tests
- Unitarios `#[cfg(test)]` al pie de cada archivo (normalize `:426`, aggregate `:498`, top `:531`, mod `:949`); integración con addon mock en `../../tests/it/catalog_mock.rs`, golden en `../../tests/it/golden.rs`.
- `cargo nextest run -p streamonte-core <filtro>` (p. ej. `catalog::`); completo: `sh scripts/check.sh full`. `top.rs:649 dataset_real` descarga el dataset real (red).
