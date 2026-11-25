# crates/core/tests — integración del núcleo
- `it/main.rs` es UN solo binario de integración: prueba nueva = archivo en `it/` + `mod` en `main.rs`.
- Goldens: `it/golden.rs` lee 3 (`release`, `spanish_variant`, `mkv`); el resto, los tests unitarios (`packages/golden/CLAUDE.md`).
- Mocks: `it/catalog_mock.rs` (addon falso), `it/common.rs` (helpers). Fixtures de subs: `fixtures/subtitles/`.
- Red real: `#[ignore = "network"]` → `cargo nextest run -p streamonte-core --run-ignored all <filtro>`. `it/torbox_smoke.rs` necesita la key guardada.
- Cómo correr: `crates/core/CLAUDE.md`.
- `crates/core/tests/logger.rs` es un binario aparte (tocar el logger global).
