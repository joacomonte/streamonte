//! Premios de un título con la API GraphQL pública de IMDb (la de su sitio; la misma que usa `interests.rs`): totales de
//! premios y nominaciones, y el detalle de los grandes (Óscar, Globos de Oro, BAFTA, Emmy, SAG, Goya y los premios
//! principales de Cannes, Venecia y Berlín). Uso personal (la app es privada). La misma regla vive en la web
//! (`web/src/lib/server/awards.ts`) con el golden `packages/golden/awards.json`; la UI agrupa y traduce
//! (`packages/ui/src/title/awards.ts`).

use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::http::Http;
use crate::Result;

const GQL: &str = "https://caching.graphql.imdb.com/";

/// Eventos que se detallan: id de IMDb → clave corta que entiende la UI.
const EVENTS: [(&str, &str); 9] = [
    ("ev0000003", "oscar"),
    ("ev0000292", "globe"),
    ("ev0000123", "bafta"),
    ("ev0000223", "emmy"),
    ("ev0000598", "sag"),
    ("ev0000299", "goya"),
    ("ev0000147", "cannes"),
    ("ev0000681", "venice"),
    ("ev0000091", "berlin"),
];
/// De los festivales solo los premios principales (el resto son jurados paralelos, prensa, etc.).
const FESTIVAL_PRIZES: [&str; 11] = [
    "Palme d'Or",
    "Grand Prize",
    "Jury Prize",
    "Best Director",
    "Best Actor",
    "Best Actress",
    "Best Screenplay",
    "Golden Lion",
    "Silver Lion",
    "Volpi Cup",
    "Berlin Bear",
];
/// Alcanza para todo lo de los eventos grandes aun en series largas (Breaking Bad: ~90).
const MAX_ENTRIES: u32 = 150;

/// Premios de un título. `nominations`: las que no ganó (como dice IMDb, "45 wins & 148 nominations").
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TitleAwards {
    pub wins: u32,
    pub nominations: u32,
    pub entries: Vec<AwardEntry>,
}

/// Un premio o nominación de un evento grande, con los textos como los da IMDb (en inglés).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AwardEntry {
    /// Clave de `EVENTS` (`oscar`, `globe`…).
    pub event: String,
    pub won: bool,
    /// `Oscar`, `Palme d'Or`, `Silver Berlin Bear`…
    pub award: String,
    pub category: Option<String>,
    pub year: Option<u32>,
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
    all: Option<Total>,
    won: Option<Total>,
    top: Option<Edges>,
}
#[derive(Deserialize, Default)]
#[serde(default)]
struct Total {
    total: u32,
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
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Node {
    #[serde(default)]
    is_winner: bool,
    award: Option<Award>,
    category: Option<Text>,
}
#[derive(Deserialize)]
struct Award {
    text: Option<String>,
    year: Option<u32>,
    event: Option<Event>,
}
#[derive(Deserialize)]
struct Event {
    id: String,
}
#[derive(Deserialize)]
struct Text {
    text: String,
}

/// La consulta: totales (todos y ganados) y los de los eventos grandes, los más importantes primero.
fn query_text(imdb_id: &str) -> String {
    let events: Vec<String> = EVENTS.iter().map(|(id, _)| format!("\"{id}\"")).collect();
    format!(
        "{{ title(id: \"{imdb_id}\") {{ all: awardNominations(first: 0) {{ total }} won: awardNominations(first: 0, filter: {{ wins: WINS_ONLY }}) {{ total }} top: awardNominations(first: {MAX_ENTRIES}, filter: {{ events: [{}] }}, sort: {{ by: PRESTIGIOUS, order: DESC }}) {{ edges {{ node {{ isWinner award {{ text year event {{ id }} }} category {{ text }} }} }} }} }} }}",
        events.join(",")
    )
}

/// De la respuesta de IMDb (`data`) a [`TitleAwards`]: solo eventos conocidos y, de los festivales, los premios
/// principales; textos recortados (vacío = sin categoría).
fn normalize(data: Data) -> TitleAwards {
    let Some(t) = data.title else {
        return TitleAwards::default();
    };
    let all = t.all.map_or(0, |x| x.total);
    let wins = t.won.map_or(0, |x| x.total);
    let entries = t
        .top
        .unwrap_or_default()
        .edges
        .into_iter()
        .filter_map(|Edge { node }| {
            let award = node.award?;
            let event_id = award.event?.id;
            let event = EVENTS.iter().find(|(id, _)| *id == event_id)?.1;
            let name = award.text.as_deref().unwrap_or("").trim().to_string();
            let festival = matches!(event, "cannes" | "venice" | "berlin");
            if name.is_empty() || (festival && !FESTIVAL_PRIZES.iter().any(|p| name.contains(p))) {
                return None;
            }
            Some(AwardEntry {
                event: event.to_string(),
                won: node.is_winner,
                award: name,
                category: node
                    .category
                    .map(|c| c.text.trim().to_string())
                    .filter(|c| !c.is_empty()),
                year: award.year,
            })
        })
        .collect();
    TitleAwards {
        wins,
        nominations: all.saturating_sub(wins),
        entries,
    }
}

/// Premios de `imdb_id` (ya validado por quien llama).
pub async fn fetch(http: &Http, imdb_id: &str, timeout: Duration) -> Result<TitleAwards> {
    let headers = [
        // Sin este header IMDb responde 403.
        ("x-imdb-client-name", "imdb-web-next"),
    ];
    let body = serde_json::json!({ "query": query_text(imdb_id) });
    let r: Gql = http
        .post_json(GQL, &headers, &body, timeout)
        .await
        .map_err(|e| super::fetch_error("traer los premios de IMDb", &e))?;
    Ok(normalize(r.data.unwrap_or_default()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn golden_awards() {
        let cases: Vec<serde_json::Value> =
            serde_json::from_str(include_str!("../../../../packages/golden/awards.json")).unwrap();
        for case in cases {
            let data: Data = serde_json::from_value(case["in"].clone()).unwrap();
            assert_eq!(serde_json::json!(normalize(data)), case["out"], "{case}");
        }
    }

    /// Contra IMDb real: Interstellar ganó el Óscar a efectos visuales.
    #[tokio::test]
    #[ignore = "network"]
    async fn network_interstellar() {
        let http = Http::new(Duration::from_secs(10));
        let a = fetch(&http, "tt0816692", Duration::from_secs(20))
            .await
            .unwrap();
        assert!(a.wins > 10 && a.nominations > 10, "{a:?}");
        assert!(a.entries.iter().any(|e| e.event == "oscar"
            && e.won
            && e.category
                .as_deref()
                .is_some_and(|c| c.contains("Visual Effects"))));
    }

    #[test]
    fn consulta_con_los_eventos() {
        let q = query_text("tt0816692");
        assert!(q.contains("title(id: \"tt0816692\")"));
        assert!(q.contains("\"ev0000003\",\"ev0000292\""));
        assert!(q.contains("wins: WINS_ONLY"));
    }
}
