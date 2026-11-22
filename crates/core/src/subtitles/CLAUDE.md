# subtitles — buscar, rankear, bajar, fusionar y cargar subtítulos en mpv

Núcleo (nivel 3, sin Tauri). Busca en 6 fuentes gratis en paralelo, rankea, baja hasta 5 (`MAX_SUBTITLES`), los carga en mpv + un ASS fusionado "comparar", y recuerda la elección por video.

## Mapa (rutas desde `/Users/monti/Documents/Dev/streamonte/crates/core/src/`)
- `subtitles.rs` — tipos y reglas puras. `:42 VideoIdentity` (`:101 for_file`, `:116 apply_catalog`, `:139 video_id`, `:73 confidence`) · `:177 movie_hash` (hash OpenSubtitles) · `:188 subtitle_files_for` (subs sueltos del torrent) · `:247 spanish_natives` (embebidos/sueltos en español, claves `embedded:<sid>` / `torrent:…`) · `:304 MatchKind` · `:318 SubtitleCandidate` (`:338 key()` = `proveedor:id`) · `:354 fit_by_timing` · `:374 rank_order` / `:386 top_candidates` · `:413 apply_sync_key`, `:430 sync_message` · `:462 SubtitleChoice` · `:483 SubtitleMemory` (`subtitles-memory.json`, `:518 choose`). `:445 AutoSync` es trait sin implementar (FR-27, F7).
- `subtitles/fetch.rs` — sin mpv. `:49 fetch(Fetch)` (nunca falla; errores al log) · `:172 subs.json` índice por carpeta (`:206 load_saved`, `:232 save`, `:265 save_copy`, `:297 add_saved`, `:307 merge_saved`) · `:334 search_all` · `:368 download_best` · `:414 dedup_by_content` · `:431 remembered_candidate` · `:459 video_hash` (lee 64 KiB inicio+fin por el motor).
- `subtitles/session.rs` — con mpv abierto. `:74 prefetch` (lanza `fetch` antes de mpv; `Prefetch` aborta al soltarse) · `:130 run` · `:153 bind_keys` (`define-section`, no pisa `input.conf`) · `:168 find_and_load` · `:331 load_merged` · `:376 select` · `:408 key_loop` (1–5, 0, S, Z/X, Shift, R) · `:488 remember`. Re-exporta `fetch`, `add_saved`, `merge_saved`, `save_copy`, `Fetch`, `LogFn` (`:30`).
- `subtitles/merge.rs` — `:36 merge_ass` (hasta 5 → 1 ASS, 1 estilo/color por fuente, guía arriba) · `:52 merge_cues` · parsers `:146 parse_srt`, `:199 parse_ass`, `:136 parse_any`.
- `subtitles/secrets.rs` — API keys en el keychain vía `crate::secrets`: `:8 KEY_PROVIDERS` (opensubtitles, wyzie) · `:12 key_page` · `:31 set_api_key` · `:44 api_key` · `:50 set_opensubtitles_login`.
- `subtitles/providers.rs` — `:52 trait SubtitleProvider` (id/quota/search/download) · ids `:66-73` · `:76 ALL` · `:87 display_name` · `:176 release_match` · errores `:103-160` (`looks_like_cloudflare`).
- `providers/` (detalle abajo): `torrent.rs` `TorrentProvider`, `wyzie.rs` `:30 parse_wyzie`, `subdivx.rs` `:22 parse_subdivx`, `gestdown.rs` `:36 parse_gestdown`, `subtitulamos.rs` `:66 parse_subtitulamos`, `opensubtitles_org.rs` `:163 parse_search`/`:238 decode_download`, `opensubtitles.rs` (.com, Premium, `:31 QuotaGate`), `imdb.rs` `:11 resolve_imdb`, `lang.rs` `:10 lang_from_name`, `cache.rs` `:43 cached`/`:77 save`, `archive.rs` `:12 extract_if_archive`, `http.rs` clientes.

## Providers (todos `impl SubtitleProvider`, parsers `parse_*` puros con fixtures)
- Torrent: lee `.srt/.ass` por el stream del motor (`url` 127.0.0.1). Wyzie: exige IMDb id + key. Subdivx: scrape web, experimental, omite ante Cloudflare. Gestdown y Subtitulamos: solo series, sin key. OpenSubtitles.org: XML-RPC anónimo (UA `VLSub 0.11.1`, `spl`=latino, `spa`), la que más español tiene. OpenSubtitles.com: key + login del usuario, ~20 descargas/día.
- `archive.rs`: zip/rar/7z con el `tar` del sistema (sin dependencias). `cache.rs`: normaliza a UTF-8 (BOM, UTF-16, Latin-1/Win-1252).

## Flujo
- Fetch: `session::prefetch` (playback/flow.rs:578) o `analyzer/subs.rs:83` → `fetch.rs:49 fetch` → `load_saved` (si hay `subs.json` con mismo idioma, sin buscar) → hash + `resolve_imdb` → `search_all` (6 free × 2 idiomas, timeout 20 s) → `fit_by_timing` → `top_candidates` → idioma elegido primero, recordado primero → `download_best` (tandas, 40 s) → `dedup_by_content` → `save` (`subs.json`).
- Reproducir: `playback/flow.rs:592 SessionRequest` → `session::run` → espera el `Prefetch` → carga pistas + `load_merged` (`merge_ass`) → `key_loop` → `remember` (`SubtitleMemory`).
- Premium (a pedido): `app.rs:1216 catalog_premium_search` → `:1235 catalog_premium_use` (baja 1, `add_saved`, memoria). Nunca en la búsqueda en lote.

## Conexiones
- Entra desde: `app.rs` (`:866 playback_subtitle`, `:1121 catalog_subtitles`, `:1177 catalog_subtitle_use`, `:1216/:1235` premium, `:1348 subtitle_files`, keys `:732-767`), `playback/flow.rs:513 prefetch_subtitles`, `analyzer/subs.rs`, `analyzer/pipeline.rs:138`, `library.rs:343 spanish_natives`, `player.rs:408 sub_tracks`, `catalog/torbox.rs:276 lang_from_name`, `release.rs:10 SUBTITLE_EXTENSIONS`.
- Usa: `player::MpvControl`/`MpvEvent` (`player.rs:191`), `crate::http` (HttpError/Limits), `audio::spanish_variant`/`spanish_track` (regla única latino/España), `fsutil`, `secrets`, `video_key::VideoKey`, `config::SubtitleLanguage`, `engine::{FileInfo,Metadata}`, `release::parse_release_name`, `catalog::cinemeta` (IMDb id).
- Externos: api.opensubtitles.com/.org, sub.wyzie.io, subdivx.com, subtitulamos.tv, api.gestdown.info, Cinemeta/IMDb suggest. Keychain: cuentas `wyzie-api-key`, `opensubtitles-api-key` (service `streamonte`). Sin config.json para keys.

## Reglas / trampas
- Latino/España: UNA sola regla, `audio::spanish_variant` (audio.rs:100); Wyzie suma bandera de país (`wyzie.rs:101`), org usa `spl` (`opensubtitles_org.rs:183`), .com `ea` (`opensubtitles.rs:300`).
- `lang.rs:10 lang_from_name` debe coincidir con `isSpanishSub` de la web (`/Users/monti/Documents/Dev/streamonte/web/src/lib/server/torbox.ts:13`); golden `/Users/monti/Documents/Dev/streamonte/packages/golden/sub_lang.json` lo valida en `lang.rs:55` y `web/.../golden.test.ts:46`. Cambiar uno = cambiar el otro.
- Orden (`rank_order`): torrent > calce (Exact/Release/Fps/None) > variante (latino>España>?) > OpenSubtitles.com > descargas.
- OpenSubtitles.com: cuota única global (`QuotaGate`, ADR-12), se chequea ANTES de cada descarga; sesión 23 h (`opensubtitles.rs:165`). `.org`: `LIMIT_REACHED` (`:30`) corta búsquedas al topar.
- `subs.json` se invalida si cambia el idioma o faltan archivos (`SAVED_VERSION=2`, `fetch.rs:175`); `merge_saved` junta lo pendiente al ya tener carpeta.
- Elección recordada de otro idioma no aplica (`session.rs:86`); `SubtitleChoice.language` default Es.
- Subdivx: no se evaden bloqueos (R-09). Teclas por `define-section`: `--input-conf` pisaría el del usuario.
- Keys: en builds debug van a `dev-secrets.json` (config_dir), no al keychain (`secrets.rs:35`, `mod dev_store :100`); release = keychain.
- Memoria corrupta se aparta (`quarantine`), nunca rompe la reproducción.

## Tests
- Unit en cada archivo (`#[cfg(test)]`); fixtures `/Users/monti/Documents/Dev/streamonte/crates/core/tests/fixtures/subtitles/` (`opensubtitles-search.json`, `subdivx-search.json`, `wyzie-search.json`, `movie-hash.txt`).
- `cargo nextest run -p streamonte-core subtitles` · todo: `sh scripts/check.sh full`.
- Ejemplos: `examples/subs_merge.rs`, `examples/subtitle_key.rs`.
