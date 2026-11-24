//! Eventos núcleo → UI. El núcleo no conoce Tauri: emite a través de [`EventSink`] y la
//! cáscara (src-tauri) lo implementa con `AppHandle::emit` (NFR-01, NFR-10).
//! Un solo evento `core://event` (ver src-tauri/src/lib.rs); la variante va en `type` en kebab-case (ver ui/src/live.svelte.ts).

use serde::Serialize;

use crate::analyzer::AnalyzerState;
use crate::library::LibraryRowView;
use crate::magnet::InfoHash;
use crate::playback::{PlaybackId, PlaybackRow};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum CoreEvent {
    /// Una fila cambió (alta, medición nueva…). Se manda la vista completa, igual a la de
    /// `library()` (con bytes en disco y clave de orden): la UI la reemplaza y reordena sin
    /// volver a pedir la lista (FR-03, FR-07).
    LibraryEntryUpdated {
        entry: Box<LibraryRowView>,
    },
    /// Se quitó UNA fila (un video: `VideoKey` como texto).
    LibraryEntryRemoved {
        key: crate::video_key::VideoKey,
    },

    /// Historial Win+V desactivado o no disponible (FR-02, NFR-13).
    ClipboardHistoryUnavailable {
        reason: ClipboardUnavailable,
    },

    /// Progreso del análisis para la barra de estado (FR-08, FR-29).
    AnalyzerProgress {
        state: AnalyzerState,
    },

    /// Qué magnets esperan análisis y cuáles están pausados uno por uno (2026-11-14).
    AnalyzerQueue {
        queued: Vec<InfoHash>,
        held: Vec<InfoHash>,
    },

    /// Fila del panel de reproducciones (FR-14). Se emite como máximo 2 veces/s por fila.
    PlaybackUpdated {
        row: PlaybackRow,
    },
    PlaybackRemoved {
        id: PlaybackId,
    },

    /// Línea de log en vivo de una reproducción ("Ver detalle", FR-15).
    PlaybackLog {
        id: PlaybackId,
        line: String,
    },

    /// Streams de un video del catálogo, a medida que responden los addons (FR-42).
    /// Lista completa ya fusionada y ordenada; como mucho ~4 por segundo.
    CatalogStreams {
        update: crate::catalog::aggregate::StreamsUpdate,
    },
    /// Un resultado de búsqueda resultó ser anime / japonés (FR-40): la UI lo oculta si el
    /// filtro está activo.
    CatalogExcluded {
        id: String,
    },

    /// Progreso de "Bajar subtítulos" de un video del catálogo (2026-11-15): buscando, o bajando
    /// `done` de `total`.
    /// "Contar seeders" (2026-11-15): un torrent ya contado (los demás siguen).
    CatalogSwarmCounted {
        hash: InfoHash,
        count: crate::analyzer::swarm::SwarmCount,
        /// `false` = prueba rápida (2026-11-17); la UI los guarda aparte.
        deep: bool,
    },
    /// Conteo parcial mientras cuenta (2026-11-15): la UI lo muestra en vivo en la fila. Sin
    /// metadatos todavía, `reached = false` y `peers` = los que encontró la DHT.
    CatalogSwarmProgress {
        hash: InfoHash,
        count: crate::analyzer::swarm::SwarmCount,
        deep: bool,
    },
    CatalogSubtitlesProgress {
        video_id: String,
        downloading: bool,
        done: usize,
        total: usize,
    },

    /// Una línea del log del núcleo para la burbuja de actividad (`activity`): ya sin secretos
    /// y con límite de mensajes por segundo.
    Activity {
        level: StatusLevel,
        /// `analisis`, `motor`, `reproduccion`, `subtitulos`, `catalogo`, `limpieza`, `red`,
        /// `portapapeles` o `general`.
        area: &'static str,
        message: String,
        at: chrono::DateTime<chrono::Utc>,
    },

    /// Se pidió cerrar la ventana con `active` reproducciones activas: la UI pregunta qué hacer
    /// y responde con `on_close` (FR-17). Cada clic en la X lo vuelve a emitir.
    ConfirmClose {
        active: usize,
    },

    /// Test de velocidad de internet (2026-11-16): midiendo, listo o falló.
    SpeedTest {
        state: crate::speedtest::SpeedState,
    },

    /// Mensaje para la barra de estado (NFR-12).
    Status {
        level: StatusLevel,
        message: String,
    },
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClipboardUnavailable {
    /// Windows con el historial (Win+V) apagado: se usa solo el último copiado.
    HistoryDisabled,
    /// macOS / otros: no existe historial del sistema.
    NotSupportedOnThisOs,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum StatusLevel {
    Info,
    Warn,
    Error,
}

/// Destino de los eventos. Implementado por la cáscara Tauri y por un sink de pruebas.
pub trait EventSink: Send + Sync + 'static {
    fn emit(&self, event: CoreEvent);
}

/// Sink que descarta todo (pruebas unitarias, herramientas de línea de comandos).
pub struct NullSink;

impl EventSink for NullSink {
    fn emit(&self, _event: CoreEvent) {}
}
