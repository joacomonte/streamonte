//! Puntaje de IMDb de cada capítulo de una temporada (2026-11-24: la lista de capítulos lo muestra y el anti spoiler lo
//! difumina en los no vistos). Con la API GraphQL pública de IMDb, como `awards.rs`. La misma regla vive en la web
//! (`web/src/lib/server/episode-ratings.ts`) con el golden `packages/golden/episode_ratings.json`.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::http::Http;
use crate::Result;

const GQL: &str = "https://caching.graphql.imdb.com/";
/// Alcanza para las temporadas más largas (novelas, animé).
const MAX_EPISODES: u32 = 250;

/// Puntaje de un capítulo.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EpisodeScore {
    pub episode: u32,
    pub rating: f64,
}

#[derive(Deserialize)]
struct Gql {
    data: Option<Data>,
}
/// Lo que está dentro de `data` (también es la entrada del golden).
#[derive(Deserialize, Default)]
#[serde(default)]
struct Data {
    title: Option<Title>,
}
#[derive(Deserialize, Default)]
#[serde(default)]
struct Title {
    episodes: Option<Episodes>,
}
#[derive(Deserialize, Default)]
#[serde(default)]
struct Episodes {
    episodes: Option<Edges>,
}
#[derive(Deserialize, Default)]
#[serde(default)]
struct Edges {
    edges: Vec<Edge>,
}
#[derive(Deserialize)]
struct Edge {
    node: Node,
}
#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct Node {
    series: Option<Series>,
    ratings_summary: Option<Ratings>,
}
#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct Series {
    displayable_episode_number: Option<Displayable>,
}
#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct Displayable {
    episode_number: Option<Text>,
    displayable_season: Option<Text>,
}
#[derive(Deserialize)]
struct Text {
    text: String,
}
#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct Ratings {
    aggregate_rating: Option<f64>,
}

fn query_text(imdb_id: &str, season: u32) -> String {
    format!(
        "{{ title(id: \"{imdb_id}\") {{ episodes {{ episodes(first: {MAX_EPISODES}, filter: {{ includeSeasons: [\"{season}\"] }}) {{ edges {{ node {{ series {{ displayableEpisodeNumber {{ episodeNumber {{ text }} displayableSeason {{ text }} }} }} ratingsSummary {{ aggregateRating }} }} }} }} }} }} }}"
    )
}

/// De la respuesta de IMDb a los puntajes: solo los de `season`, con número de capítulo y puntaje > 0, ordenados.
fn normalize(data: Data, season: u32) -> Vec<EpisodeScore> {
    let edges = data
        .title
        .and_then(|t| t.episodes)
        .and_then(|e| e.episodes)
        .unwrap_or_default()
        .edges;
    let mut out: Vec<EpisodeScore> = edges
        .into_iter()
        .filter_map(|Edge { node }| {
            let n = node.series?.displayable_episode_number?;
            let s: u32 = n.displayable_season?.text.trim().parse().ok()?;
            let episode: u32 = n.episode_number?.text.trim().parse().ok()?;
            let rating = node.ratings_summary?.aggregate_rating?;
            (s == season && rating > 0.0).then_some(EpisodeScore { episode, rating })
        })
        .collect();
    out.sort_by_key(|x| x.episode);
    out.dedup_by_key(|x| x.episode);
    out
}

pub async fn fetch(
    http: &Http,
    imdb_id: &str,
    season: u32,
    timeout: Duration,
) -> Result<Vec<EpisodeScore>> {
    let headers = [
        // Sin este header IMDb responde 403.
        ("x-imdb-client-name", "imdb-web-next"),
    ];
    let body = serde_json::json!({ "query": query_text(imdb_id, season) });
    let r: Gql = http
        .post_json(GQL, &headers, &body, timeout)
        .await
        .map_err(|e| super::fetch_error("traer el puntaje de los capítulos de IMDb", &e))?;
    Ok(normalize(r.data.unwrap_or_default(), season))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn golden_episode_ratings() {
        let cases: Vec<serde_json::Value> = serde_json::from_str(include_str!(
            "../../../../packages/golden/episode_ratings.json"
        ))
        .unwrap();
        for case in cases {
            let data: Data = serde_json::from_value(case["in"]["data"].clone()).unwrap();
            let season = case["in"]["season"].as_u64().unwrap() as u32;
            assert_eq!(
                serde_json::json!(normalize(data, season)),
                case["out"],
                "{case}"
            );
        }
    }

    #[test]
    fn consulta_de_la_temporada() {
        let q = query_text("tt0903747", 2);
        assert!(q.contains("title(id: \"tt0903747\")"));
        assert!(q.contains("includeSeasons: [\"2\"]"));
    }
}
