//! Pruebas de integración en un solo binario (compila y linkea una vez). `logger.rs` queda aparte:
//! instala el suscriptor global de `tracing`.

mod acceptance;
mod catalog_mock;
mod common;
mod config_updates;
