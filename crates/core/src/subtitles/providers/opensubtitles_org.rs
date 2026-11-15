//! OpenSubtitles.org (2026-11-15): la API vieja XML-RPC, con sesión ANÓNIMA (sin key ni cuenta),
//! como la app Subs del usuario (subliminal). Es la que más español tiene; el `.com` necesita key.
//!
//! `LogIn("", "", "eng", UA)` → token · `SearchSubtitles(token, [{imdbid, season, episode,
//! sublanguageid}])` → `data[]` · `DownloadSubtitles(token, [id])` → base64 de un gzip.
//! `spl` = español latinoamericano; `spa` = español (de España o sin decir).

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use async_trait::async_trait;
use base64::Engine;

use super::cache::{cached, save};
use super::http::{http, read_capped, send, HttpError};
use super::{err, http_err, release_match, SubtitleProvider, OPENSUBTITLES_ORG};
use crate::config::SubtitleLanguage;
use crate::subtitles::{Quota, SpanishVariant, SubtitleCandidate, VideoIdentity};
use crate::Result;

const ENDPOINT: &str = "https://api.opensubtitles.org/xml-rpc";
/// El único user agent que acepta para sesiones anónimas (el de VLSub, como subliminal).
const USER_AGENT: &str = "VLSub 0.11.1";
/// Tope del subtítulo descomprimido (un SRT normal pesa < 200 KB).
const MAX_SUBTITLE_BYTES: u64 = 5 * 1024 * 1024;

/// Una vez que el servidor dice "407 límite de descargas", no se le pide más en esta ejecución.
static LIMIT_REACHED: AtomicBool = AtomicBool::new(false);

#[derive(Default)]
pub struct OpenSubtitlesOrgProvider {
    /// Una sesión anónima por búsqueda (español e inglés la comparten).
    token: tokio::sync::OnceCell<Option<String>>,
}

// ---------- XML-RPC mínimo ----------

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn call_xml(method: &str, params: &[String]) -> String {
    let params: String = params
        .iter()
        .map(|p| format!("<param><value>{p}</value></param>"))
        .collect();
    format!(
        "<?xml version=\"1.0\"?><methodCall><methodName>{method}</methodName><params>{params}</params></methodCall>"
    )
}

fn string(s: &str) -> String {
    format!("<string>{}</string>", escape(s))
}

fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let Some(end) = rest.find(';').filter(|&e| e <= 10) else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let entity = &rest[1..end];
        let ch = match entity {
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "amp" => Some('&'),
            _ => entity
                .strip_prefix("#x")
                .and_then(|h| u32::from_str_radix(h, 16).ok())
                .or_else(|| entity.strip_prefix('#').and_then(|d| d.parse().ok()))
                .and_then(char::from_u32),
        };
        match ch {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Algunos subtítulos están cargados con el IMDb equivocado: si el nombre del release dice otra
/// temporada/episodio que el pedido, no es este video.
fn other_episode(release: &str, video: &VideoIdentity) -> bool {
    let (Some(s), Some(e)) = (video.season, video.episode) else {
        return false;
    };
    crate::release::season_episodes(release).any(|(rs, re)| rs != s || re.is_some_and(|re| re != e))
}

/// Valor escalar de un `<value>`: el texto de `<string>`/`<int>`/`<double>`… o el texto suelto.
fn scalar(value: &str) -> String {
    let inner = value.trim();
    let text = match inner.strip_prefix('<') {
        Some(rest) => {
            let tag_end = rest.find('>').unwrap_or(0);
            let tag = &rest[..tag_end];
            if tag.ends_with('/') {
                ""
            } else {
                let body = &rest[tag_end + 1..];
                body.find(&format!("</{tag}>"))
                    .map_or(body, |end| &body[..end])
            }
        }
        None => inner,
    };
    unescape(text.trim())
}

/// Los `<member>` de un `<struct>` plano (nombre → valor escalar).
fn members(xml: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for chunk in xml.split("<member>").skip(1) {
        let name = between(chunk, "<name>", "</name>").unwrap_or_default();
        let value = between(chunk, "<value>", "</value>").unwrap_or_default();
        out.insert(name.trim().to_string(), scalar(value));
    }
    out
}

fn between<'a>(s: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let from = s.find(start)? + start.len();
    let to = s[from..].find(end)? + from;
    Some(&s[from..to])
}

/// `status` de la respuesta ("200 OK", "407 Download limit reached"…).
fn status(xml: &str) -> String {
    xml.split("<member>")
        .find(|m| between(m, "<name>", "</name>").map(str::trim) == Some("status"))
        .and_then(|m| between(m, "<value>", "</value>"))
        .map(scalar)
        .unwrap_or_default()
}

/// Cada resultado de `SearchSubtitles`: los `<struct>` dentro de `data`.
fn results(xml: &str) -> Vec<HashMap<String, String>> {
    let Some(data) = xml.find("<name>data</name>").map(|i| &xml[i..]) else {
        return Vec::new();
    };
    data.split("<struct>").skip(1).map(members).collect()
}

/// Parser puro de `SearchSubtitles` → candidatos del idioma pedido.
pub(super) fn parse_search(
    xml: &str,
    video: &VideoIdentity,
    lang: SubtitleLanguage,
) -> Vec<SubtitleCandidate> {
    results(xml)
        .into_iter()
        .filter(|r| {
            matches!(
                r.get("SubFormat").map(String::as_str),
                Some("srt" | "ass" | "ssa" | "vtt")
            )
        })
        .filter_map(|r| {
            let id = r.get("IDSubtitleFile")?.trim().to_string();
            let code = r
                .get("SubLanguageID")
                .map(String::as_str)
                .unwrap_or_default();
            let (language, variant) = match code {
                "spl" => (SubtitleLanguage::Es, SpanishVariant::Latino),
                "spa" | "spn" => (SubtitleLanguage::Es, SpanishVariant::Unknown),
                "eng" => (SubtitleLanguage::En, SpanishVariant::Unknown),
                _ => return None,
            };
            if language != lang || id.is_empty() {
                return None;
            }
            let release = r
                .get("MovieReleaseName")
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .or_else(|| r.get("SubFileName").cloned())
                .unwrap_or_default();
            if other_episode(&release, video) {
                return None;
            }
            Some(SubtitleCandidate {
                provider: OPENSUBTITLES_ORG,
                provider_id: id,
                match_kind: release_match(video, &release),
                release_name: release,
                language,
                downloads: r
                    .get("SubDownloadsCnt")
                    .and_then(|d| d.parse().ok())
                    .unwrap_or(0),
                variant,
                url: String::new(),
            })
        })
        .collect()
}

/// Contenido de `DownloadSubtitles`: base64 → gzip → bytes del subtítulo.
pub(super) fn decode_download(xml: &str) -> Option<Vec<u8>> {
    let data = results(xml).into_iter().next()?.remove("data")?;
    let gz = base64::engine::general_purpose::STANDARD
        .decode(data.split_whitespace().collect::<String>())
        .ok()?;
    let mut out = Vec::new();
    flate2::read::GzDecoder::new(&gz[..])
        .take(MAX_SUBTITLE_BYTES)
        .read_to_end(&mut out)
        .ok()?;
    Some(out)
}

async fn rpc(method: &str, params: &[String]) -> Result<String> {
    let req = http()
        .post(ENDPOINT)
        .header(reqwest::header::CONTENT_TYPE, "text/xml")
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .body(call_xml(method, params));
    let resp = send(req)
        .await
        .map_err(|e| http_err(OPENSUBTITLES_ORG, e))?;
    let status = resp.status().as_u16();
    let bytes = read_capped(resp, 20 * 1024 * 1024)
        .await
        .map_err(|e| http_err(OPENSUBTITLES_ORG, e))?;
    if !(200..300).contains(&status) {
        return Err(http_err(
            OPENSUBTITLES_ORG,
            HttpError::Status {
                status,
                body: bytes,
            },
        ));
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

impl OpenSubtitlesOrgProvider {
    /// Sesión anónima (una por búsqueda); `None` si el servidor no la da.
    async fn token(&self) -> Option<String> {
        self.token
            .get_or_init(|| async {
                let xml = rpc(
                    "LogIn",
                    &[string(""), string(""), string("eng"), string(USER_AGENT)],
                )
                .await
                .ok()?;
                if !status(&xml).starts_with("200") {
                    tracing::warn!("OpenSubtitles.org no dio sesión anónima: {}", status(&xml));
                    return None;
                }
                results_token(&xml)
            })
            .await
            .clone()
    }
}

fn results_token(xml: &str) -> Option<String> {
    xml.split("<member>")
        .find(|m| between(m, "<name>", "</name>").map(str::trim) == Some("token"))
        .and_then(|m| between(m, "<value>", "</value>"))
        .map(scalar)
        .filter(|t| !t.is_empty())
}

#[async_trait]
impl SubtitleProvider for OpenSubtitlesOrgProvider {
    fn id(&self) -> &'static str {
        OPENSUBTITLES_ORG
    }
    async fn quota(&self) -> Result<Option<Quota>> {
        Ok(None)
    }
    async fn search(
        &self,
        video: &VideoIdentity,
        lang: SubtitleLanguage,
    ) -> Result<Vec<SubtitleCandidate>> {
        let codes = match lang {
            SubtitleLanguage::Es => "spa,spl",
            SubtitleLanguage::En => "eng",
            SubtitleLanguage::None => return Ok(Vec::new()),
        };
        if LIMIT_REACHED.load(Ordering::Relaxed) {
            return Err(err(
                OPENSUBTITLES_ORG,
                "límite de descargas anónimas del día alcanzado",
            ));
        }
        // Por IMDb (con temporada/episodio en series); sin IMDb, por título.
        let mut criterion = vec![format!(
            "<member><name>sublanguageid</name><value>{}</value></member>",
            string(codes)
        )];
        match (&video.imdb_id, &video.title) {
            (Some(imdb), _) => criterion.push(format!(
                "<member><name>imdbid</name><value>{}</value></member>",
                string(imdb.trim_start_matches("tt"))
            )),
            (None, Some(title)) => criterion.push(format!(
                "<member><name>query</name><value>{}</value></member>",
                string(title)
            )),
            (None, None) => return Ok(Vec::new()),
        }
        if let (Some(s), Some(e)) = (video.season, video.episode) {
            criterion.push(format!(
                "<member><name>season</name><value><int>{s}</int></value></member>"
            ));
            criterion.push(format!(
                "<member><name>episode</name><value><int>{e}</int></value></member>"
            ));
        }
        let Some(token) = self.token().await else {
            return Err(err(OPENSUBTITLES_ORG, "no dio sesión anónima"));
        };
        let query = format!(
            "<array><data><value><struct>{}</struct></value></data></array>",
            criterion.concat()
        );
        let xml = rpc("SearchSubtitles", &[string(&token), query]).await?;
        Ok(parse_search(&xml, video, lang))
    }
    async fn download(&self, cand: &SubtitleCandidate, cache_dir: &Path) -> Result<PathBuf> {
        if let Some(p) = cached(cache_dir, cand) {
            return Ok(p);
        }
        let Some(token) = self.token().await else {
            return Err(err(OPENSUBTITLES_ORG, "no dio sesión anónima"));
        };
        let ids = format!(
            "<array><data><value>{}</value></data></array>",
            string(&cand.provider_id)
        );
        let xml = rpc("DownloadSubtitles", &[string(&token), ids]).await?;
        let st = status(&xml);
        if st.starts_with("407") {
            LIMIT_REACHED.store(true, Ordering::Relaxed);
            return Err(err(
                OPENSUBTITLES_ORG,
                "límite de descargas anónimas del día alcanzado",
            ));
        }
        let bytes = decode_download(&xml)
            .ok_or_else(|| err(OPENSUBTITLES_ORG, format!("descarga inválida ({st})")))?;
        save(cache_dir, cand, &bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const SEARCH: &str = r#"<?xml version="1.0" encoding="utf-8"?><methodResponse><params><param><value><struct>
<member><name>status</name><value><string>200 OK</string></value></member>
<member><name>data</name><value><array><data>
<value><struct>
<member><name>IDSubtitleFile</name><value><string>1955627137</string></value></member>
<member><name>SubFormat</name><value><string>srt</string></value></member>
<member><name>SubDownloadsCnt</name><value><string>23567</string></value></member>
<member><name>MovieReleaseName</name><value><string> Ozark.S01E01.Sugarwood.720p.WEBRip.x264-STRiFE</string></value></member>
<member><name>SubLanguageID</name><value><string>spa</string></value></member>
</struct></value>
<value><struct>
<member><name>IDSubtitleFile</name><value><string>42</string></value></member>
<member><name>SubFormat</name><value><string>srt</string></value></member>
<member><name>SubDownloadsCnt</name><value><string>10</string></value></member>
<member><name>MovieReleaseName</name><value><string>Ozark S01E01 &amp; más</string></value></member>
<member><name>SubLanguageID</name><value><string>spl</string></value></member>
</struct></value>
<value><struct>
<member><name>IDSubtitleFile</name><value><string>99</string></value></member>
<member><name>SubFormat</name><value><string>srt</string></value></member>
<member><name>MovieReleaseName</name><value><string>Grey&#39;s Anatomy 14x01 - Break Down the House</string></value></member>
<member><name>SubLanguageID</name><value><string>spa</string></value></member>
</struct></value>
<value><struct>
<member><name>IDSubtitleFile</name><value><string>7</string></value></member>
<member><name>SubFormat</name><value><string>sub</string></value></member>
<member><name>SubLanguageID</name><value><string>spa</string></value></member>
</struct></value>
</data></array></value></member>
</struct></value></param></params></methodResponse>"#;

    #[test]
    fn busqueda_español_latino_y_formatos() {
        let video = VideoIdentity {
            title: Some("Ozark".into()),
            season: Some(1),
            episode: Some(1),
            ..Default::default()
        };
        let found = parse_search(SEARCH, &video, SubtitleLanguage::Es);
        assert_eq!(
            found.len(),
            2,
            "ni el .sub ni el de otra serie (14x01) mal cargado con este IMDb"
        );
        assert_eq!(found[0].provider_id, "1955627137");
        assert_eq!(found[0].downloads, 23567);
        assert_eq!(
            found[0].release_name,
            "Ozark.S01E01.Sugarwood.720p.WEBRip.x264-STRiFE"
        );
        assert_eq!(found[1].variant, SpanishVariant::Latino);
        assert_eq!(found[1].release_name, "Ozark S01E01 & más");
        assert!(parse_search(SEARCH, &video, SubtitleLanguage::En).is_empty());
        assert_eq!(status(SEARCH), "200 OK");
        assert_eq!(unescape("&#34;Ozark&#34; &amp; &#x41;"), "\"Ozark\" & A");
    }

    #[test]
    fn descarga_base64_gzip() {
        let srt = "1\n00:00:01,000 --> 00:00:02,000\nPlata, pasta.\n";
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        gz.write_all(srt.as_bytes()).unwrap();
        let b64 = base64::engine::general_purpose::STANDARD.encode(gz.finish().unwrap());
        let xml = format!(
            "<methodResponse><params><param><value><struct><member><name>status</name><value><string>200 OK</string></value></member><member><name>data</name><value><array><data><value><struct><member><name>idsubtitlefile</name><value><string>1</string></value></member><member><name>data</name><value><string>{b64}</string></value></member></struct></value></data></array></value></member></struct></value></param></params></methodResponse>"
        );
        assert_eq!(decode_download(&xml).unwrap(), srt.as_bytes());
        let login = "<struct><member><name>token</name><value><string>abc123</string></value></member><member><name>status</name><value><string>200 OK</string></value></member></struct>";
        assert_eq!(results_token(login).as_deref(), Some("abc123"));
    }
}
