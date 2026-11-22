# subtitles — buscar, rankear, bajar, fusionar y cargar subtítulos en mpv

Busca en 6 fuentes gratis en paralelo, rankea, baja hasta 5 (`MAX_SUBTITLES`), los carga en mpv + ASS fusionado, y recuerda la elección por video. Base `/Users/monti/Documents/Dev/streamonte/crates/core/src/`.

## Mapa
- `subtitles.rs:41 VideoIdentity` · `:176 movie_hash` · `:246 spanish_natives` · `:303 MatchKind` · `:317 SubtitleCandidate` · `:353 fit_by_timing` · `:373 rank_order` · `:385 top_candidates` · `:448 SubtitleChoice` · `:469 SubtitleMemory`
- `subtitles/fetch.rs:49 fetch` · `:334 search_all` · `:368 download_best` · `:414 dedup_by_content` · `:206 load_saved` · `:297 add_saved` · `:307 merge_saved`
- `subtitles/session.rs:74 prefetch` · `:130 run` · `:153 bind_keys` · `:331 load_merged` · `:408 key_loop` · `:488 remember`
- `subtitles/merge.rs:36 merge_ass` · `:52 merge_cues` · `:146 parse_srt` · `:199 parse_ass`
- `subtitles/secrets.rs:8 KEY_PROVIDERS` · `:31 set_api_key` · `:44 api_key`
- `subtitles/providers.rs:52 trait SubtitleProvider` · `:76 ALL` · `providers/`: `wyzie` `subdivx` `gestdown` `subtitulamos` `opensubtitles_org` (XML-RPC, la con más español) `opensubtitles` (.com, Premium) `torrent` · `lang.rs:10 lang_from_name` · `cache.rs:43 cached` · `archive.rs:12 extract_if_archive`

## Flujo
- `session::prefetch` / `analyzer/subs.rs:83` → `fetch.rs:49` → `load_saved` → `search_all` → `fit_by_timing` → `top_candidates` → `download_best` → `dedup_by_content` → `save` (`subs.json`) → `session::run` → `load_merged` → `key_loop` → `remember`.

## Trampas
- Latino/España: UNA regla, `audio::spanish_variant` (`audio.rs:100`); Wyzie suma bandera (`wyzie.rs:101`), org `spl` (`opensubtitles_org.rs:183`), .com `ea` (`opensubtitles.rs:300`).
- `lang.rs:10 lang_from_name` debe coincidir con `isSpanishSub` de la web (`/Users/monti/Documents/Dev/streamonte/web/src/lib/server/torbox.ts:13`); golden `/Users/monti/Documents/Dev/streamonte/packages/golden/sub_lang.json` (`lang.rs:55`). Cambiar uno = cambiar el otro.
- Orden (`rank_order`): torrent > calce > variante (latino>España) > OpenSubtitles.com > descargas.
- OpenSubtitles.com: cuota global `QuotaGate` (`:31`), se chequea ANTES de cada descarga; sesión 23 h (`opensubtitles.rs:165`). `.org`: `LIMIT_REACHED` (`opensubtitles_org.rs:30`).
- `subs.json` se invalida si cambia el idioma o faltan archivos (`SAVED_VERSION=2`, `fetch.rs:175`).
- Elección recordada de otro idioma no aplica (`session.rs:86`). Subdivx: no se evaden bloqueos (R-09). Teclas por `define-section` (no pisa `input.conf`).
- Premium solo a pedido (`app.rs:1216`, `:1235`), nunca en lote. Keys en debug → `dev-secrets.json` (`secrets.rs:100`).

## Tests
- Unit por archivo; fixtures `/Users/monti/Documents/Dev/streamonte/crates/core/tests/fixtures/subtitles/`. `cargo nextest run -p streamonte-core subtitles`.
