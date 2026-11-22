//! Graba respuestas reales del catálogo en `ui/mock/*.json` (las usa `ui/src/mock-tauri.ts` para ver la
//! UI desktop en el navegador sin Tauri). Usa las keys/config reales del usuario y necesita red.
//! Nombre del archivo: `<comando>__<args-slug>.json`; el slug es el MISMO que calcula `mock-tauri.ts`:
//! valores de los args en el orden de `ui/src/api.js`, unidos con `_`, y todo lo que no sea [a-z0-9_-] → `-`.
//! Solo comandos de catálogo (datos públicos de TMDB/Cinemeta): nunca config, keys ni rutas locales.
//!
//! `cargo run -p streamonte-core --example record_fixtures`

use std::sync::Arc;

use serde::Serialize;
use streamonte_core::app::{AppCore, StartOptions};
use streamonte_core::catalog::{cinemeta::BrowseSort, MediaKind};
use streamonte_core::events::{CoreEvent, EventSink};

struct Quiet;
impl EventSink for Quiet {
    fn emit(&self, _: CoreEvent) {}
}

const MOVIE_PLATFORMS: &str = "tt0137523"; // Fight Club
const MOVIE_NO_PLATFORMS: &str = "tt45368240"; // TMDB 1765072, "You Can See Everything"
const SERIES: &str = "tt0903747"; // Breaking Bad
const OUT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../ui/mock");

fn save<T: Serialize, E: std::fmt::Debug>(cmd: &str, args: &[&str], res: Result<T, E>) {
    let slug: String = args
        .join("_")
        .to_lowercase()
        .chars()
        .fold(String::new(), |mut s, c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                s.push(c)
            } else if !s.ends_with('-') {
                s.push('-')
            }
            s
        });
    let name = format!("{cmd}__{slug}.json");
    match res {
        Ok(v) => {
            std::fs::write(
                format!("{OUT}/{name}"),
                serde_json::to_string_pretty(&v).unwrap(),
            )
            .unwrap();
            println!("ok   {name}");
        }
        Err(e) => println!("FAIL {name}: {e:?}"),
    }
}

#[tokio::main]
async fn main() {
    std::fs::create_dir_all(OUT).unwrap();
    let core = AppCore::start_with(
        Arc::new(Quiet),
        StartOptions {
            capture_clipboard: false,
            paths: None,
            background_fetch: false,
        },
    )
    .await
    .expect("núcleo");

    for (kind, k) in [(MediaKind::Movie, "movie"), (MediaKind::Series, "series")] {
        save(
            "catalog_trending",
            &[k, "0"],
            core.catalog_trending(kind, 0).await,
        );
        save("catalog_genres", &[k], core.catalog_genres(kind).await);
    }
    // Defaults de la UI (`DEFAULTS` en ui/src/catalog.js): 12 meses atrás, 10000 votos, en/es, sin género.
    let from = (chrono::Utc::now() - chrono::Months::new(12))
        .format("%Y-%m-%d")
        .to_string();
    save(
        "catalog_browse_top",
        &["movie", "rating"],
        core.catalog_browse_top(
            MediaKind::Movie,
            BrowseSort::Rating,
            &from,
            None,
            10000,
            vec!["en".into(), "es".into()],
            vec![],
        )
        .await,
    );
    save(
        "catalog_search",
        &["fight club"],
        core.catalog_search("fight club").await,
    );

    for (kind, k, id) in [
        (MediaKind::Movie, "movie", MOVIE_PLATFORMS),
        (MediaKind::Movie, "movie", MOVIE_NO_PLATFORMS),
        (MediaKind::Series, "series", SERIES),
    ] {
        save("catalog_meta", &[k, id], core.catalog_meta(kind, id).await);
        save(
            "catalog_details",
            &[k, id],
            Ok::<_, ()>(core.catalog_details(kind, id).await),
        );
        save(
            "catalog_similar",
            &[k, id],
            Ok::<_, ()>(core.catalog_similar(kind, id).await),
        );
    }
    save(
        "catalog_season_ratings",
        &[SERIES, "true"],
        core.catalog_season_ratings(SERIES, true).await,
    );
    save(
        "catalog_episodes",
        &[SERIES, "1"],
        Ok::<_, ()>(core.catalog_episodes(SERIES, 1).await),
    );
}
