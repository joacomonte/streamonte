//! Proveedores de subtítulos (FR-22, FR-24, Q-01..Q-04). Orden de preferencia del usuario:
//! 1. **torrent**: los `.srt/.ass` que vienen dentro del torrent (se leen por el stream del motor).
//! 2. **Wyzie Subs**: agregador; desde 2026 exige una API key gratuita (sub.wyzie.io/redeem).
//! 3. **Subdivx**: experimental, sin API oficial (se lee la web). Si falla o hay un bloqueo de
//!    Cloudflare, se omite sin romper nada (no se evaden bloqueos, R-09).
//! 4. **Gestdown** (proxy de Addic7ed) y **Subtitulamos** (web española): solo series, sin key
//!    (2026-11-15). Gestdown casi siempre trae inglés; Subtitulamos, español e inglés.
//! 5. **OpenSubtitles**: API REST v1 con la key gratuita del usuario; cuota de 20 descargas/día,
//!    por eso va último y solo si faltan para llegar a 5.
//!
//! Acá: la interfaz [`SubtitleProvider`], ids, nombres en pantalla, errores de proveedor y la
//! coincidencia por release. Cada proveedor vive en su archivo; los parsers de respuestas son
//! funciones puras (`parse_*`) probadas con fixtures guardados.

use std::path::{Path, PathBuf};

use async_trait::async_trait;
use serde_json::Value;

use super::{MatchKind, Quota, SubtitleCandidate, VideoIdentity};
use crate::config::SubtitleLanguage;
use crate::{CoreError, Result};
use http::HttpError;

mod archive;
pub(super) mod cache;
mod gestdown;
pub(super) mod http;
mod imdb;
mod lang;
mod opensubtitles;
mod opensubtitles_org;
mod subdivx;
mod subtitulamos;
mod torrent;
mod wyzie;

pub use cache::{cached, cached_by_key};
pub use gestdown::GestdownProvider;
pub use imdb::resolve_imdb;
pub use opensubtitles::OpenSubtitlesProvider;
pub use opensubtitles_org::OpenSubtitlesOrgProvider;
pub use subdivx::SubdivxProvider;
pub use subtitulamos::SubtitulamosProvider;
pub use torrent::{TorrentProvider, TorrentSubtitleFile};
pub use wyzie::WyzieProvider;

#[async_trait]
pub trait SubtitleProvider: Send + Sync {
    fn id(&self) -> &'static str;
    /// `None` = sin límite conocido. Se respeta antes de descargar (ADR-12, Q-01).
    async fn quota(&self) -> Result<Option<Quota>>;
    async fn search(
        &self,
        video: &VideoIdentity,
        lang: SubtitleLanguage,
    ) -> Result<Vec<SubtitleCandidate>>;
    /// Descarga a la caché de subtítulos y devuelve la ruta (SRT/ASS, UTF-8).
    async fn download(&self, candidate: &SubtitleCandidate, cache_dir: &Path) -> Result<PathBuf>;
}

/// Id del proveedor "subtítulos que vienen dentro del torrent" (FR-22).
pub const TORRENT_PROVIDER: &str = "torrent";
pub const WYZIE: &str = "wyzie";
pub const SUBDIVX: &str = "subdivx";
pub const OPENSUBTITLES: &str = "opensubtitles";
pub const GESTDOWN: &str = "gestdown";
pub const SUBTITULAMOS: &str = "subtitulamos";
/// OpenSubtitles.org con sesión anónima (sin key), como la app Subs (2026-11-15).
pub const OPENSUBTITLES_ORG: &str = "opensubtitles-org";

/// Todos los ids, para reconocer el proveedor de una clave `proveedor:id` guardada (FR-28).
pub(super) const ALL: [&str; 7] = [
    TORRENT_PROVIDER,
    WYZIE,
    SUBDIVX,
    OPENSUBTITLES,
    GESTDOWN,
    SUBTITULAMOS,
    OPENSUBTITLES_ORG,
];

/// Nombre corto para la etiqueta en pantalla ("2 · Wyzie/…").
pub fn display_name(provider: &str) -> &'static str {
    match provider {
        TORRENT_PROVIDER => "torrent",
        WYZIE => "Wyzie",
        SUBDIVX => "Subdivx",
        OPENSUBTITLES => "OpenSubs",
        GESTDOWN => "Gestdown",
        SUBTITULAMOS => "Subtitulamos",
        OPENSUBTITLES_ORG => "OpenSubs.org",
        _ => "?",
    }
}

// ---------- errores de proveedor ----------

/// `provider` es siempre uno de los ids de arriba (o "motor" para el servidor local).
fn err(provider: &'static str, message: impl Into<String>) -> CoreError {
    CoreError::Subtitles {
        provider: error_label(provider),
        message: message.into(),
    }
}

/// Nombre que ve el usuario en los errores ("No se pudieron traer subtítulos de …").
fn error_label(provider: &'static str) -> &'static str {
    match provider {
        WYZIE => "Wyzie",
        SUBDIVX => "Subdivx",
        OPENSUBTITLES => "OpenSubtitles",
        GESTDOWN => "Gestdown",
        SUBTITULAMOS => "Subtitulamos",
        OPENSUBTITLES_ORG => "OpenSubtitles.org",
        other => other,
    }
}

/// Error HTTP → error del proveedor con un mensaje claro. Los estados con significado propio
/// de un proveedor (404 de Wyzie, 406 de OpenSubtitles) los resuelve ese proveedor antes.
fn http_err(provider: &'static str, e: HttpError) -> CoreError {
    let message = match e {
        // Sin la URL: la de Wyzie lleva la API key en la query y esto va al log (NFR-16/NFR-22).
        HttpError::Network(e) => e.to_string(),
        HttpError::TooLarge { max } => format!("la respuesta pasa de {max} bytes: se descarta"),
        HttpError::Status { status, body } => status_message(status, &body),
    };
    err(provider, message)
}

fn status_message(status: u16, body: &[u8]) -> String {
    if looks_like_cloudflare(status, &String::from_utf8_lossy(body)) {
        return "bloqueado por Cloudflare: se omite (no se evaden bloqueos, R-09)".into();
    }
    let detail = body_detail(body);
    match status {
        401 | 403 => format!("API key rechazada o sin permiso ({status}) {detail}"),
        429 => format!("límite de pedidos alcanzado (429) {detail}"),
        _ => format!("HTTP {status} {detail}"),
    }
}

/// El `message` (o `error`) de un cuerpo de error JSON; vacío si no hay.
fn body_detail(body: &[u8]) -> String {
    serde_json::from_str::<Value>(&String::from_utf8_lossy(body))
        .ok()
        .and_then(|v| {
            v.get("message")
                .or_else(|| v.get("error"))
                .and_then(Value::as_str)
                .map(String::from)
        })
        .unwrap_or_default()
}

fn looks_like_cloudflare(status: u16, body: &str) -> bool {
    matches!(status, 403 | 503) && (body.contains("Just a moment") || body.contains("cf_chl"))
}

// ---------- coincidencia ----------

fn words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(String::from)
        .collect()
}

/// Coincidencia por nombre de release (FR-24): mismo grupo, o el mismo nombre de archivo.
fn release_match(video: &VideoIdentity, release: &str) -> MatchKind {
    let r = release.to_lowercase();
    let stem = video
        .file_name
        .rsplit_once('.')
        .map_or(video.file_name.as_str(), |(s, _)| s)
        .to_lowercase();
    let group = video
        .release_group
        .as_deref()
        .map(str::to_lowercase)
        .filter(|g| g.len() >= 2);
    if (!stem.is_empty() && r.contains(&stem)) || group.is_some_and(|g| words(&r).contains(&g)) {
        MatchKind::Release
    } else {
        MatchKind::None
    }
}

pub(super) fn normalized_title(s: &str) -> String {
    words(s).join(" ")
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    pub(super) fn fixture(name: &str) -> Value {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/subtitles")
            .join(name);
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
    }

    pub(super) fn video() -> VideoIdentity {
        VideoIdentity {
            file_name: "Sintel.2010.720p.BluRay.x264-SURFER.mkv".into(),
            title: Some("Sintel".into()),
            year: Some(2010),
            release_group: Some("SURFER".into()),
            ..Default::default()
        }
    }

    #[test]
    fn cloudflare_se_detecta() {
        let m = status_message(403, b"<title>Just a moment...</title>");
        assert!(m.contains("Cloudflare"));
    }
}
