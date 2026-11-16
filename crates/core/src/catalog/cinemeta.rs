//! Metadatos de Cinemeta (FR-36, 38, 39, 40; spec 10 §B). Sin key; en inglés (ADR-16, Q-21).
//! La búsqueda acepta títulos en español gracias a los alias de Cinemeta.

use std::time::Duration;

use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};

use super::http::Http;
use super::normalize::clean;
use super::protocol::{encode_extra, CatalogResponse, MetaResponse, RawMeta, RawVideo};
use super::{is_imdb_id, MediaKind};

pub const CINEMETA: &str = "https://v3-cinemeta.strem.io";
/// FR-36: como mucho 20 por tipo.
const MAX_RESULTS: usize = 20;

#[derive(Debug, Clone, Serialize)]
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

#[derive(Debug, Clone, Serialize)]
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
}

#[derive(Debug, Clone, Serialize)]
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

/// Explorar (FR-37, versión simple pedida el 2026-11-14): populares o mejor puntuadas, o las de un año.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BrowseSort {
    /// Cinemeta `top`.
    Popular,
    /// Cinemeta `imdbRating`.
    Rating,
}

#[derive(Debug, Clone, Serialize)]
pub struct BrowsePage {
    pub items: Vec<MetaPreview>,
    pub has_more: bool,
    /// Solo con rango de fechas: desde dónde sigue la próxima página.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next: Option<BrowseCursor>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct BrowseCursor {
    pub year: u16,
    pub skip: u32,
}

/// Una página de Cinemeta (50 por página, `skip`). Con año se usa el catálogo `year`
/// (Cinemeta no permite año + puntaje juntos: el orden por puntaje dentro del año lo hace la UI).
/// `genre` (p. ej. `Documentary`, pedido 2026-11-15): en `top`/`imdbRating` lo filtra Cinemeta;
/// el catálogo `year` ya usa `genre` para el año, así que ahí se filtra la página traída.
pub async fn browse(
    http: &Http,
    kind: MediaKind,
    sort: BrowseSort,
    year: Option<u16>,
    genre: Option<&str>,
    skip: u32,
    timeout: Duration,
) -> Result<BrowsePage, super::http::FetchError> {
    let mut extras = Vec::new();
    let list = match (year, sort) {
        (Some(y), _) => {
            extras.push(format!("genre={y}"));
            "year"
        }
        (None, BrowseSort::Popular) => "top",
        (None, BrowseSort::Rating) => "imdbRating",
    };
    if let (None, Some(g)) = (year, genre) {
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
    let url = format!("{CINEMETA}/catalog/{}/{list}{extra}.json", kind.as_str());
    let resp: CatalogResponse = http.get_json(&url, timeout).await?;
    let raw = resp.metas.unwrap_or_default();
    let has_more = resp.has_more.unwrap_or(!raw.is_empty());
    let in_genre = |m: &RawMeta| match (year, genre) {
        (Some(_), Some(g)) => m
            .genres
            .as_ref()
            .is_some_and(|gs| gs.iter().any(|x| x.eq_ignore_ascii_case(g))),
        _ => true,
    };
    Ok(BrowsePage {
        items: raw
            .into_iter()
            .filter_map(|v| serde_json::from_value::<RawMeta>(v).ok())
            .filter(in_genre)
            .filter_map(|m| preview(m, kind))
            .collect(),
        has_more,
        next: None,
    })
}

/// Páginas de Cinemeta por llamada con rango de fechas (cada una trae 50; la UI vuelve a pedir).
const RANGE_PAGES: usize = 4;

/// Rango de fechas de estreno (pedido 2026-11-14, como `release_date=desde,hasta` de IMDb).
/// Cinemeta no filtra por fecha: se recorren sus catálogos `year` (≈400 títulos por año,
/// del estreno más nuevo al más viejo) desde el año de `to` hacia atrás, filtrando por `released`.
/// shortcut: solo ve los títulos de esos catálogos y descarta los que no traen fecha;
/// si hiciera falta todo IMDb, usar otra fuente (p. ej. TMDB discover).
pub async fn browse_released(
    http: &Http,
    kind: MediaKind,
    from: NaiveDate,
    to: NaiveDate,
    genre: Option<&str>,
    cursor: Option<BrowseCursor>,
    timeout: Duration,
) -> Result<BrowsePage, super::http::FetchError> {
    let mut at = cursor.unwrap_or(BrowseCursor {
        year: u16::try_from(to.year()).unwrap_or(0),
        skip: 0,
    });
    let mut items = Vec::new();
    for _ in 0..RANGE_PAGES {
        if i32::from(at.year) < from.year() {
            break;
        }
        let page = browse(
            http,
            kind,
            BrowseSort::Popular,
            Some(at.year),
            genre,
            at.skip,
            timeout,
        )
        .await?;
        let (hits, past) = in_range(page.items, from, to);
        items.extend(hits);
        at = if page.has_more && !past {
            BrowseCursor {
                year: at.year,
                skip: at.skip + 50,
            }
        } else {
            BrowseCursor {
                year: at.year.saturating_sub(1),
                skip: 0,
            }
        };
        if items.len() >= MAX_RESULTS {
            break;
        }
    }
    let more = i32::from(at.year) >= from.year() && at.year > 0;
    Ok(BrowsePage {
        items,
        has_more: more,
        next: more.then_some(at),
    })
}

/// Se queda con los estrenados en `[from, to]`. `past` = la página ya es toda anterior a `from`
/// (el catálogo viene de más nuevo a más viejo: no hace falta seguir con ese año).
fn in_range(items: Vec<MetaPreview>, from: NaiveDate, to: NaiveDate) -> (Vec<MetaPreview>, bool) {
    let date = |p: &MetaPreview| {
        p.released
            .as_deref()
            .and_then(|r| NaiveDate::parse_from_str(r, "%Y-%m-%d").ok())
    };
    let dated: Vec<NaiveDate> = items.iter().filter_map(date).collect();
    let past = !dated.is_empty() && dated.iter().all(|d| *d < from);
    let hits = items
        .into_iter()
        .filter(|p| date(p).is_some_and(|d| (from..=to).contains(&d)))
        .collect();
    (hits, past)
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
    /// Filtro por fecha de estreno: se queda con el rango (bordes incluidos), descarta sin fecha
    /// y avisa cuando la página entera ya es anterior al rango.
    #[test]
    fn filtro_por_fecha_de_estreno() {
        let p = |id: &str, released: Option<&str>| MetaPreview {
            id: id.into(),
            kind: MediaKind::Movie,
            name: id.into(),
            year: None,
            imdb_rating: None,
            excluded: false,
            poster: None,
            released: released.map(Into::into),
            popularity: None,
            genres: Vec::new(),
        };
        let d = |s: &str| NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap();
        let (from, to) = (d("2026-09-01"), d("2026-11-14"));
        let page = vec![
            p("futuro", Some("2026-11-20")),
            p("hasta", Some("2026-11-14")),
            p("medio", Some("2026-10-16")),
            p("desde", Some("2026-09-01")),
            p("antes", Some("2026-08-31")),
            p("sin-fecha", None),
        ];
        let (hits, past) = in_range(page, from, to);
        let ids: Vec<&str> = hits.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, ["hasta", "medio", "desde"]);
        assert!(!past);
        let (hits, past) = in_range(vec![p("viejo", Some("2026-03-01")), p("x", None)], from, to);
        assert!(hits.is_empty() && past);
        // Página sin fechas: no se puede saber, se sigue.
        assert!(!in_range(vec![p("x", None)], from, to).1);
    }
}
