//! Errores del núcleo. Cada variante lleva un mensaje entendible para el usuario (NFR-12):
//! la UI muestra `user_message()`, el log guarda el detalle técnico (`Display`).

use std::path::PathBuf;

pub type Result<T, E = CoreError> = std::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("magnet inválido: {0}")]
    InvalidMagnet(String),

    #[error("no se encontró el ejecutable {name} (configurable en Ajustes)")]
    ExecutableNotFound { name: &'static str },

    #[error("el motor de torrent falló: {0}")]
    Engine(String),

    #[error("tiempo agotado esperando {what} ({secs} s)")]
    Timeout { what: &'static str, secs: u64 },

    #[error("el reproductor falló: {0}")]
    Player(String),

    #[error("proveedor de subtítulos {provider}: {message}")]
    Subtitles {
        provider: &'static str,
        message: String,
    },

    #[error("archivo {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("JSON inválido en {path}: {source}")]
    Json {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },

    #[error("no soportado en este sistema: {0}")]
    Unsupported(&'static str),

    #[error("cancelado")]
    Cancelled,

    #[error("no encontrado: {0}")]
    NotFound(String),

    #[error("portapapeles: {0}")]
    Clipboard(String),

    #[error("no se pudo iniciar el registro (logs): {0}")]
    Logger(String),

    /// Catálogo y addons (F4b): `user` ya viene en español para la UI.
    #[error("catálogo: {detail}")]
    Catalog { user: String, detail: String },
}

impl CoreError {
    /// Texto corto en lenguaje claro para la barra de estado / diálogos (NFR-12).
    pub fn user_message(&self) -> String {
        match self {
            Self::InvalidMagnet(_) => "Eso no parece un magnet válido.".into(),
            Self::ExecutableNotFound { name } => {
                format!(
                    "No encuentro {name}. En Ajustes → Reproductor podés instalarlo o elegir otro."
                )
            }
            Self::Engine(_) => "El motor de descarga tuvo un problema; reintentando.".into(),
            Self::Timeout { what, .. } => format!("Tardó demasiado: {what}."),
            Self::Player(_) => "El reproductor no pudo abrirse.".into(),
            Self::Subtitles { provider, .. } => {
                format!("No se pudieron traer subtítulos de {provider}.")
            }
            Self::Io { .. } | Self::Json { .. } => {
                "Problema leyendo o guardando un archivo.".into()
            }
            Self::Unsupported(what) => format!("{what} no está disponible en este sistema."),
            Self::Cancelled => "Cancelado.".into(),
            Self::NotFound(what) => format!("No encontrado: {what}."),
            Self::Clipboard(_) => "No se pudo leer el portapapeles.".into(),
            Self::Logger(_) => "No se pudieron iniciar los registros de diagnóstico.".into(),
            Self::Catalog { user, .. } => user.clone(),
        }
    }
}
