//! Eventos núcleo → UI. El núcleo no conoce Tauri: emite a través de [`EventSink`] y la
//! cáscara (src-tauri) lo implementa con `AppHandle::emit` (NFR-01, NFR-10).
//! Nombres de evento en la UI: `core://<variante en kebab-case>` (ver ui/src/api.js).

use serde::Serialize;

use crate::analyzer::AnalyzerState;
use crate::library::LibraryEntry;
use crate::magnet::InfoHash;
use crate::playback::{PlaybackId, PlaybackRow};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum CoreEvent {
    /// La biblioteca cambió (alta, baja, medición nueva). Se manda la fila completa
    /// para que la UI no tenga que volver a pedir la lista (FR-03, FR-07).
    LibraryEntryUpdated {
        entry: Box<LibraryEntry>,
    },
    LibraryEntryRemoved {
        info_hash: InfoHash,
    },
    LibraryCleared,

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
