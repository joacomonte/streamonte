# subtitles/ — buscar, rankear, bajar, fusionar y cargar subtítulos
Busca en 6 fuentes gratis en paralelo, rankea, baja hasta 5, los carga en mpv + ASS fusionado y recuerda la elección por video.

## Para X → andá a Y
- Ranking, identidad del video, memoria de elección → `../subtitles.rs`.
- Buscar/bajar/guardar (`subs.json`) → `fetch.rs`. Sesión con mpv (teclas, cargar) → `session.rs`. Fusión de pistas → `merge.rs`.
- Una fuente → `providers/<x>.rs` (`wyzie` `subdivx` `gestdown` `subtitulamos` `opensubtitles_org` `opensubtitles` `torrent`); idioma por nombre → `providers/lang.rs`.
- Keys de OpenSubtitles → `secrets.rs`.

## Relación
Lo llaman `session::prefetch` y `analyzer/subs.rs`; Premium solo desde `app/subtitles.rs`.

## Trampas
- Latino/España: UNA regla, `audio::spanish_variant`.
- `lang.rs` `lang_from_name` = `isSpanishSub` de la web (golden `sub_lang.json`); cambiar uno = cambiar el otro.
- Orden: torrent > calce > variante (latino > España) > OpenSubtitles.com > descargas.
- OpenSubtitles.com: cuota global, se chequea ANTES de cada descarga; Premium solo a pedido, nunca en lote.
- `subs.json` se invalida si cambia el idioma o faltan archivos. Subdivx: no se evaden bloqueos. Teclas por `define-section`.

## Cómo se prueba
Unit por archivo; fixtures `crates/core/tests/fixtures/subtitles/`. `cargo nextest run -p streamonte-core subtitles`.
