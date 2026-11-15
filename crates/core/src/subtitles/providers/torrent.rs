//! 1. Subtítulos que vienen dentro del torrent (FR-22): se leen por el stream del motor.

use std::path::{Path, PathBuf};

use async_trait::async_trait;

use super::cache::{cached, save};
use super::http::{get_bytes, local_http};
use super::http_err;
use super::lang::lang_from_name;
use super::{SubtitleProvider, TORRENT_PROVIDER};
use crate::config::SubtitleLanguage;
use crate::subtitles::{MatchKind, Quota, SubtitleCandidate, VideoIdentity};
use crate::Result;

#[derive(Debug, Clone)]
pub struct TorrentSubtitleFile {
    /// Ruta relativa dentro del torrent.
    pub name: String,
    /// URL del motor (127.0.0.1): se lee por el stream, que pide solo esas piezas.
    pub url: String,
}

pub struct TorrentProvider {
    pub files: Vec<TorrentSubtitleFile>,
}

#[async_trait]
impl SubtitleProvider for TorrentProvider {
    fn id(&self) -> &'static str {
        TORRENT_PROVIDER
    }
    async fn quota(&self) -> Result<Option<Quota>> {
        Ok(None)
    }
    async fn search(
        &self,
        video: &VideoIdentity,
        lang: SubtitleLanguage,
    ) -> Result<Vec<SubtitleCandidate>> {
        // La caché es por video y la comparten sus torrents: "Subs/2_Spanish.srt" de dos
        // torrents distintos son archivos distintos.
        let torrent: String = video
            .info_hash
            .map(|h| h.to_hex())
            .unwrap_or_default()
            .chars()
            .take(12)
            .collect();
        Ok(self
            .files
            .iter()
            .filter_map(|f| {
                let (l, variant) = lang_from_name(&f.name)?;
                (l == lang).then(|| SubtitleCandidate {
                    provider: TORRENT_PROVIDER,
                    provider_id: format!("{torrent}/{}", f.name),
                    release_name: f.name.rsplit(['/', '\\']).next().unwrap_or(&f.name).into(),
                    language: l,
                    // Vienen con el mismo archivo de video: la mejor coincidencia posible.
                    match_kind: MatchKind::Hash,
                    downloads: 0,
                    variant,
                    url: f.url.clone(),
                })
            })
            .collect())
    }
    async fn download(&self, cand: &SubtitleCandidate, cache_dir: &Path) -> Result<PathBuf> {
        if let Some(p) = cached(cache_dir, cand) {
            return Ok(p);
        }
        let bytes = get_bytes(local_http().get(&cand.url))
            .await
            .map_err(|e| http_err(TORRENT_PROVIDER, e))?;
        save(cache_dir, cand, &bytes)
    }
}
