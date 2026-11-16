//! NFR-15 / Q-06: logs generales siempre; diagnóstico solo cuando se activa, en caliente.
//! Binario de prueba propio porque `logger::init` instala el suscriptor global una sola vez.

use streamonte_core::config::{LogLevel, LoggingConfig};
use streamonte_core::logger::{self, DIAG_MPV, DIAG_PRELOAD};
use streamonte_core::paths::AppPaths;

fn read_dir_text(dir: &std::path::Path, prefix: &str) -> String {
    std::fs::read_dir(dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with(prefix))
        .map(|e| std::fs::read_to_string(e.path()).unwrap())
        .collect()
}

#[test]
fn nfr_15_general_siempre_y_diagnostico_opcional_en_caliente() {
    let root = std::env::temp_dir().join(format!("streamonte-test-logger-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let paths = AppPaths::under(&root);
    let mut cfg = LoggingConfig {
        level: LogLevel::Info,
        diagnostics: false,
    };

    let guard = logger::init(&paths, &cfg).unwrap();

    tracing::info!("evento-general-1");
    tracing::debug!("evento-debug-oculto");
    tracing::debug!(target: DIAG_PRELOAD, "diag-apagado");

    cfg.diagnostics = true;
    logger::apply(&cfg).unwrap();
    assert!(logger::diagnostics_enabled());
    tracing::debug!(target: DIAG_PRELOAD, pieza = 12, "diag-precarga-encendido");
    tracing::info!(target: DIAG_MPV, "diag-mpv-encendido");

    cfg.diagnostics = false;
    logger::apply(&cfg).unwrap();
    tracing::debug!(target: DIAG_PRELOAD, "diag-apagado-otra-vez");

    drop(guard); // vacía buffers

    let general = read_dir_text(&paths.log_dir, "streamonte");
    assert!(general.contains("evento-general-1"));
    assert!(
        !general.contains("evento-debug-oculto"),
        "nivel info filtra debug"
    );
    assert!(
        !general.contains("diag-"),
        "el diagnóstico no ensucia el log general"
    );

    let preload = read_dir_text(&paths.log_dir, "diag-preload");
    assert!(preload.contains("diag-precarga-encendido"));
    assert!(preload.contains("pieza=12"));
    assert!(!preload.contains("diag-apagado"));

    let mpv = read_dir_text(&paths.log_dir, "diag-mpv");
    assert!(mpv.contains("diag-mpv-encendido"));

    std::fs::remove_dir_all(&root).unwrap();
}
