//! Hacktorrent y Pelispanda (2026-11-18): dos sitios con el mismo backend WordPress (tema
//! "wpreact") y la misma API JSON abierta, con audio latino/castellano. Se consulta solo la API
//! (nunca el HTML): `search?query=` (solo entiende títulos en español) y `movie/{slug}` (ficha con
//! `downloads[]`: magnet, calidad e idioma). Pelispanda es el espejo: se usa si Hacktorrent falla.
//! Series: la API no trae descargas de series (`serie/{slug}` sin `downloads`; probado con 5);
//! solo los animes traen episodios sueltos y la app no usa anime. Por eso acá solo películas.

use std::time::Duration;

use serde::Deserialize;

use super::addons::AddonOutcome;
use super::http::{FetchError, Http};
use super::normalize::{self, ParseCtx, Parsed, StreamCandidate};
use super::protocol::Stream;
use super::{cinemeta, tmdb, MediaKind, VideoId};
use crate::magnet::Magnet;

/// Sitio principal y espejo, en ese orden.
const BASES: [&str; 2] = ["https://hacktorrent.cc", "https://pelispanda.org"];
/// Páginas de búsqueda (10 resultados c/u) que se recorren buscando la película.
const MAX_PAGES: u32 = 3;
const MAX_DOWNLOADS: usize = 50;

#[derive(Deserialize)]
struct SearchResponse {
    #[serde(default)]
    results: Vec<Hit>,
    #[serde(default)]
    pages: u32,
}

#[derive(Deserialize)]
struct Hit {
    #[serde(default)]
    slug: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    year: Option<serde_json::Value>,
    #[serde(default)]
    tmdb_id: Option<serde_json::Value>,
    /// `pelicula`, `serie`, `anime`.
    #[serde(default, rename = "type")]
    kind: String,
}

/// Los ids y años llegan como texto ("2758") o número según el sitio.
fn as_text(v: &Option<serde_json::Value>) -> String {
    match v {
        Some(serde_json::Value::String(s)) => s.trim().to_string(),
        Some(serde_json::Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

#[derive(Deserialize)]
struct Ficha {
    #[serde(default)]
    downloads: Option<Vec<Download>>,
}

#[derive(Deserialize)]
struct Download {
    #[serde(default)]
    quality: Option<String>,
    /// `2.91 GB`.
    #[serde(default)]
    size: Option<String>,
    #[serde(default)]
    download_link: Option<String>,
    /// `Latino`, `Castellano`, `Latino/Inglés`…
    #[serde(default)]
    language: Option<String>,
}

/// Qué se busca: el título en español (TMDB; si no hay, el de Cinemeta) y cómo reconocer la peli.
struct Wanted {
    titles: Vec<String>,
    tmdb_id: Option<u64>,
    year: Option<String>,
}

async fn wanted(http: &Http, imdb_id: &str, timeout: Duration) -> Option<Wanted> {
    let local = tmdb::localized(http, imdb_id, timeout).await;
    let meta = cinemeta::meta(http, MediaKind::Movie, imdb_id, timeout)
        .await
        .ok();
    let mut titles: Vec<String> = Vec::new();
    for t in [
        local.as_ref().and_then(|l| l.title.clone()),
        meta.as_ref().map(|m| m.name.clone()),
    ]
    .into_iter()
    .flatten()
    {
        if !titles.iter().any(|x| x.eq_ignore_ascii_case(&t)) {
            titles.push(t);
        }
    }
    if titles.is_empty() {
        return None;
    }
    Some(Wanted {
        titles,
        tmdb_id: local.as_ref().map(|l| l.tmdb_id),
        year: local
            .and_then(|l| l.year)
            .or_else(|| meta.and_then(|m| m.year)),
    })
}

fn is_match(hit: &Hit, want: &Wanted) -> bool {
    if hit.kind != "pelicula" || hit.slug.is_empty() {
        return false;
    }
    match want.tmdb_id {
        Some(id) => as_text(&hit.tmdb_id) == id.to_string(),
        // Sin TMDB: mismo año y el título buscado dentro del hallado (o al revés).
        None => {
            let (a, b) = (hit.title.to_lowercase(), want.titles[0].to_lowercase());
            want.year.as_deref() == Some(as_text(&hit.year).as_str())
                && (a.contains(&b) || b.contains(&a))
        }
    }
}

/// Slug de la película en ese sitio, buscando por cada título hasta dar con ella.
async fn find_slug(
    http: &Http,
    base: &str,
    want: &Wanted,
    timeout: Duration,
) -> Result<Option<String>, FetchError> {
    let deadline = tokio::time::Instant::now() + timeout;
    let left = || deadline.saturating_duration_since(tokio::time::Instant::now());
    for title in &want.titles {
        let query = reqwest::Url::parse_with_params("https://x/", [("query", title.as_str())])
            .map(|u| u.query().unwrap_or_default().to_string())
            .unwrap_or_default();
        for page in 1..=MAX_PAGES {
            let url = format!("{base}/wp-json/wpreact/v1/search?{query}&page={page}");
            let resp: SearchResponse = http.get_json(&url, left()).await?;
            if let Some(hit) = resp.results.iter().find(|h| is_match(h, want)) {
                return Ok(Some(hit.slug.clone()));
            }
            if page >= resp.pages {
                break;
            }
        }
    }
    Ok(None)
}

/// Cada descarga de la ficha → candidato, con el mismo parser que los addons: el texto lleva el
/// nombre del magnet, la calidad, el idioma y el tamaño, y de ahí salen resolución, HDR, audio…
fn candidates(ficha: Ficha, name: &str, rank: usize) -> Vec<StreamCandidate> {
    let ctx = ParseCtx {
        addon_name: name,
        addon_rank: rank,
        spain_flag_is_generic: false,
        is_series: false,
    };
    ficha
        .downloads
        .unwrap_or_default()
        .into_iter()
        .take(MAX_DOWNLOADS)
        .filter_map(|d| {
            let magnet = Magnet::parse(d.download_link.as_deref()?.trim()).ok()?;
            let quality = d.quality.unwrap_or_default();
            let release = magnet
                .display_name
                .clone()
                .unwrap_or_else(|| quality.clone());
            let size = d.size.map(|s| format!("\n💾 {s}")).unwrap_or_default();
            let stream = Stream {
                info_hash: Some(magnet.info_hash.to_hex()),
                title: Some(format!(
                    "{release}\n{quality} {}{size}",
                    d.language.unwrap_or_default()
                )),
                sources: Some(
                    magnet
                        .trackers
                        .iter()
                        .map(|t| format!("tracker:{t}"))
                        .collect(),
                ),
                ..Stream::default()
            };
            match normalize::parse(&stream, &ctx) {
                Parsed::Candidate(c) => Some(*c),
                _ => None,
            }
        })
        .collect()
}

/// Consulta una película: busca en Hacktorrent y, si no responde, en Pelispanda.
pub async fn streams(
    http: &Http,
    video: &VideoId,
    kind: MediaKind,
    rank: usize,
    name: &str,
    timeout: Duration,
) -> AddonOutcome {
    if kind == MediaKind::Series {
        return AddonOutcome::Unsupported;
    }
    let deadline = tokio::time::Instant::now() + timeout;
    let left = || deadline.saturating_duration_since(tokio::time::Instant::now());
    let Some(want) = wanted(http, video.imdb_id(), left() / 3).await else {
        return AddonOutcome::Failed("no se pudo obtener el título".into());
    };
    let mut last_err = None;
    for (i, base) in BASES.iter().enumerate() {
        // El principal usa 2/3 del tiempo que queda; el espejo, el resto.
        let budget = if i == 0 { left() * 2 / 3 } else { left() };
        let attempt = async {
            let Some(slug) = find_slug(http, base, &want, budget).await? else {
                return Ok(Vec::new());
            };
            let url = format!("{base}/wp-json/wpreact/v1/movie/{slug}");
            let ficha: Ficha = http.get_json(&url, budget).await?;
            Ok::<_, FetchError>(candidates(ficha, name, rank))
        };
        match tokio::time::timeout(budget, attempt).await {
            Ok(Ok(list)) => return AddonOutcome::Ok(list),
            Ok(Err(e)) => last_err = Some(e.user_text()),
            Err(_) => last_err = Some(FetchError::Timeout.user_text()),
        }
        tracing::info!(site = %base, "wpreact: {}", last_err.as_deref().unwrap_or(""));
    }
    AddonOutcome::Failed(last_err.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ficha real de hacktorrent.cc (recortada): `Los locos Addams` 1991.
    const FICHA: &str = r#"{"slug":"los-locos-addams-3","tmdb_id":"2907","type":"pelicula","downloads":[
      {"quality":"Dual 1080p","size":"2.91 GB","subs":1,"download_type":"link",
       "download_link":"magnet:?xt=urn:btih:11D28409E84E630AFA6F105F5746CC3B168CBE6B&dn=Los.locos.Addams.1991.1080p-dual-lat&tr=udp%3a%2f%2ftracker.opentrackr.org%3a1337%2fannounce","language":"Latino/Inglés"},
      {"quality":"WEB-DL 4k DV HDR","size":"18.4 GB","download_link":"magnet:?xt=urn:btih:47F3ACFCE7A0B580047EA64598BB2FC3963867BE&dn=Arthur.2024.2160p","language":"Castellano"},
      {"quality":"DVD Rip","size":"498 MB","download_link":"magnet:?xt=urn:btih:22526157035B7E798D4815C15D7F7F53331D5F7D&dn=Los.locos.Addams.1991.DVDrip-lat","language":"Latino"},
      {"quality":"HD","download_link":"https://sitio/no-es-magnet","language":"Latino"}]}"#;

    #[test]
    fn ficha_a_candidatos_con_idioma() {
        let ficha: Ficha = serde_json::from_str(FICHA).unwrap();
        let list = candidates(ficha, "Hacktorrent", 5);
        // El link que no es magnet se descarta.
        assert_eq!(list.len(), 3);
        assert_eq!(list[0].addons, ["Hacktorrent"]);
        assert_eq!(list[0].resolution.as_deref(), Some("1080p"));
        assert_eq!(list[0].audio, ["lat", "en", "multi"]);
        assert_eq!(
            list[0].size_bytes,
            Some((2.91 * 1024.0 * 1024.0 * 1024.0) as u64)
        );
        assert_eq!(
            list[0].trackers,
            ["udp://tracker.opentrackr.org:1337/announce"]
        );
        // Castellano → `cast`; calidad 4K con HDR/DV de la etiqueta.
        assert_eq!(list[1].audio, ["cast"]);
        assert_eq!(list[1].resolution.as_deref(), Some("2160p"));
        assert_eq!(list[1].hdr, ["HDR", "DV"]);
        assert_eq!(list[2].audio, ["lat"]);
    }

    #[test]
    fn busqueda_reconoce_por_tmdb_o_por_anio() {
        let hits: SearchResponse = serde_json::from_str(
            r#"{"pages":1,"results":[
              {"slug":"a","title":"Los Locos Addams","year":"2019","tmdb_id":"481084","type":"pelicula"},
              {"slug":"b","title":"Los Locos Addams","year":"1991","tmdb_id":2907,"type":"pelicula"},
              {"slug":"c","title":"Los Locos Addams","year":"1991","tmdb_id":"2907","type":"serie"}]}"#,
        )
        .unwrap();
        let by_tmdb = Wanted {
            titles: vec!["Los locos Addams".into()],
            tmdb_id: Some(2907),
            year: Some("1991".into()),
        };
        assert_eq!(
            hits.results
                .iter()
                .find(|h| is_match(h, &by_tmdb))
                .unwrap()
                .slug,
            "b"
        );
        let by_year = Wanted {
            titles: vec!["Los locos Addams".into()],
            tmdb_id: None,
            year: Some("2019".into()),
        };
        assert_eq!(
            hits.results
                .iter()
                .find(|h| is_match(h, &by_year))
                .unwrap()
                .slug,
            "a"
        );
    }
}
