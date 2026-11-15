//! Gestdown (2026-11-15): proxy JSON de Addic7ed, sin key. Solo series. El español casi siempre
//! viene vacío; el inglés anda.
//!
//! `GET /shows/search/{serie}` → `shows[]` · `GET /subtitles/get/{show}/{T}/{E}/{spa|eng}` →
//! `matchingSubtitles[]` · `GET {downloadUri}` → SRT (UTF-8 con BOM).

use std::path::{Path, PathBuf};

use async_trait::async_trait;
use serde_json::Value;

use super::cache::{cached, save};
use super::http::{get_bytes, http, pct, HttpError};
use super::{err, http_err, normalized_title, release_match, SubtitleProvider, GESTDOWN};
use crate::audio::spanish_variant;
use crate::config::SubtitleLanguage;
use crate::subtitles::{Quota, SpanishVariant, SubtitleCandidate, VideoIdentity};
use crate::Result;

pub struct GestdownProvider;

const GESTDOWN_BASE: &str = "https://api.gestdown.info";

/// Id de la serie cuyo nombre es el título buscado (el buscador devuelve también parecidas:
/// "Breaking Bad Minisodes").
pub(super) fn parse_gestdown_show(json: &Value, title: &str) -> Option<String> {
    let wanted = normalized_title(title);
    json["shows"]
        .as_array()?
        .iter()
        .find(|s| s["name"].as_str().map(normalized_title).as_deref() == Some(&wanted))
        .and_then(|s| s["id"].as_str().map(String::from))
}

/// Parser puro de `/subtitles/get/…` (`matchingSubtitles`).
pub(super) fn parse_gestdown(
    json: &Value,
    video: &VideoIdentity,
    lang: SubtitleLanguage,
) -> Vec<SubtitleCandidate> {
    json["matchingSubtitles"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|s| s["completed"].as_bool() != Some(false))
        .filter_map(|s| {
            let id = s["subtitleId"].as_str()?.to_string();
            let uri = s["downloadUri"].as_str()?;
            // Ruta del mismo servidor: nunca otra URL.
            if !uri.starts_with('/') || uri.starts_with("//") {
                return None;
            }
            let version = s["version"].as_str().unwrap_or_default();
            let variant = if lang == SubtitleLanguage::Es {
                spanish_variant(s["language"].as_str().unwrap_or_default())
            } else {
                SpanishVariant::Unknown
            };
            Some(SubtitleCandidate {
                provider: GESTDOWN,
                provider_id: id,
                release_name: version.to_string(),
                language: lang,
                match_kind: release_match(video, version),
                downloads: s["downloadCount"]
                    .as_u64()
                    .unwrap_or(0)
                    .min(u32::MAX as u64) as u32,
                variant,
                url: format!("{GESTDOWN_BASE}{uri}"),
            })
        })
        .collect()
}

/// GET JSON; `404` = no hay (serie o episodio): `None`, no es un error.
async fn get_json(url: String) -> Result<Option<Value>> {
    let req = http()
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json");
    let bytes = match get_bytes(req).await {
        Err(HttpError::Status { status: 404, .. }) => return Ok(None),
        other => other.map_err(|e| http_err(GESTDOWN, e))?,
    };
    // 304 sin cuerpo (lo avisa subliminal): nada.
    if bytes.is_empty() {
        return Ok(None);
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|e| err(GESTDOWN, format!("respuesta inválida: {e}")))
}

#[async_trait]
impl SubtitleProvider for GestdownProvider {
    fn id(&self) -> &'static str {
        GESTDOWN
    }
    async fn quota(&self) -> Result<Option<Quota>> {
        Ok(None)
    }
    async fn search(
        &self,
        video: &VideoIdentity,
        lang: SubtitleLanguage,
    ) -> Result<Vec<SubtitleCandidate>> {
        let (Some(title), Some(season), Some(episode), Some(code)) =
            (&video.title, video.season, video.episode, lang.iso2())
        else {
            return Ok(Vec::new()); // solo series
        };
        let Some(shows) = get_json(format!("{GESTDOWN_BASE}/shows/search/{}", pct(title))).await?
        else {
            return Ok(Vec::new());
        };
        let Some(show) = parse_gestdown_show(&shows, title) else {
            return Ok(Vec::new());
        };
        let url = format!(
            "{GESTDOWN_BASE}/subtitles/get/{}/{season}/{episode}/{code}",
            pct(&show)
        );
        Ok(get_json(url)
            .await?
            .map(|json| parse_gestdown(&json, video, lang))
            .unwrap_or_default())
    }
    async fn download(&self, cand: &SubtitleCandidate, cache_dir: &Path) -> Result<PathBuf> {
        if let Some(p) = cached(cache_dir, cand) {
            return Ok(p);
        }
        let bytes = get_bytes(http().get(&cand.url))
            .await
            .map_err(|e| http_err(GESTDOWN, e))?;
        save(cache_dir, cand, &bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::subtitles::MatchKind;

    // Recortado de respuestas reales (búsqueda "Breaking Bad"; Game of Thrones 3x02 en inglés),
    // 2026-11-15.
    const SHOWS: &str = r#"{"shows":[{"id":"1WLU6zJky4nlJQa5oojv5R","name":"Breaking Bad","nbSeasons":5},
        {"id":"0QAbtB5xsbRLq53fZWUtWf","name":"Breaking Bad Minisodes","nbSeasons":1}]}"#;
    const SUBS: &str = r#"{"matchingSubtitles":[
        {"subtitleId":"4sstBUK7iRiapgqIL7RNGY","version":"720p-IMMERSE","completed":true,
         "hearingImpaired":false,"downloadUri":"/subtitles/download/4sstBUK7iRiapgqIL7RNGY",
         "language":"English","downloadCount":407},
        {"subtitleId":"1Q3yOdM5HR25UeGvKGFwKi","version":"2HD","completed":true,
         "hearingImpaired":false,"downloadUri":"/subtitles/download/1Q3yOdM5HR25UeGvKGFwKi",
         "language":"English","downloadCount":63},
        {"subtitleId":"x","version":"OTRO","completed":true,
         "downloadUri":"https://otro.host/x","language":"English"}],
        "episode":{"season":3,"number":2,"show":"Game of Thrones"}}"#;

    #[test]
    fn gestdown_serie_por_nombre_exacto() {
        let json: Value = serde_json::from_str(SHOWS).unwrap();
        assert_eq!(
            parse_gestdown_show(&json, "Breaking Bad").as_deref(),
            Some("1WLU6zJky4nlJQa5oojv5R")
        );
        assert_eq!(parse_gestdown_show(&json, "Better Call Saul"), None);
    }

    #[test]
    fn gestdown_parser() {
        let video = VideoIdentity {
            file_name: "Game.of.Thrones.S03E02.720p.HDTV.x264-IMMERSE.mkv".into(),
            title: Some("Game of Thrones".into()),
            season: Some(3),
            episode: Some(2),
            release_group: Some("IMMERSE".into()),
            ..Default::default()
        };
        let json: Value = serde_json::from_str(SUBS).unwrap();
        let c = parse_gestdown(&json, &video, SubtitleLanguage::En);
        assert_eq!(c.len(), 2, "sin la URL de otro servidor");
        assert_eq!(c[0].match_kind, MatchKind::Release, "por el grupo IMMERSE");
        assert_eq!(c[0].downloads, 407);
        assert_eq!(
            c[0].url,
            "https://api.gestdown.info/subtitles/download/4sstBUK7iRiapgqIL7RNGY"
        );
        assert_eq!(c[1].match_kind, MatchKind::None);
        assert_eq!(c[1].language, SubtitleLanguage::En);
    }
}
