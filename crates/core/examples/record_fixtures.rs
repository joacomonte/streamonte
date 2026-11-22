//! Graba respuestas reales del catálogo en `ui/mock/*.json` (las usa `ui/src/mock-tauri.ts` para ver la
//! UI desktop en el navegador sin Tauri). Usa las keys/config reales del usuario y necesita red.
//! Nombre del archivo: `<comando>__<args-slug>.json`; el slug es el MISMO que calcula `mock-tauri.ts`:
//! valores de los args en el orden de `ui/src/api.js`, unidos con `_`, y todo lo que no sea [a-z0-9_-] → `-`.
//! Solo comandos de catálogo (datos públicos de TMDB/Cinemeta): nunca config, keys ni rutas locales.
//! Además graba los eventos `catalog-streams` de `catalog_streams` (mismo JSON que emite TauriSink en
//! `core://event`) como `events__catalog_streams__<slug>.json`; el mock los reproduce al invocar el comando.
//!
//! `cargo run -p streamonte-core --example record_fixtures`

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use streamonte_core::app::{AppCore, StartOptions};
use streamonte_core::catalog::{cinemeta::BrowseSort, MediaKind};
use streamonte_core::events::{CoreEvent, EventSink};

/// Junta los eventos como JSON (la misma forma serde que `TauriSink` manda a la UI).
#[derive(Default)]
struct Recorder(Mutex<Vec<serde_json::Value>>);
impl EventSink for Recorder {
    fn emit(&self, event: CoreEvent) {
        self.0
            .lock()
            .unwrap()
            .push(serde_json::to_value(&event).unwrap());
    }
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

fn slug_of(args: &[&str]) -> String {
    args.join("_")
        .to_lowercase()
        .chars()
        .fold(String::new(), |mut s, c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                s.push(c)
            } else if !s.ends_with('-') {
                s.push('-')
            }
            s
        })
}

/// Pide streams de `video_id` y graba los `catalog-streams` hasta `done` (tope 60 s).
/// Si pesa de más, recorta `candidates` y `trackers` (la UI solo necesita una lista creíble).
async fn record_streams(core: &AppCore, rec: &Recorder, kind: MediaKind, k: &str, video_id: &str) {
    rec.0.lock().unwrap().clear();
    if let Err(e) = core.catalog_streams(kind, video_id).await {
        println!("FAIL catalog_streams {video_id}: {e:?}");
        return;
    }
    for _ in 0..120 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        let done = rec
            .0
            .lock()
            .unwrap()
            .last()
            .is_some_and(|e| e["type"] == "catalog-streams" && e["update"]["done"] == true);
        if done {
            break;
        }
    }
    tokio::time::sleep(Duration::from_secs(1)).await;
    let mut events: Vec<serde_json::Value> = rec
        .0
        .lock()
        .unwrap()
        .iter()
        .filter(|e| e["type"] == "catalog-streams" && e["update"]["video_id"] == video_id)
        .cloned()
        .collect();
    if serde_json::to_string_pretty(&events).unwrap().len() > 250_000 {
        for e in &mut events {
            if let Some(c) = e["update"]["candidates"].as_array_mut() {
                c.truncate(25);
                for t in c.iter_mut().filter_map(|c| c["trackers"].as_array_mut()) {
                    t.truncate(5);
                }
            }
        }
    }
    let name = format!("events__catalog_streams__{}.json", slug_of(&[k, video_id]));
    std::fs::write(
        format!("{OUT}/{name}"),
        serde_json::to_string_pretty(&events).unwrap(),
    )
    .unwrap();
    println!("ok   {name} ({} eventos)", events.len());
}

#[tokio::main]
async fn main() {
    std::fs::create_dir_all(OUT).unwrap();
    let rec = Arc::new(Recorder::default());
    let core = AppCore::start_with(
        rec.clone(),
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
    record_streams(&core, &rec, MediaKind::Movie, "movie", MOVIE_PLATFORMS).await;
    record_streams(
        &core,
        &rec,
        MediaKind::Series,
        "series",
        &format!("{SERIES}:1:1"),
    )
    .await;
}
