//! 2. Wyzie Subs (Q-04): agregador; exige IMDb id y una API key gratuita.

use std::path::{Path, PathBuf};

use async_trait::async_trait;
use serde_json::Value;

use super::cache::{cached, save};
use super::http::{get_bytes, http, HttpError};
use super::{err, http_err, release_match, SubtitleProvider, WYZIE};
use crate::audio::spanish_variant;
use crate::config::SubtitleLanguage;
use crate::subtitles::{MatchKind, Quota, SpanishVariant, SubtitleCandidate, VideoIdentity};
use crate::Result;

pub struct WyzieProvider {
    key: Option<String>,
}

impl WyzieProvider {
    /// Con la key del almacén seguro (o sin key → se omite).
    pub fn from_store() -> Self {
        Self {
            key: crate::subtitles::secrets::api_key(WYZIE),
        }
    }
}

/// Parser puro de `GET sub.wyzie.io/search` (lista de objetos).
pub(super) fn parse_wyzie(
    json: &Value,
    video: &VideoIdentity,
    lang: SubtitleLanguage,
) -> Vec<SubtitleCandidate> {
    let Some(want) = lang.iso1() else {
        return Vec::new();
    };
    json.as_array()
        .into_iter()
        .flatten()
        .filter(|s| s["ai"].as_bool() != Some(true))
        .filter(|s| {
            s["language"]
                .as_str()
                .is_some_and(|l| l.to_lowercase().starts_with(want))
        })
        .filter_map(|s| {
            let url = s["url"].as_str()?.to_string();
            let id = match &s["id"] {
                Value::String(x) => x.clone(),
                Value::Number(n) => n.to_string(),
                _ => return None,
            };
            let release = s["release"]
                .as_str()
                .or(s["fileName"].as_str())
                .or(s["media"].as_str())
                .unwrap_or_default()
                .to_string();
            let reasons: Vec<&str> = s["match"]["reasons"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .collect();
            let match_kind = if reasons.contains(&"hash") {
                MatchKind::Exact
            } else if reasons
                .iter()
                .any(|r| matches!(*r, "group" | "source" | "resolution"))
            {
                MatchKind::Release
            } else {
                release_match(video, &release)
            };
            let variant = if lang == SubtitleLanguage::Es {
                wyzie_variant(s)
            } else {
                SpanishVariant::Unknown
            };
            Some(SubtitleCandidate {
                provider: WYZIE,
                provider_id: id,
                release_name: release,
                language: lang,
                match_kind,
                downloads: s["downloadCount"]
                    .as_u64()
                    .unwrap_or(0)
                    .min(u32::MAX as u64) as u32,
                variant,
                url,
                fps: None,
                last_secs: None,
            })
        })
        .collect()
}

/// País de la bandera (`flagsapi.com/MX/flat/24.png`) → variante; si no, el texto.
fn wyzie_variant(s: &Value) -> SpanishVariant {
    const LATAM: &[&str] = &[
        "MX", "AR", "CO", "CL", "PE", "VE", "UY", "EC", "BO", "PY", "CR", "GT", "HN", "SV", "NI",
        "PA", "DO", "CU", "PR",
    ];
    let country = s["flagUrl"]
        .as_str()
        .and_then(|u| u.split('/').rev().nth(2))
        .unwrap_or_default()
        .to_ascii_uppercase();
    if country == "ES" {
        return SpanishVariant::Spain;
    }
    if LATAM.contains(&country.as_str()) {
        return SpanishVariant::Latino;
    }
    let text = format!(
        "{} {} {}",
        s["language"].as_str().unwrap_or_default(),
        s["display"].as_str().unwrap_or_default(),
        s["release"].as_str().unwrap_or_default()
    );
    spanish_variant(&text)
}

#[async_trait]
impl SubtitleProvider for WyzieProvider {
    fn id(&self) -> &'static str {
        WYZIE
    }
    async fn quota(&self) -> Result<Option<Quota>> {
        // Plan gratis: 1000 pedidos/día; no se consulta (sería un pedido más).
        Ok(None)
    }
    async fn search(
        &self,
        video: &VideoIdentity,
        lang: SubtitleLanguage,
    ) -> Result<Vec<SubtitleCandidate>> {
        let Some(key) = &self.key else {
            return Err(err(WYZIE, "sin API key configurada: se omite"));
        };
        let Some(imdb) = &video.imdb_id else {
            return Err(err(WYZIE, "no se pudo identificar la película (IMDb)"));
        };
        let Some(language) = lang.iso1() else {
            return Ok(Vec::new());
        };
        let mut query: Vec<(&str, String)> = vec![
            ("id", imdb.clone()),
            ("language", language.into()),
            ("format", "srt,ass".into()),
            ("video", video.file_name.clone()),
            ("key", key.clone()),
        ];
        if let Some(h) = video.movie_hash {
            query.push(("hash", format!("{h:016x}")));
        }
        if let (Some(s), Some(e)) = (video.season, video.episode) {
            query.push(("season", s.to_string()));
            query.push(("episode", e.to_string()));
        }
        let req = http().get("https://sub.wyzie.io/search").query(&query);
        let bytes = match get_bytes(req).await {
            // 404 = no hay nada para ese título: no es un error.
            Err(HttpError::Status { status: 404, .. }) => return Ok(Vec::new()),
            other => other.map_err(|e| http_err(WYZIE, e))?,
        };
        let json: Value = serde_json::from_slice(&bytes)
            .map_err(|e| err(WYZIE, format!("respuesta inválida: {e}")))?;
        Ok(parse_wyzie(&json, video, lang))
    }
    async fn download(&self, cand: &SubtitleCandidate, cache_dir: &Path) -> Result<PathBuf> {
        if let Some(p) = cached(cache_dir, cand) {
            return Ok(p);
        }
        let bytes = get_bytes(http().get(&cand.url))
            .await
            .map_err(|e| http_err(WYZIE, e))?;
        save(cache_dir, cand, &bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::subtitles::providers::tests::{fixture, video};

    #[test]
    fn wyzie_parser() {
        let c = parse_wyzie(
            &fixture("wyzie-search.json"),
            &video(),
            SubtitleLanguage::Es,
        );
        assert_eq!(c.len(), 3, "sin el inglés ni la fila de IA");
        assert_eq!(c[0].provider_id, "1955024019");
        assert_eq!(c[0].match_kind, MatchKind::Exact);
        assert_eq!(c[0].variant, SpanishVariant::Latino, "bandera MX");
        assert_eq!(c[0].downloads, 4821);
        assert!(c[0].url.starts_with("https://sub.wyzie.io/c/"));
        assert_eq!(c[1].variant, SpanishVariant::Spain, "bandera ES");
        assert_eq!(
            c[1].match_kind,
            MatchKind::Exact,
            "mismo nombre que el archivo"
        );
        assert_eq!(c[2].variant, SpanishVariant::Unknown);
        assert_eq!(c[2].match_kind, MatchKind::None);
    }
}
