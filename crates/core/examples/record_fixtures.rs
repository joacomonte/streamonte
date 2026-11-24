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
use streamonte_core::catalog::people::Role;
use streamonte_core::catalog::{cinemeta::BrowseSort, MediaKind};
use streamonte_core::events::{CoreEvent, EventSink};
use streamonte_core::paths::AppPaths;

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
const SERIES_SEASONS: u32 = 5;
const MOVIE_SPANISH: &str = "tt1375666"; // Inception: muchas opciones con audio latino
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
    // Secuencia progresiva: hasta 6 eventos repartidos (primero, último y del medio).
    if events.len() > 6 {
        let last = events.len() - 1;
        events = (0..6).map(|i| events[i * last / 5].clone()).collect();
    }
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
    // Carpetas temporales con SOLO la config real copiada: la lista de torrents de 1 h (`RECENT_TTL`)
    // vive en `data_dir`; con uno vacío siempre se busca de cero y no se toca la caché del usuario.
    let real = AppPaths::resolve().expect("carpetas");
    let tmp = std::env::temp_dir().join(format!("streamonte-record-{}", std::process::id()));
    let paths = AppPaths::under(&tmp);
    paths.ensure_dirs().unwrap();
    std::fs::copy(real.config_file(), paths.config_file()).expect("config real");
    let rec = Arc::new(Recorder::default());
    let core = AppCore::start_with(
        rec.clone(),
        StartOptions {
            capture_clipboard: false,
            paths: Some(paths),
            background_fetch: false,
        },
    )
    .await
    .expect("núcleo");

    let mut firsts = Vec::new(); // primer título en tendencia de cada tipo: lo que abre la grilla
    for (kind, k) in [(MediaKind::Movie, "movie"), (MediaKind::Series, "series")] {
        let page = core.catalog_trending(kind, 0).await;
        if let Ok(p) = &page {
            firsts.extend(p.items.first().map(|i| (kind, k, i.id.clone())));
        }
        save("catalog_trending", &[k, "0"], page);
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
        )
        .await,
    );
    for q in ["fight club", "inception", "breaking bad"] {
        save("catalog_search", &[q], core.catalog_search(q).await);
    }
    // Personas: sugerencias del buscador y lo que dirigió / actuó la primera con ese rol.
    for (q, role, role_name) in [
        ("fight club", None, ""),
        ("david fincher", Some(Role::Director), "director"),
        ("brad pitt", Some(Role::Cast), "cast"),
    ] {
        let people = core.catalog_people(q).await;
        if let (Ok(list), Some(role)) = (&people, role) {
            if let Some(p) = list.iter().find(|p| p.role == role) {
                let id = p.id.to_string();
                save(
                    "catalog_person_titles",
                    &[&id, role_name],
                    core.catalog_person_titles(p.id, role).await,
                );
            }
        }
        save("catalog_people", &[q], people);
    }

    let mut titles = vec![
        (MediaKind::Movie, "movie", MOVIE_PLATFORMS.to_string()),
        (MediaKind::Movie, "movie", MOVIE_NO_PLATFORMS.to_string()),
        (MediaKind::Movie, "movie", MOVIE_SPANISH.to_string()),
        (MediaKind::Series, "series", SERIES.to_string()),
    ];
    titles.extend(firsts.clone());
    titles.dedup_by(|a, b| a.2 == b.2);
    for (kind, k, id) in titles.iter().map(|(a, b, c)| (*a, *b, c.as_str())) {
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
    for quick in ["true", "false"] {
        save(
            "catalog_season_ratings",
            &[SERIES, quick],
            core.catalog_season_ratings(SERIES, quick == "true").await,
        );
    }
    for season in 1..=SERIES_SEASONS {
        save(
            "catalog_episodes",
            &[SERIES, &season.to_string()],
            Ok::<_, ()>(core.catalog_episodes(SERIES, season).await),
        );
    }
    record_streams(&core, &rec, MediaKind::Movie, "movie", MOVIE_PLATFORMS).await;
    record_streams(&core, &rec, MediaKind::Movie, "movie", MOVIE_SPANISH).await;
    // El estreno en tendencia: la primera tarjeta de la grilla abre una ficha completa.
    for (kind, k, id) in firsts.iter().filter(|f| f.1 == "movie") {
        record_streams(&core, &rec, *kind, k, id).await;
    }
    record_streams(
        &core,
        &rec,
        MediaKind::Series,
        "series",
        &format!("{SERIES}:1:1"),
    )
    .await;
    let _ = std::fs::remove_dir_all(&tmp);
}
