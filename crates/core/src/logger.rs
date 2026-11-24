//! `logger` — logs por nivel + logs de diagnóstico opcionales (NFR-15, Q-06).
//!
//! - `streamonte.<fecha>.log` (rotación diaria, últimos 7): nivel configurable, siempre activo.
//! - Diagnóstico (solo si `LoggingConfig::diagnostics`): se activa/desactiva en caliente.
//!   Misma rotación que el general (`<nombre>.<fecha>.log`, últimos 7).
//!   - target [`DIAG_PRELOAD`] → `diag-preload`: piezas por rango, peers que las tienen, bloqueos (lección 9).
//!   - target [`DIAG_MPV`]     → `diag-mpv-ipc`: eventos IPC de mpv (su `--log-file` va a la misma carpeta).
//!   - target [`DIAG_ENGINE`]  → `diag-engine`: stderr del motor.
//!
//! Uso desde otros módulos: `tracing::debug!(target: logger::DIAG_PRELOAD, piece = 12, peers = 7, "pedida")`.
//! Siempre a archivo, nunca a la pantalla (lección 8: `\r` no se ve desde afuera).
//!
//! Por qué filtros con atómicos y no `reload`: el nivel y el diagnóstico cambian desde Ajustes
//! sin reiniciar; leer dos atómicos por evento es más simple que tipar handles de `reload`.
//! Al cambiarlos se reconstruye la caché de "interés" de `tracing` para que el cambio aplique ya.

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};

use tracing::Metadata;
use tracing_appender::non_blocking::{NonBlocking, WorkerGuard};
use tracing_appender::rolling::{self, Rotation};
use tracing_subscriber::filter::{filter_fn, LevelFilter};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::registry::LookupSpan;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{fmt, Layer};

use crate::config::{LogLevel, LoggingConfig};
use crate::paths::AppPaths;
use crate::{CoreError, Result};

pub const DIAG_PRELOAD: &str = "diag::preload";
pub const DIAG_MPV: &str = "diag::mpv";
pub const DIAG_ENGINE: &str = "diag::engine";

pub(crate) const DIAG_PREFIX: &str = "diag::";
const KEEP_DAILY_FILES: usize = 7;

static LEVEL: AtomicU8 = AtomicU8::new(level_code(LogLevel::Info));
static DIAGNOSTICS: AtomicBool = AtomicBool::new(false);

/// Mantener vivo mientras corre la app: al soltarse vacía los buffers a disco.
pub struct LoggerGuard {
    _guards: Vec<WorkerGuard>,
}

/// Inicializa `tracing`: archivo general + un archivo por target de diagnóstico.
/// Solo puede llamarse una vez por proceso.
pub fn init(paths: &AppPaths, config: &LoggingConfig) -> Result<LoggerGuard> {
    std::fs::create_dir_all(&paths.log_dir).map_err(|source| CoreError::Io {
        path: paths.log_dir.clone(),
        source,
    })?;

    let daily = |prefix: &str| {
        rolling::Builder::new()
            .rotation(Rotation::DAILY)
            .filename_prefix(prefix)
            .filename_suffix("log")
            .max_log_files(KEEP_DAILY_FILES)
            .build(&paths.log_dir)
            .map_err(|e| CoreError::Logger(e.to_string()))
    };
    let general_file = daily("streamonte")?;

    let mut guards = Vec::new();
    let mut writer = |appender: rolling::RollingFileAppender| {
        let (nb, guard) = tracing_appender::non_blocking(appender);
        guards.push(guard);
        nb
    };

    let general = fmt::layer()
        .with_ansi(false)
        .with_writer(writer(general_file))
        .with_filter(filter_fn(general_enabled));

    let preload = diag_layer(DIAG_PRELOAD, writer(daily("diag-preload")?));
    // No "diag-mpv": la poda borra por prefijo y se llevaría `diag-mpv-player.log` (el de mpv).
    let mpv = diag_layer(DIAG_MPV, writer(daily("diag-mpv-ipc")?));
    let engine = diag_layer(DIAG_ENGINE, writer(daily("diag-engine")?));

    tracing_subscriber::registry()
        .with(general)
        .with(preload)
        .with(mpv)
        .with(engine)
        .with(crate::activity::layer())
        .try_init()
        .or_else(|e| {
            // Segundo núcleo en el mismo proceso (pruebas, herramientas): se sigue usando el
            // registro ya instalado; solo se aplica la config nueva.
            if tracing::dispatcher::has_been_set() {
                tracing::debug!("logger ya iniciado en este proceso: se reutiliza ({e})");
                Ok(())
            } else {
                Err(CoreError::Logger(e.to_string()))
            }
        })?;

    apply(config)?;
    tracing::info!(version = env!("CARGO_PKG_VERSION"), log_dir = ?paths.log_dir, "logger iniciado");
    Ok(LoggerGuard { _guards: guards })
}

/// Cambia nivel / diagnóstico sin reiniciar (Ajustes).
pub fn apply(config: &LoggingConfig) -> Result<()> {
    LEVEL.store(level_code(config.level), Ordering::Relaxed);
    DIAGNOSTICS.store(config.diagnostics, Ordering::Relaxed);
    tracing::callsite::rebuild_interest_cache();
    Ok(())
}

pub fn diagnostics_enabled() -> bool {
    DIAGNOSTICS.load(Ordering::Relaxed)
}

/// Capa de un archivo de diagnóstico: solo eventos de `target` y solo con diagnóstico activo.
fn diag_layer<S>(target: &'static str, writer: NonBlocking) -> impl Layer<S>
where
    S: tracing::Subscriber + for<'a> LookupSpan<'a>,
{
    fmt::layer()
        .with_ansi(false)
        .with_target(false)
        .with_writer(writer)
        .with_filter(filter_fn(move |m| diag_enabled(m, target)))
}

fn general_enabled(m: &Metadata<'_>) -> bool {
    !m.target().starts_with(DIAG_PREFIX)
        && !utp_noise(m)
        && (level_allows(LEVEL.load(Ordering::Relaxed), m) || upnp_result(m))
}

/// uTP avisa "too many concurrent connectins" cuando varios torrents a la vez (prueba rápida) intentan
/// conectarse a la propia IP pública, que la red devuelve como un peer más: inofensivo y repetido.
/// De uTP solo pasan los errores (2026-11-17), al log y a la actividad.
pub(crate) fn utp_noise(m: &Metadata<'_>) -> bool {
    m.target().starts_with("librqbit_utp") && *m.level() > tracing::Level::ERROR
}

/// librqbit loguea el éxito del mapeo UPnP en debug: se deja pasar para ver si funcionó (ADR-30).
pub(crate) fn upnp_result(m: &Metadata<'_>) -> bool {
    m.target().starts_with("librqbit_upnp") && *m.level() <= tracing::Level::DEBUG
}

fn diag_enabled(m: &Metadata<'_>, target: &str) -> bool {
    DIAGNOSTICS.load(Ordering::Relaxed) && m.target() == target
}

const fn level_code(level: LogLevel) -> u8 {
    match level {
        LogLevel::Error => 0,
        LogLevel::Warn => 1,
        LogLevel::Info => 2,
        LogLevel::Debug => 3,
        LogLevel::Trace => 4,
    }
}

fn level_allows(code: u8, m: &Metadata<'_>) -> bool {
    let filter = match code {
        0 => LevelFilter::ERROR,
        1 => LevelFilter::WARN,
        2 => LevelFilter::INFO,
        3 => LevelFilter::DEBUG,
        _ => LevelFilter::TRACE,
    };
    *m.level() <= filter
}
