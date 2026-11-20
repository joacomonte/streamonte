//! Metadatos de Cinemeta (FR-36, 38, 39, 40; spec 10 §B). Sin key; en inglés (ADR-16, Q-21).
//! La búsqueda acepta títulos en español gracias a los alias de Cinemeta.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::http::Http;
use super::normalize::clean;
use super::protocol::{encode_extra, CatalogResponse, MetaResponse, RawMeta, RawVideo};
use super::{is_imdb_id, MediaKind};

pub const CINEMETA: &str = "https://v3-cinemeta.strem.io";
/// FR-36: como mucho 20 por tipo.
const MAX_RESULTS: usize = 20;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetaPreview {
    pub id: String,
    pub kind: MediaKind,
    pub name: String,
    pub year: Option<String>,
    pub imdb_rating: Option<String>,
    /// FR-40, si la preview trae país y géneros (Explorar sí; la búsqueda no, ver `find_excluded`).
    pub excluded: bool,
    pub poster: Option<String>,
    /// Fecha de estreno (película) o de primera emisión (serie), `AAAA-MM-DD`, si Cinemeta la trae.
    pub released: Option<String>,
    /// Popularidad de TMDB según Cinemeta: con año o rango la UI ordena lo cargado por esto
    /// (los catálogos `year` vienen por fecha, no por popularidad).
    pub popularity: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Meta {
    pub id: String,
    pub kind: MediaKind,
    pub name: String,
    pub year: Option<String>,
    pub runtime_min: Option<u32>,
    pub country: Option<String>,
    pub genres: Vec<String>,
    pub imdb_rating: Option<String>,
    pub description: Option<String>,
    pub poster: Option<String>,
    pub background: Option<String>,
    /// Ordenados: temporadas 1…n, después 0 ("Especiales"); por episodio (FR-39).
    pub episodes: Vec<Episode>,
    /// FR-40 (regla Q-12).
    pub excluded: bool,
    /// Series: `Continuing` o `Ended` (lo que dice Cinemeta).
    pub status: Option<String>,
    /// Reparto principal (los primeros 3).
    #[serde(default)]
    pub cast: Vec<String>,
    /// Premios en español y corto: `Ganó 2 Óscar · 164 premios`.
    #[serde(default)]
    pub awards: Option<String>,
    /// Fecha de estreno `AAAA-MM-DD` (para avisar "En cines").
    #[serde(default)]
    pub released: Option<String>,
    /// Id de YouTube del primer tráiler.
    #[serde(default)]
    pub trailer: Option<String>,
    /// Votos de IMDb (dataset oficial, si ya está cargado); no se guarda con la ficha.
    #[serde(default)]
    pub imdb_votes: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Episode {
    /// `tt…:T:E`
    pub id: String,
    pub season: u32,
    pub episode: u32,
    pub title: String,
    pub released: Option<String>,
    pub overview: Option<String>,
    pub thumbnail: Option<String>,
    /// `false` = todavía no se estrenó (gris, no se puede elegir).
    pub available: bool,
}

pub async fn search(
    http: &Http,
    kind: MediaKind,
    query: &str,
    timeout: Duration,
) -> Result<Vec<MetaPreview>, super::http::FetchError> {
    let url = format!(
        "{CINEMETA}/catalog/{}/top/search={}.json",
        kind.as_str(),
        encode_extra(query.trim())
    );
    let resp: CatalogResponse = http.get_json(&url, timeout).await?;
    Ok(resp
        .metas
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| serde_json::from_value::<RawMeta>(v).ok())
        .filter_map(|m| preview(m, kind))
        .take(MAX_RESULTS)
        .collect())
}

/// Orden de Explorar: populares o mejor puntuadas (con TMDB lo aplica `top`; acá elige el catálogo).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BrowseSort {
    /// Cinemeta `top`.
    Popular,
    /// Cinemeta `imdbRating`.
    Rating,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowsePage {
    pub items: Vec<MetaPreview>,
    pub has_more: bool,
}

/// En tendencia ahora (2026-11-16, Explorar sin key de TMDB): una página de 50 del catálogo
/// `top` de Cinemeta (lo más visto del momento). `genre` (p. ej. `Documentary`) lo filtra Cinemeta.
pub async fn trending(
    http: &Http,
    kind: MediaKind,
    skip: u32,
    timeout: Duration,
) -> Result<BrowsePage, super::http::FetchError> {
    let extra = if skip > 0 {
        format!("/skip={skip}")
    } else {
        String::new()
    };
    let url = format!("{CINEMETA}/catalog/{}/top{extra}.json", kind.as_str());
    let resp: CatalogResponse = http.get_json(&url, timeout).await?;
    let raw = resp.metas.unwrap_or_default();
    let has_more = resp.has_more.unwrap_or(!raw.is_empty());
    Ok(BrowsePage {
        items: raw
            .into_iter()
            .filter_map(|v| serde_json::from_value::<RawMeta>(v).ok())
            .filter_map(|m| preview(m, kind))
            .collect(),
        has_more,
    })
}

fn preview(m: RawMeta, kind: MediaKind) -> Option<MetaPreview> {
    let id = m.id.filter(|id| is_imdb_id(id))?;
    Some(MetaPreview {
        id,
        kind,
        name: clean(m.name.as_deref().unwrap_or("?")),
        year: year_of(&m.release_info, &m.year),
        excluded: is_excluded(m.country.as_deref(), &m.genres.clone().unwrap_or_default()),
        imdb_rating: m.imdb_rating.as_deref().map(clean),
        poster: https_only(m.poster),
        released: m.released.as_deref().and_then(|r| r.get(..10)).map(clean),
        popularity: m.popularities.and_then(|p| p.moviedb),
    })
}

pub async fn meta(
    http: &Http,
    kind: MediaKind,
    id: &str,
    timeout: Duration,
) -> Result<Meta, super::http::FetchError> {
    let url = format!("{CINEMETA}/meta/{}/{id}.json", kind.as_str());
    let resp: MetaResponse = http.get_json(&url, timeout).await?;
    let m = resp.meta.ok_or(super::http::FetchError::Status(404))?;
    Ok(to_meta(m, kind, id, chrono::Utc::now()))
}

fn to_meta(m: RawMeta, kind: MediaKind, id: &str, now: chrono::DateTime<chrono::Utc>) -> Meta {
    let genres: Vec<String> = m
        .genres
        .clone()
        .unwrap_or_default()
        .iter()
        .map(|g| clean(g))
        .collect();
    let country = m.country.as_deref().map(clean);
    let mut episodes: Vec<Episode> = m
        .videos
        .clone()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| serde_json::from_value::<RawVideo>(v).ok())
        .filter_map(|v| {
            let (season, episode) = (v.season?, v.episode?);
            let available = v
                .released
                .as_deref()
                .and_then(|r| chrono::DateTime::parse_from_rfc3339(r).ok())
                .map_or(true, |d| d <= now);
            Some(Episode {
                id: format!("{id}:{season}:{episode}"),
                season,
                episode,
                title: clean(v.name.as_deref().or(v.title.as_deref()).unwrap_or("")),
                released: v
                    .released
                    .as_deref()
                    .map(|r| clean(r.get(..10).unwrap_or(r))),
                overview: v.overview.as_deref().map(clean),
                thumbnail: https_only(v.thumbnail),
                available,
            })
        })
        .collect();
    episodes.sort_by_key(|e| (e.season == 0, e.season, e.episode));
    episodes.dedup_by(|a, b| a.id == b.id);
    Meta {
        id: id.to_string(),
        kind,
        name: clean(m.name.as_deref().unwrap_or("?")),
        year: year_of(&m.release_info, &m.year),
        released: m.released.as_deref().and_then(|r| r.get(..10)).map(clean),
        runtime_min: m
            .runtime
            .as_deref()
            .and_then(|r| r.split_whitespace().next()?.parse().ok()),
        excluded: is_excluded(country.as_deref(), &genres),
        country,
        genres,
        imdb_rating: m.imdb_rating.as_deref().map(clean),
        description: m
            .description
            .as_deref()
            .map(|d| d.chars().filter(|c| !c.is_control()).take(2000).collect()),
        poster: https_only(m.poster),
        background: https_only(m.background),
        episodes,
        status: m.status.as_deref().map(clean),
        cast: m
            .cast
            .unwrap_or_default()
            .iter()
            .take(3)
            .map(|c| clean(c))
            .collect(),
        awards: m.awards.as_deref().and_then(awards_es),
        trailer: m
            .trailer_streams
            .unwrap_or_default()
            .iter()
            .filter_map(|t| t.get("ytId")?.as_str())
            .find(|id| is_youtube_id(id))
            .map(str::to_string),
        imdb_votes: None,
    }
}

/// Id de video de YouTube: 11 caracteres de `[A-Za-z0-9_-]` (también valida lo que pide la UI).
pub fn is_youtube_id(id: &str) -> bool {
    id.len() == 11
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// `Won 2 Oscars. 164 wins & 165 nominations total` → `Ganó 2 Óscar · 164 premios`; sin premios
/// ni nominaciones, `None`. Lo que no se reconoce se omite (mejor nada que inglés a medias).
fn awards_es(raw: &str) -> Option<String> {
    let num = |s: &str| s.split_whitespace().next()?.parse::<u32>().ok();
    let prize = |rest: &str| {
        [
            ("Oscar", "Óscar"),
            ("Primetime Emmy", "Emmy"),
            ("Golden Globe", "Globo de Oro"),
            ("BAFTA", "BAFTA"),
        ]
        .into_iter()
        .find(|(en, _)| rest.contains(en))
        .map(|(_, es)| es)
    };
    let mut out = Vec::new();
    for part in raw.split('.').map(str::trim) {
        if let Some(rest) = part.strip_prefix("Won ") {
            if let (Some(n), Some(p)) = (num(rest), prize(rest)) {
                out.push(format!("Ganó {n} {p}"));
            }
        } else if let Some(rest) = part.strip_prefix("Nominated for ") {
            if let (Some(n), Some(p)) = (num(rest), prize(rest)) {
                out.push(format!(
                    "{n} {} al {p}",
                    if n == 1 {
                        "nominación"
                    } else {
                        "nominaciones"
                    }
                ));
            }
        } else if part.contains(" win") {
            if let Some(n) = num(part).filter(|&n| n > 0) {
                out.push(format!("{n} {}", if n == 1 { "premio" } else { "premios" }));
            }
        } else if let Some(n) = part
            .contains(" nomination")
            .then(|| num(part))
            .flatten()
            .filter(|&n| n > 0)
        {
            out.push(format!(
                "{n} {}",
                if n == 1 {
                    "nominación"
                } else {
                    "nominaciones"
                }
            ));
        }
    }
    (!out.is_empty()).then(|| out.join(" · "))
}

/// Regla de exclusión (FR-40, Q-12 confirmada 2026-11-14): Japón como primer país, o Japón en
/// cualquier posición y género Animación.
pub fn is_excluded(country: Option<&str>, genres: &[String]) -> bool {
    let countries: Vec<&str> = country
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .collect();
    let japan = |c: &&str| c.eq_ignore_ascii_case("japan");
    countries.first().is_some_and(japan)
        || (countries.iter().any(japan)
            && genres.iter().any(|g| g.eq_ignore_ascii_case("animation")))
}

fn year_of(release_info: &Option<String>, year: &Option<String>) -> Option<String> {
    release_info
        .as_deref()
        .or(year.as_deref())
        .map(clean)
        .filter(|y| !y.is_empty())
}

/// Solo imágenes por HTTPS (la CSP de la ventana no deja otra cosa).
fn https_only(url: Option<String>) -> Option<String> {
    url.filter(|u| u.starts_with("https://") && u.len() < 2048)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// T-25 (regla Q-12).
    #[test]
    fn premios_en_espanol() {
        assert_eq!(
            awards_es("Won 2 Oscars. 164 wins & 165 nominations total").as_deref(),
            Some("Ganó 2 Óscar · 164 premios")
        );
        assert_eq!(
            awards_es("Won 59 Primetime Emmys. 396 wins & 656 nominations total").as_deref(),
            Some("Ganó 59 Emmy · 396 premios")
        );
        assert_eq!(
            awards_es("Nominated for 1 Oscar. 3 wins & 10 nominations total").as_deref(),
            Some("1 nominación al Óscar · 3 premios")
        );
        assert_eq!(
            awards_es("4 nominations total").as_deref(),
            Some("4 nominaciones")
        );
        assert_eq!(awards_es(""), None);
    }

    #[test]
    fn exclusion_japonesa() {
        let g = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(is_excluded(Some("Japan"), &g(&["Animation", "Action"]))); // Attack on Titan
        assert!(is_excluded(Some("Japan"), &g(&["Adventure"]))); // One Piece
        assert!(is_excluded(
            Some("Japan, United States"),
            &g(&["Animation"])
        )); // Spirited Away
        assert!(!is_excluded(Some("United States"), &g(&["Animation"]))); // The Simpsons
        assert!(!is_excluded(Some("United States, Japan"), &g(&["Drama"]))); // Lost in Translation
        assert!(!is_excluded(None, &[]));
    }

    /// T-32 parcial (FR-39): temporadas ordenadas con Especiales al final, no estrenados grises.
    #[test]
    fn episodios_de_serie() {
        let raw: RawMeta = serde_json::from_value(serde_json::json!({
            "id": "tt9999999", "name": "Serie sintética", "releaseInfo": "2008–2013",
            "runtime": "47 min", "country": "United States", "genres": ["Drama"],
            "poster": "http://inseguro/x.jpg",
            "videos": [
                {"id":"tt9999999:0:1","season":0,"episode":1,"name":"Especial","released":"2009-01-01T00:00:00.000Z"},
                {"id":"tt9999999:1:2","season":1,"episode":2,"name":"Dos","released":"2008-01-27T00:00:00.000Z"},
                {"id":"tt9999999:1:1","season":1,"episode":1,"name":"Pilot","released":"2008-01-20T00:00:00.000Z"},
                {"id":"tt9999999:2:1","season":2,"episode":1,"name":"Futuro","released":"2099-01-01T00:00:00.000Z"}
            ]
        }))
        .unwrap();
        let m = to_meta(raw, MediaKind::Series, "tt9999999", chrono::Utc::now());
        let ids: Vec<&str> = m.episodes.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "tt9999999:1:1",
                "tt9999999:1:2",
                "tt9999999:2:1",
                "tt9999999:0:1"
            ]
        );
        assert_eq!(m.episodes[0].title, "Pilot");
        assert!(!m.episodes[2].available);
        assert_eq!(m.runtime_min, Some(47));
        assert_eq!(m.poster, None);
        assert_eq!(m.year.as_deref(), Some("2008–2013"));
        assert!(!m.excluded);
    }
}
