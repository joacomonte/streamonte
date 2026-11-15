//! Analizar magnets desde la línea de comandos (F2, sin UI): scrape en lote (FR-05) → medición en
//! vivo con velocidad y duración real (FR-06) → semáforo y orden por defecto (FR-07).
//!
//! ```text
//! cargo run -p tstream-core --example analyze -- "<magnet>" ["<magnet>" ...] [--engine webtorrent|rqbit] [--pause-at 1]
//! ```
//! Usa una biblioteca TEMPORAL (no toca tu `library.json`) y la config real (ruta de mpv, trackers).
//! `--pause-at N`: pausa después del N-ésimo medido, espera 5 s y reanuda (demostración de FR-08).
//! Correr en la sesión real del usuario (lección 7). Solo contenido legal en pruebas.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tstream_core::analyzer::{AnalyzeScope, AnalyzerDeps, AnalyzerHandle, AnalyzerState};
use tstream_core::config::{ConfigStore, EngineKind};
use tstream_core::events::{CoreEvent, EventSink};
use tstream_core::library::{EntryStatus, Group, Library};
use tstream_core::magnet;
use tstream_core::paths::AppPaths;

#[derive(Default)]
struct State {
    analyzer: Option<AnalyzerState>,
    measured: usize,
}

struct ConsoleSink {
    t0: Instant,
    state: Arc<Mutex<State>>,
}

impl EventSink for ConsoleSink {
    fn emit(&self, event: CoreEvent) {
        let t = self.t0.elapsed().as_secs_f32();
        let mut s = self.state.lock().unwrap();
        match event {
            CoreEvent::AnalyzerProgress { state } => {
                println!("[{t:6.1} s] analizador: {state:?}");
                s.analyzer = Some(state);
            }
            CoreEvent::LibraryEntryUpdated { entry } => {
                if entry.status == EntryStatus::Measured {
                    s.measured += 1;
                }
                println!("[{t:6.1} s] {} → {:?}", entry.name, entry.status);
            }
            CoreEvent::Status { message, .. } => println!("[{t:6.1} s] estado: {message}"),
            _ => {}
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let text = args.join("\n");
    let magnets = magnet::extract_all_with_raw(&text);
    if magnets.is_empty() {
        eprintln!("uso: analyze \"<magnet>\" [\"<magnet>\" ...] [--engine webtorrent|rqbit] [--pause-at N]");
        std::process::exit(2);
    }
    let arg_after = |flag: &str| {
        args.iter()
            .position(|a| a == flag)
            .and_then(|i| args.get(i + 1).cloned())
    };

    // Config real (mpv, trackers, motor) pero datos en una carpeta temporal.
    let real = AppPaths::resolve()?;
    let mut config = ConfigStore::new(&real).load()?;
    match arg_after("--engine").as_deref() {
        Some("rqbit") => config.engine.kind = EngineKind::Rqbit,
        Some("webtorrent") => config.engine.kind = EngineKind::Webtorrent,
        _ => {}
    }
    let root = std::env::temp_dir().join(format!("tstream-analyze-{}", std::process::id()));
    let paths = AppPaths::under(&root);
    paths.ensure_dirs()?;
    println!(
        "motor: {:?} · ventana de medición: {} s · carpeta temporal: {}",
        config.engine.kind,
        config.analyzer.measure_secs,
        root.display()
    );

    let mut library = Library::load(paths.library_file())?;
    library.set_ranking(config.ranking.clone());
    for (m, raw) in &magnets {
        library.add_or_touch(m, raw);
    }
    let library = Arc::new(tokio::sync::Mutex::new(library));
    let state = Arc::new(Mutex::new(State::default()));
    let t0 = Instant::now();
    let analyzer = AnalyzerHandle::spawn(AnalyzerDeps {
        paths: paths.clone(),
        config: Arc::new(tokio::sync::RwLock::new(config.clone())),
        library: library.clone(),
        events: Arc::new(ConsoleSink {
            t0,
            state: state.clone(),
        }),
    });
    analyzer.enqueue(AnalyzeScope::All).await?;

    let pause_at: Option<usize> = arg_after("--pause-at").and_then(|n| n.parse().ok());
    let mut paused_once = false;
    loop {
        tokio::time::sleep(Duration::from_millis(200)).await;
        let (idle, measured) = {
            let s = state.lock().unwrap();
            (matches!(s.analyzer, Some(AnalyzerState::Idle)), s.measured)
        };
        if let Some(n) = pause_at.filter(|n| !paused_once && measured >= *n) {
            paused_once = true;
            println!("--- pausa tras {n} medido(s) (FR-08); reanudo en 5 s ---");
            analyzer.pause().await?;
            tokio::time::sleep(Duration::from_secs(5)).await;
            analyzer.resume().await?;
            continue;
        }
        let busy = {
            let lib = library.lock().await;
            lib.hashes().iter().any(|h| {
                matches!(
                    lib.get(h).map(|e| &e.status),
                    Some(EntryStatus::New | EntryStatus::Scraping | EntryStatus::Measuring)
                )
            })
        };
        if idle && !busy && t0.elapsed() > Duration::from_secs(1) {
            break;
        }
    }

    println!(
        "\n=== Resultado ({:.0} s), orden por defecto (FR-07) ===",
        t0.elapsed().as_secs_f32()
    );
    println!(
        "{:<28} {:>5} {:>5} {:>6} {:>10} {:>9} {:>9} {:>7}  semáforo",
        "nombre", "seed", "leech", "peers", "duración", "vel MB/s", "nec MB/s", "margen"
    );
    let lib = library.lock().await;
    for e in lib.list(Group::PastedNow) {
        let score = e.score.expect("puntaje");
        let duration = score.duration.map_or("?".into(), |d| {
            let secs = d.secs.round() as u64;
            format!(
                "{}{}:{:02}:{:02}",
                if d.estimated { "~" } else { "" },
                secs / 3600,
                secs / 60 % 60,
                secs % 60
            )
        });
        let mbps = |v: Option<f64>| v.map_or("-".into(), |v| format!("{:.2}", v / 1e6));
        println!(
            "{:<28} {:>5} {:>5} {:>6} {:>10} {:>9} {:>9} {:>7}  {:?}{}",
            e.name.chars().take(28).collect::<String>(),
            e.scrape
                .as_ref()
                .map_or("-".into(), |s| s.seeders.to_string()),
            e.scrape
                .as_ref()
                .map_or("-".into(), |s| s.leechers.to_string()),
            e.live.as_ref().map_or("-".into(), |l| l.peers.to_string()),
            duration,
            mbps(e.live.as_ref().map(|l| l.avg_speed_bps)),
            mbps(score.needed_bps),
            score.margin.map_or("-".into(), |m| format!("{m:.2}")),
            score.light,
            match &e.status {
                EntryStatus::Failed { reason } => format!(" (falló: {reason})"),
                _ => String::new(),
            }
        );
    }
    let leftovers = std::fs::read_dir(paths.downloads_dir())?.count();
    println!("\ncarpetas de medición que quedaron: {leftovers} (esperado 0, FR-06)");
    drop(lib);
    let _ = std::fs::remove_dir_all(&root);
    Ok(())
}
