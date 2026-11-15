//! IMDb id por título (Wyzie lo exige; OpenSubtitles busca mejor con él).

use serde_json::Value;

use super::http::{get_bytes, http, pct};
use super::normalized_title;
use crate::subtitles::VideoIdentity;

/// Resuelve el IMDb id por título (+año): Cinemeta (spec ADR-16) y, si no aparece (cortos como
/// Sintel no están en su búsqueda), el buscador público de sugerencias de IMDb. Sin keys.
pub async fn resolve_imdb(video: &VideoIdentity) -> Option<String> {
    let title = video.title.as_deref()?;
    let wanted = normalized_title(title);
    let kind = if video.season.is_some() {
        "series"
    } else {
        "movie"
    };
    let year_ok = |y: Option<u16>| match (video.year, y) {
        (Some(a), Some(b)) => a.abs_diff(b) <= 1,
        _ => true,
    };

    let url = format!(
        "https://v3-cinemeta.strem.io/catalog/{kind}/top/search={}.json",
        pct(title)
    );
    if let Ok(bytes) = get_bytes(http().get(&url)).await {
        if let Ok(v) = serde_json::from_slice::<Value>(&bytes) {
            let found = v["metas"].as_array().into_iter().flatten().find(|m| {
                let year = m["releaseInfo"]
                    .as_str()
                    .and_then(|r| r.get(..4))
                    .and_then(|r| r.parse().ok());
                m["name"].as_str().map(normalized_title).as_deref() == Some(wanted.as_str())
                    && year_ok(year)
            });
            if let Some(id) = found.and_then(|m| m["imdb_id"].as_str().or(m["id"].as_str())) {
                return Some(id.to_string());
            }
        }
    }

    let url = format!(
        "https://v3.sg.media-imdb.com/suggestion/x/{}.json",
        pct(&title.to_lowercase())
    );
    let bytes = get_bytes(http().get(&url)).await.ok()?;
    let v: Value = serde_json::from_slice(&bytes).ok()?;
    v["d"]
        .as_array()?
        .iter()
        .find(|m| {
            m["id"].as_str().is_some_and(|id| id.starts_with("tt"))
                && m["l"].as_str().map(normalized_title).as_deref() == Some(wanted.as_str())
                && year_ok(m["y"].as_u64().map(|y| y as u16))
        })
        .and_then(|m| m["id"].as_str())
        .map(String::from)
}
