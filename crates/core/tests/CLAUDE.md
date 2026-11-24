# crates/core/tests — integración del núcleo
- `it/main.rs` es UN solo binario de integración: prueba nueva = archivo en `it/` + `mod` en `main.rs`.
- Goldens: `it/golden.rs` lee `packages/golden/*.json` (`packages/golden/CLAUDE.md`).
- Mocks: `it/catalog_mock.rs` (addon falso), `it/common.rs` (helpers). Fixtures de subs: `fixtures/subtitles/`.
- Red real: `#[ignore = "network"]` → `cargo nextest run -p streamonte-core --run-ignored all <filtro>`. `it/torbox_smoke.rs` necesita la key guardada.
- Correr: `cargo nextest run -p streamonte-core <filtro>`; todo: `sh scripts/check.sh full`.
- `crates/core/tests/logger.rs` es un binario aparte (tocar el logger global).
