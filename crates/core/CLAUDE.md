# streamonte-core — núcleo (sin Tauri)
Biblioteca Rust: magnets, análisis de swarms, catálogo/addons, mpv/VLC, limpieza, subs. La UI solo habla con `app::AppCore` y recibe `events::CoreEvent`. Capas: encabezado de `src/lib.rs`.

## Para X → andá a Y (`crates/core/src/`)
- Nombre de release, temporada/episodio → `release.rs`. Orden de "Mis magnets" → `ranking.rs`, `library.rs`.
- Método que la UI llama → `app/{catalog,torbox,subtitles,settings}.rs` (`app/mod.rs` = `AppCore::start`).
- Evento a la UI → `events.rs` `CoreEvent`. Error que ve el usuario → `error.rs` `user_message`.
- Config/ajustes → `config.rs` (campos con `serde(default)`); keys → `secrets.rs`; rutas de datos → `paths.rs`; caché en disco → `datacache.rs`.
- Desktop↔web (código, apodo, cookie, key de TorBox) → `crate::web` + `crate::app::web`; reglas en el header de `crate::web`.
- Catálogo/torrents → `catalog/` · medir → `analyzer/` · motor → `engine/` · reproducir → `playback/` · subtítulos → `subtitles/` (cada uno con su CLAUDE.md).
- HTTP compartido (reintento, tope, `redact`) → `http.rs`. Magnets → `magnet.rs`; precarga → `preload.rs`.
- mpv: `player.rs`, `mpv_ipc.rs`, `player_eq.lua`. Limpieza de disco: `cleanup.rs`. Magnets pegados: `intake.rs`, `incoming.rs`, `clipboard.rs`.

## Relación
`app/` orquesta a todos; cada `pub fn` de `AppCore` = 1 comando de `src-tauri/src/commands.rs`.

## Trampas
- Sin `regex` (patrones a mano).
- Secretos nunca en `config.json` ni logs; en debug las keys van a `dev-secrets.json`.
- Largo = tarea tokio + `CoreEvent`; nada bloquea.

## Cómo se prueba
- Unit al pie de cada `.rs`; integración en `tests/` (`tests/CLAUDE.md`). `cargo nextest run -p streamonte-core <filtro>` · `sh scripts/check.sh full`.
- `examples/`: `analyze`, `play`, `bench`, `keep_test`, `announce_probe` usan red y swarms reales; `record_fixtures` (TMDB, con key) regraba `ui/mock/`.
