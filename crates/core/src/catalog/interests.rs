//! Búsqueda por subgéneros de IMDb ("interests", ids `in…`) con su API GraphQL pública (la de su sitio): Explorar con
//! un género elegido y los ejemplos de las tarjetas de géneros. Uso personal (la app es privada). La misma consulta
//! vive en la web: `web/src/lib/server/interests.ts`. No necesita la key de TMDB: IMDb da título (en el idioma pedido),
//! puntaje, póster y fecha.

use std::collections::HashMap;
use std::time::Duration;

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use super::cinemeta::{BrowseSort, MetaPreview};
use super::http::Http;
use super::MediaKind;
use crate::config::Lang;
use crate::Result;

const GQL: &str = "https://caching.graphql.imdb.com/";
/// Lo más que se pide de una búsqueda: Explorar del desktop muestra toda la lista de una vez.
const MAX: u32 = 250;

/// Filtros de Explorar con subgéneros (alcanza con uno de `interests`).
#[derive(Debug, Clone)]
pub struct InterestQuery {
    pub kind: MediaKind,
    pub sort: BrowseSort,
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub min_votes: u32,
    /// ISO 639-1 del idioma original (alcanza con uno); vacío = cualquiera.
    pub languages: Vec<String>,
    pub interests: Vec<String>,
    pub titles: Lang,
}

/// Un ejemplo de la tarjeta de un subgénero: título como lo da IMDb y póster chico.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Example {
    pub title: String,
    pub poster: Option<String>,
}

#[derive(Deserialize)]
struct Gql {
    data: Option<HashMap<String, Option<Search>>>,
}
#[derive(Deserialize)]
struct Search {
    edges: Vec<Edge>,
}
#[derive(Deserialize)]
struct Edge {
    node: Node,
}
#[derive(Deserialize)]
struct Node {
    title: Title,
}
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Title {
    id: String,
    title_text: Option<Text>,
    release_year: Option<Year>,
    release_date: Option<Date>,
    ratings_summary: Option<Ratings>,
    primary_image: Option<Image>,
    title_genres: Option<Genres>,
}
#[derive(Deserialize)]
struct Text {
    text: String,
}
#[derive(Deserialize)]
struct Year {
    year: Option<i32>,
}
#[derive(Deserialize)]
struct Date {
    year: Option<i32>,
    month: Option<u32>,
    day: Option<u32>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Ratings {
    aggregate_rating: Option<f32>,
}
#[derive(Deserialize)]
struct Image {
    url: String,
}
#[derive(Deserialize)]
struct Genres {
    genres: Vec<GenreRef>,
}
#[derive(Deserialize)]
struct GenreRef {
    genre: Text,
}

const fn types(kind: MediaKind) -> &'static str {
    match kind {
        MediaKind::Movie => r#"["movie"]"#,
        MediaKind::Series => r#"["tvSeries","tvMiniSeries"]"#,
    }
}

/// Póster de IMDb achicado (el original pesa varios MB).
fn small_poster(url: &str, width: u32) -> String {
    match url.find("._V1_") {
        Some(i) if url.ends_with(".jpg") => format!("{}._V1_QL75_UX{width}_.jpg", &url[..i]),
        _ => url.to_string(),
    }
}

/// Lista de ids para GraphQL (`["in0000001"]`): solo ids válidos, nunca texto libre.
fn id_list(ids: &[String]) -> String {
    let ok: Vec<String> = ids
        .iter()
        .filter(|id| {
            id.len() == 9 && id.starts_with("in") && id[2..].bytes().all(|b| b.is_ascii_digit())
        })
        .map(|id| format!("\"{id}\""))
        .collect();
    format!("[{}]", ok.join(","))
}

fn constraints(q: &InterestQuery) -> String {
    let mut c = vec![
        format!(
            "interestConstraint: {{ anyInterestIds: {} }}",
            id_list(&q.interests)
        ),
        format!(
            "titleTypeConstraint: {{ anyTitleTypeIds: {} }}",
            types(q.kind)
        ),
        format!(
            "releaseDateConstraint: {{ releaseDateRange: {{ start: \"{}\", end: \"{}\" }} }}",
            q.from, q.to
        ),
    ];
    if q.min_votes > 0 {
        c.push(format!(
            "userRatingsConstraint: {{ ratingsCountRange: {{ min: {} }} }}",
            q.min_votes
        ));
    }
    let langs: Vec<String> = q
        .languages
        .iter()
        .filter(|l| l.len() == 2 && l.bytes().all(|b| b.is_ascii_lowercase()))
        .map(|l| format!("\"{l}\""))
        .collect();
    if !langs.is_empty() {
        c.push(format!(
            "languageConstraint: {{ anyPrimaryLanguages: [{}] }}",
            langs.join(",")
        ));
    }
    c.join(", ")
}

async fn query(http: &Http, q: String, lang: &str, timeout: Duration) -> Result<Gql> {
    let headers = [
        // Sin este header IMDb responde 403.
        ("x-imdb-client-name", "imdb-web-next"),
        ("x-imdb-user-language", lang),
    ];
    http.post_json(GQL, &headers, &serde_json::json!({ "query": q }), timeout)
        .await
        .map_err(|e| super::fetch_error("buscar en IMDb", &e))
}

fn preview(t: Title, kind: MediaKind) -> MetaPreview {
    let released = t
        .release_date
        .as_ref()
        .and_then(|d| NaiveDate::from_ymd_opt(d.year?, d.month?, d.day?).map(|d| d.to_string()));
    let year = t
        .release_year
        .and_then(|y| y.year)
        .or(t.release_date.and_then(|d| d.year));
    let documentary = t
        .title_genres
        .is_some_and(|g| g.genres.iter().any(|g| g.genre.text == "Documentary"));
    MetaPreview {
        id: t.id,
        kind,
        name: t.title_text.map(|x| x.text).unwrap_or_default(),
        year: year.map(|y| y.to_string()),
        imdb_rating: t
            .ratings_summary
            .and_then(|r| r.aggregate_rating)
            .map(super::top::rating_label),
        // El idioma original (en/es) ya deja afuera lo japonés.
        excluded: false,
        documentary,
        poster: t.primary_image.map(|i| small_poster(&i.url, 342)),
        released: if kind == MediaKind::Movie {
            released
        } else {
            None
        },
        popularity: None,
    }
}

/// Toda la lista (hasta 250), ya ordenada: por puntaje de IMDb o por popularidad.
pub async fn list(http: &Http, q: &InterestQuery, timeout: Duration) -> Result<Vec<MetaPreview>> {
    let sort = match q.sort {
        BrowseSort::Popular => "sortBy: POPULARITY, sortOrder: ASC",
        _ => "sortBy: USER_RATING, sortOrder: DESC",
    };
    let gql = format!(
        "{{ s: advancedTitleSearch(first: {MAX}, constraints: {{ {} }}, sort: {{ {sort} }}) {{ edges {{ node {{ title {{ id titleText {{ text }} releaseYear {{ year }} releaseDate {{ year month day }} ratingsSummary {{ aggregateRating }} primaryImage {{ url }} titleGenres {{ genres {{ genre {{ text }} }} }} }} }} }} }} }}",
        constraints(q)
    );
    let j = query(http, gql, q.titles.tmdb(), timeout).await?;
    let edges = j
        .data
        .and_then(|mut d| d.remove("s").flatten())
        .map(|s| s.edges)
        .unwrap_or_default();
    Ok(edges
        .into_iter()
        .map(|e| preview(e.node.title, q.kind))
        .collect())
}

/// Ejemplos populares de cada subgénero, en un solo pedido (un alias por id). Títulos como los da IMDb (en inglés).
pub async fn examples(
    http: &Http,
    kind: MediaKind,
    ids: &[String],
    timeout: Duration,
) -> Result<HashMap<String, Vec<Example>>> {
    let votes = match kind {
        MediaKind::Movie => 50_000,
        MediaKind::Series => 20_000,
    };
    let ids: Vec<&String> = ids.iter().take(12).collect();
    let parts: Vec<String> = ids
        .iter()
        .enumerate()
        .map(|(i, id)| {
            format!(
                "a{i}: advancedTitleSearch(first: 8, constraints: {{ interestConstraint: {{ allInterestIds: {} }}, titleTypeConstraint: {{ anyTitleTypeIds: {} }}, userRatingsConstraint: {{ ratingsCountRange: {{ min: {votes} }} }} }}, sort: {{ sortBy: POPULARITY, sortOrder: ASC }}) {{ edges {{ node {{ title {{ id titleText {{ text }} primaryImage {{ url }} }} }} }} }}",
                id_list(&[(*id).clone()]),
                types(kind)
            )
        })
        .collect();
    let mut data = query(http, format!("{{ {} }}", parts.join(" ")), "en-US", timeout)
        .await?
        .data
        .unwrap_or_default();
    Ok(ids
        .into_iter()
        .enumerate()
        .map(|(i, id)| {
            let edges = data
                .remove(&format!("a{i}"))
                .flatten()
                .map(|s| s.edges)
                .unwrap_or_default();
            let list = edges
                .into_iter()
                .map(|e| Example {
                    title: e.node.title.title_text.map(|x| x.text).unwrap_or_default(),
                    poster: e
                        .node
                        .title
                        .primary_image
                        .map(|i| small_poster(&i.url, 220)),
                })
                .collect();
            (id.clone(), list)
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_invalidos_no_entran_en_la_consulta() {
        let ids = vec!["in0000114".into(), "in1\"}".into(), "tt0000001".into()];
        assert_eq!(id_list(&ids), r#"["in0000114"]"#);
    }

    #[test]
    fn poster_chico() {
        assert_eq!(
            small_poster("https://m.media-amazon.com/images/M/abc@._V1_.jpg", 342),
            "https://m.media-amazon.com/images/M/abc@._V1_QL75_UX342_.jpg"
        );
    }
}
