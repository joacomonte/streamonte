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
    /// Géneros en español (solo la lista con filtros de IMDb; la UI filtra por ellos sin pedir de nuevo).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub genres: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchResults {
    pub movies: Vec<MetaPreview>,
    pub series: Vec<MetaPreview>,
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
    genre: Option<&str>,
    skip: u32,
    timeout: Duration,
) -> Result<BrowsePage, super::http::FetchError> {
    let mut extras = Vec::new();
    if let Some(g) = genre {
        extras.push(format!("genre={}", encode_extra(g)));
    }
    if skip > 0 {
        extras.push(format!("skip={skip}"));
    }
    let extra = if extras.is_empty() {
        String::new()
    } else {
        format!("/{}", extras.join("&"))
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
        genres: Vec::new(),
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
    }
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
