//! Addons de streams de Stremio (FR-41, FR-42, FR-45; spec 10 §A). Un addon = la URL de su
//! `manifest.json`; la configuración va en el path y es opaca (puede llevar claves → almacén
//! seguro, NFR-22). Un addon nuevo funciona sin código nuevo (NFR-25).

use std::sync::Mutex;
use std::time::Duration;

use super::http::{redact, FetchError, Http};
use super::normalize::{self, ParseCtx, Parsed, StreamCandidate};
use super::protocol::{Manifest, Stream, StreamsResponse};
use super::{MediaKind, VideoId};
use crate::config::AddonEntry;

/// NFR-24: como mucho esto por addon.
const MAX_STREAMS: usize = 1000;

/// Lo que importa del manifest (cacheado en memoria tras el primer pedido).
#[derive(Debug, Clone)]
pub struct ManifestInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub types: Vec<String>,
    pub id_prefixes: Option<Vec<String>>,
}

pub enum AddonOutcome {
    Ok(Vec<StreamCandidate>),
    NeedsConfig,
    Unsupported,
    Failed(String),
}

pub struct Addon {
    pub entry: AddonEntry,
    /// URL completa del manifest (puede ser secreta: nunca a logs ni a la UI).
    url: String,
    manifest: Mutex<Option<ManifestInfo>>,
}

impl Addon {
    pub fn new(entry: AddonEntry, url: String) -> Self {
        Self {
            entry,
            url,
            manifest: Mutex::new(None),
        }
    }

    pub fn timeout(&self, default: Duration) -> Duration {
        self.entry.timeout_ms.map_or(default, Duration::from_millis)
    }

    fn base(&self) -> &str {
        self.url.trim_end_matches("/manifest.json")
    }

    async fn manifest(&self, http: &Http, timeout: Duration) -> Result<ManifestInfo, String> {
        if let Some(m) = self.manifest.lock().expect("manifest").clone() {
            return Ok(m);
        }
        let m = fetch_manifest(http, &self.url, timeout).await?;
        *self.manifest.lock().expect("manifest") = Some(m.clone());
        Ok(m)
    }

    /// `stream/{type}/{id}.json` y normalización. `timeout` = plazo total del addon, manifest
    /// incluido (NFR-19).
    pub async fn streams(
        &self,
        http: &Http,
        video: &VideoId,
        kind: MediaKind,
        rank: usize,
        timeout: Duration,
    ) -> AddonOutcome {
        let deadline = tokio::time::Instant::now() + timeout;
        let left = || deadline.saturating_duration_since(tokio::time::Instant::now());
        let manifest = match self.manifest(http, left()).await {
            Ok(m) => m,
            Err(e) => return AddonOutcome::Failed(e),
        };
        let id = video.to_string();
        // FR-42: respetar `types` e `idPrefixes` del manifest (nunca se pide `kitsu:`…).
        let supported = manifest.types.iter().any(|t| t == kind.as_str())
            && manifest
                .id_prefixes
                .as_ref()
                .map_or(true, |p| p.iter().any(|p| id.starts_with(p.as_str())));
        if !supported {
            return AddonOutcome::Unsupported;
        }
        let url = format!("{}/stream/{}/{id}.json", self.base(), kind.as_str());
        let resp: StreamsResponse = match http.get_json(&url, left()).await {
            Ok(r) => r,
            Err(e) => {
                tracing::debug!(url = %redact(&url), "addon: {e:?}");
                return AddonOutcome::Failed(e.user_text());
            }
        };
        let generic_es = [&manifest.id, &manifest.name, &self.entry.name]
            .iter()
            .any(|s| {
                let s = s.to_lowercase();
                s.contains("torrentio") || s.contains("torrentsdb")
            });
        let ctx = ParseCtx {
            addon_name: &self.entry.name,
            addon_rank: rank,
            spain_flag_is_generic: generic_es,
            is_series: kind == MediaKind::Series,
        };
        let mut out = Vec::new();
        let mut needs_config = false;
        for raw in resp
            .streams
            .unwrap_or_default()
            .into_iter()
            .take(MAX_STREAMS)
        {
            let Ok(s) = serde_json::from_value::<Stream>(raw) else {
                continue;
            };
            match normalize::parse(&s, &ctx) {
                Parsed::Candidate(c) => out.push(*c),
                Parsed::NeedsConfig => needs_config = true,
                Parsed::Skip => {}
            }
        }
        if out.is_empty() && needs_config {
            AddonOutcome::NeedsConfig
        } else {
            AddonOutcome::Ok(out)
        }
    }
}

/// Valida un manifest (FR-41). Errores en español, listos para la UI.
pub async fn fetch_manifest(
    http: &Http,
    url: &str,
    timeout: Duration,
) -> Result<ManifestInfo, String> {
    let m: Manifest = http.get_json(url, timeout).await.map_err(|e| match e {
        FetchError::NotJson | FetchError::Status(404) => "No es un addon de Stremio.".to_string(),
        e => format!("No se pudo leer el addon: {}.", e.user_text()),
    })?;
    let Some((types, id_prefixes)) = m.stream_resource() else {
        return Err("Este addon no ofrece streams.".into());
    };
    if m.behavior_hints.as_ref().is_some_and(|h| h.adult) {
        // Q-22 (2026-11-14): bloqueados siempre.
        return Err("Addon para adultos: no se permite.".into());
    }
    if !types.iter().any(|t| t == "movie" || t == "series") {
        return Err("Este addon no tiene películas ni series.".into());
    }
    // FR-40: solo anime (sin IDs de IMDb) no sirve.
    if id_prefixes
        .as_ref()
        .is_some_and(|p| !p.iter().any(|p| p.starts_with("tt")))
    {
        return Err("Addon solo de anime: no se usa (sin anime ni contenido japonés).".into());
    }
    Ok(ManifestInfo {
        id: normalize::clean(m.id.as_deref().unwrap_or("addon")),
        name: normalize::clean(m.name.as_deref().unwrap_or("Addon")),
        version: normalize::clean(m.version.as_deref().unwrap_or("")),
        types,
        id_prefixes,
    })
}

/// URL que pegó el usuario → URL de manifest: `stremio://` → `https://`, sin espacios, debe
/// terminar en `/manifest.json`, HTTPS (HTTP solo en `localhost`/LAN, NFR-22).
pub fn normalize_url(input: &str) -> Result<String, String> {
    let mut url = input.trim().to_string();
    if let Some(rest) = url.strip_prefix("stremio://") {
        url = format!("https://{rest}");
    }
    let mut parsed = reqwest::Url::parse(&url).map_err(|_| "Esa URL no es válida.".to_string())?;
    // El sufijo va en el path, no después de un `?key=…`.
    if !parsed.path().ends_with("/manifest.json") {
        let path = format!("{}/manifest.json", parsed.path().trim_end_matches('/'));
        parsed.set_path(&path);
    }
    let url = parsed.to_string();
    let host = parsed.host_str().unwrap_or("");
    let local = host == "localhost"
        || host.starts_with("127.")
        || host.starts_with("192.168.")
        || host.starts_with("10.");
    match parsed.scheme() {
        "https" => Ok(url),
        "http" if local => Ok(url),
        _ => Err("Solo se aceptan addons por HTTPS (o HTTP en tu red local).".into()),
    }
}

/// ¿La URL lleva configuración propia en el path? Entonces se trata como secreta (NFR-22).
pub fn has_config(url: &str) -> bool {
    redact(url).contains("****")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_de_addon() {
        assert_eq!(
            normalize_url("stremio://torrentio.strem.fun/manifest.json").unwrap(),
            "https://torrentio.strem.fun/manifest.json"
        );
        assert_eq!(
            normalize_url(" https://addon.peerflix.mov/ ").unwrap(),
            "https://addon.peerflix.mov/manifest.json"
        );
        assert_eq!(
            normalize_url("https://a.example/cfg?key=x").unwrap(),
            "https://a.example/cfg/manifest.json?key=x"
        );
        assert!(normalize_url("http://example.com/manifest.json").is_err());
        assert!(normalize_url("http://127.0.0.1:7000/manifest.json").is_ok());
        assert!(has_config(
            "https://torrentio.strem.fun/realdebrid=X/manifest.json"
        ));
        assert!(!has_config("https://addon.peerflix.mov/manifest.json"));
    }
}
