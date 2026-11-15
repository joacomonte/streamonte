//! 3. Subdivx (Q-02, experimental): sin API oficial, se lee la web. Solo español.

use std::path::{Path, PathBuf};

use async_trait::async_trait;
use serde_json::Value;

use super::archive::extract_if_archive;
use super::cache::{cached, sanitize, save, to_utf8};
use super::http::{get_bytes, http, pct, read_capped, send, HttpError, MAX_BODY_BYTES};
use super::{
    err, http_err, normalized_title, release_match, words, SubtitleProvider, SUBDIVX,
};
use crate::config::SubtitleLanguage;
use crate::audio::spanish_variant;
use crate::subtitles::{Quota, SubtitleCandidate, VideoIdentity};
use crate::Result;

pub struct SubdivxProvider;

const SUBDIVX_BASE: &str = "https://www.subdivx.com";

/// Parser puro del JSON de `inc/ajax.php` (`aaData`: id, titulo, descripcion, descargas).
pub(super) fn parse_subdivx(json: &Value, video: &VideoIdentity) -> Vec<SubtitleCandidate> {
    let wanted = video
        .title
        .as_deref()
        .map(normalized_title)
        .unwrap_or_default();
    json["aaData"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|s| {
            let id = match &s["id"] {
                Value::Number(n) => n.to_string(),
                Value::String(x) if !x.is_empty() => x.clone(),
                _ => return None,
            };
            let titulo = s["titulo"].as_str().unwrap_or_default();
            // El buscador devuelve también otras películas con palabras parecidas.
            if !wanted.is_empty() && !normalized_title(titulo).contains(&wanted) {
                return None;
            }
            if let (Some(y), Some(found)) = (video.year, year_in(titulo)) {
                if y.abs_diff(found) > 1 {
                    return None;
                }
            }
            let descripcion = s["descripcion"].as_str().unwrap_or_default();
            let downloads = match &s["descargas"] {
                Value::Number(n) => n.as_u64().unwrap_or(0),
                Value::String(x) => x.replace(['.', ','], "").parse().unwrap_or(0),
                _ => 0,
            };
            let short: String = descripcion.chars().take(80).collect();
            Some(SubtitleCandidate {
                provider: SUBDIVX,
                provider_id: id,
                release_name: format!("{titulo} — {short}"),
                language: SubtitleLanguage::Es,
                match_kind: release_match(video, descripcion),
                downloads: downloads.min(u32::MAX as u64) as u32,
                variant: spanish_variant(descripcion),
                url: String::new(),
            })
        })
        .collect()
}

fn year_in(text: &str) -> Option<u16> {
    words(text)
        .iter()
        .filter(|w| w.len() == 4)
        .filter_map(|w| w.parse::<u16>().ok())
        .find(|y| (1900..=2099).contains(y))
}

/// Cookies de una respuesta (`Set-Cookie`) → cabecera `Cookie` (sin sumar la feature de cookies).
fn cookies_of(resp: &reqwest::Response) -> String {
    resp.headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .filter_map(|v| v.split(';').next())
        .collect::<Vec<_>>()
        .join("; ")
}

impl SubdivxProvider {
    async fn fetch(&self, req: reqwest::RequestBuilder) -> Result<(String, String)> {
        let resp = send(req).await.map_err(|e| http_err(SUBDIVX, e))?;
        let status = resp.status().as_u16();
        let cookies = cookies_of(&resp);
        let body = to_utf8(
            &read_capped(resp, MAX_BODY_BYTES)
                .await
                .map_err(|e| http_err(SUBDIVX, e))?,
        );
        if !(200..300).contains(&status) {
            let body = body.into_bytes();
            return Err(http_err(SUBDIVX, HttpError::Status { status, body }));
        }
        Ok((body, cookies))
    }
}

#[async_trait]
impl SubtitleProvider for SubdivxProvider {
    fn id(&self) -> &'static str {
        SUBDIVX
    }
    async fn quota(&self) -> Result<Option<Quota>> {
        Ok(None)
    }
    async fn search(
        &self,
        video: &VideoIdentity,
        lang: SubtitleLanguage,
    ) -> Result<Vec<SubtitleCandidate>> {
        if lang != SubtitleLanguage::Es {
            return Ok(Vec::new()); // Subdivx es solo español.
        }
        let Some(title) = &video.title else {
            return Ok(Vec::new());
        };
        let query = match (video.season, video.episode, video.year) {
            (Some(s), Some(e), _) => format!("{title} S{s:02}E{e:02}"),
            (_, _, Some(y)) => format!("{title} {y}"),
            _ => title.clone(),
        };
        // 1. Portada: cookie de sesión y nombre del campo de búsqueda (cambia: "buscar393"…).
        let (home, mut cookies) = self.fetch(http().get(format!("{SUBDIVX_BASE}/"))).await?;
        let field = home
            .find("name=\"buscar")
            .map(|i| {
                let rest = &home[i + 6..];
                rest.chars()
                    .take_while(|c| c.is_ascii_alphanumeric())
                    .collect::<String>()
            })
            .filter(|f| f.starts_with("buscar"))
            .unwrap_or_else(|| "buscar".into());
        // 2. Token anti-CSRF.
        let (token_body, more) = self
            .fetch(
                http()
                    .get(format!("{SUBDIVX_BASE}/inc/gt.php?gt=1"))
                    .header(reqwest::header::COOKIE, &cookies),
            )
            .await?;
        if !more.is_empty() {
            cookies = format!("{cookies}; {more}");
        }
        let token = serde_json::from_str::<Value>(&token_body)
            .ok()
            .and_then(|v| v["token"].as_str().map(String::from))
            .unwrap_or_default();
        // 3. Búsqueda.
        let form = [
            ("tabla", "resultados".to_string()),
            ("filtros", String::new()),
            (field.as_str(), query),
            ("token", token),
        ];
        let (body, _) = self
            .fetch(
                http()
                    .post(format!("{SUBDIVX_BASE}/inc/ajax.php"))
                    .header(reqwest::header::COOKIE, &cookies)
                    .header("X-Requested-With", "XMLHttpRequest")
                    .form(&form),
            )
            .await?;
        let json: Value = serde_json::from_str(&body).map_err(|e| {
            err(
                SUBDIVX,
                format!("la web cambió (respuesta no es JSON): {e}"),
            )
        })?;
        Ok(parse_subdivx(&json, video))
    }
    async fn download(&self, cand: &SubtitleCandidate, cache_dir: &Path) -> Result<PathBuf> {
        if let Some(p) = cached(cache_dir, cand) {
            return Ok(p);
        }
        let url = format!("{SUBDIVX_BASE}/descargar.php?id={}", pct(&cand.provider_id));
        let bytes = get_bytes(http().get(url))
            .await
            .map_err(|e| http_err(SUBDIVX, e))?;
        let work = cache_dir.join(format!(".tmp-{}", sanitize(&cand.key())));
        let bytes = extract_if_archive(SUBDIVX, bytes, &work).await?;
        save(cache_dir, cand, &bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::subtitles::providers::tests::{fixture, video};
    use crate::subtitles::{MatchKind, SpanishVariant};

    #[test]
    fn subdivx_parser() {
        let c = parse_subdivx(&fixture("subdivx-search.json"), &video());
        assert_eq!(c.len(), 3, "sin la otra película ni el año que no coincide");
        assert_eq!(c[0].provider_id, "725040");
        assert_eq!(c[0].variant, SpanishVariant::Latino);
        assert_eq!(c[0].match_kind, MatchKind::Release);
        assert_eq!(c[0].downloads, 12_345);
        assert_eq!(c[1].variant, SpanishVariant::Spain);
        assert_eq!(c[2].variant, SpanishVariant::Unknown);
        assert_eq!(
            c[2].downloads, 1_502,
            "descargas como texto con punto de miles"
        );
    }
}
