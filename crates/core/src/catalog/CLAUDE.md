# catalog (streamonte-core)

Busca películas/series (Cinemeta + TMDB), enriquece fichas (TMDB, datasets IMDb) y junta torrents de addons Stremio y fuentes propias en una lista única. No conoce engine/analyzer/playback: los orquesta `AppCore`.

## Mapa (rutas relativas a esta carpeta)
- `mod.rs:204 Catalog` · `:41 MediaKind` · `:72 VideoId` · `:919 by_relevance` · `:535 meta` · `:647 streams` · `:703 start_streams` · `:729 torbox_cached`
- `http.rs:70 Http` (2 req/host `:17`, 5 MB `:16`) · `:103 get_json` · `:127 get_json_auth` · `FetchError:25`
- `cinemeta.rs:84 search` · `:124 trending` · `:164 meta` · `:321 is_excluded`
- `tmdb.rs:354 details` · `:497 fetch_details` · `:568 similar` · `:687 episodes` · `:842 identify` · `:427 names` · `:315 first_trailer` · `:275 providers_ar`
- `people.rs:94 search` · `:142 credits` · `:166 pick`
- `top.rs:181 TopRated` · `:204 list` · `:342 imdb_dataset` · `:495 rank` · `seasons.rs:79 Seasons` · `:97 list` · `:300 build_index`
- `addons.rs:69 Addon::streams` · `:152 fetch_manifest` · `protocol.rs:30 Manifest` · `:91 Stream`
- `normalize.rs:89 parse` · `:15 StreamCandidate` · `aggregate.rs:363 run_inner` · `:67 Merged` · `:121 sorted` · `:220 merge`
- Fuentes propias: `wpreact.rs:201` · `elitetorrent.rs:275` · `latteam.rs:118` · `torbox.rs:70 api` · `:169 cached` · `:412 stream_url`

## Flujo
- Streams: `catalog_streams` → `mod.rs:647 streams` → caché 1 h o `start_streams:703` → `aggregate::run` → `Addon::streams` → `normalize::parse` → `Merged::add/merge` → scrape → `StreamsUpdate` (`../events.rs:59`).
- Búsqueda: `mod.rs:284 search_flagging_excluded` → `search:252` → spawn `find_excluded:596`. Ficha: `mod.rs:535 meta` → mem → disco `ficha-v3-*` → `cinemeta::meta`.

## Trampas
- Versión de caché en el nombre de archivo: `tmdb-detalle-v5` (`tmdb.rs:370`), `ficha-v3` (`mod.rs:549`), `torbox2` (`mod.rs:736`), `imdb-temporadas-v1` (`seasons.rs:27`). Si cambia la forma serializada, subir la versión (no se migra).
- TTLs: detalle/similares 7 d (`tmdb.rs:183`), fichas 30 d / en emisión 12 h (`mod.rs:553`), streams y TorBox 1 h (`mod.rs:64`), datasets IMDb 1 día (`top.rs:27`), discover 90 d (`top.rs:29`).
- Sin key de TMDB → vacío/`None` sin error (`tmdb.rs:354 details`); `top::no_key :372`/`bad_key :379` sí dan error. La key va en la URL: nunca loguear URL (`http::redact`).
- Exclusión anime: `cinemeta::is_excluded:321`, `tmdb.rs:817 best_hit`, `people.rs:166 pick`; golden `excluded.json` = web.
- Dedup por info hash; orden idioma → sub es → resolución → seeders → tamaño → hash (`aggregate.rs:121`). Candidato sin idioma nunca se descarta.
- wpreact/elitetorrent solo películas; latteam solo toma el hash del magnet (`latteam.rs:5-9`); elitetorrent no evade Cloudflare.
- TorBox: una regla de destino en `torbox::api:70` (compartido `SHARED:30` → proxy web con cookie `code`; si no, key propia).
- Golden compartidos con la web (`/Users/monti/Documents/Dev/streamonte/packages/golden/`): `trailer`, `providers_ar`, `people` (`tmdb.rs:995,1007,1017`), `show_status` (`seasons.rs:457`), `release`/`excluded` (`../../tests/it/golden.rs:14,30`).

## Tests
- `#[cfg(test)]` al pie (normalize `:426`, aggregate `:498`, top `:531`, mod `:949`); addon mock en `../../tests/it/catalog_mock.rs`. `top.rs:649 dataset_real` usa red. `cargo nextest run -p streamonte-core catalog::`.
