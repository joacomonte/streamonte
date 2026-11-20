//! Benchmark de motores (spec 06-D): webtorrent (sidecar) vs rqbit (embebido).
//!
//! ```text
//! cargo run -p streamonte-core --release --example bench -- \
//!     --case "Sintel=magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10" \
//!     [--case "Nombre=<magnet>" ...] [--runs 3] [--watch-secs 300] [--engines webtorrent,rqbit]
//! ```
//! Justicia (06-D): mismos trackers y conexiones (de la config) · motores alternados A/B, nunca en
//! paralelo · `.torrent` en caché borrado antes de cada corrida (mide metadatos de verdad).
//! Por corrida: metadatos · precarga · primera imagen · cortes por buffer durante `watch-secs` ·
//! tiempo de salto al 25/50/90 % · velocidad prom./máx. · peers máx. · cierre + borrado.
//! Escribe `benchmarks/bench-<fecha>.md`. Correr en la sesión real (lección 7), contenido legal.
//! Pendiente (no medido acá): CPU/RAM y disco escrito real (tamaño asignado de archivos sparse).

use std::fmt::Write as _;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde_json::json;
use streamonte_core::cleanup::Cleanup;
use streamonte_core::config::{ConfigStore, EngineKind, PlayerKind};
use streamonte_core::engine::{self, AddOptions, FileInfo, RemoveOptions, TorrentSource};
use streamonte_core::magnet::Magnet;
use streamonte_core::paths::AppPaths;
use streamonte_core::player::{LaunchRequest, MpvEvent, PlayerLauncher};
use streamonte_core::preload;
use tokio_util::sync::CancellationToken;

const SEEKS: [f64; 3] = [25.0, 50.0, 90.0];

#[derive(Default, Clone)]
struct RunResult {
    case: String,
    engine: String,
    run: u32,
    metadata_s: Option<f32>,
    preload_s: Option<f32>,
    first_frame_s: Option<f32>,
    stalls: u32,
    stall_total_s: f32,
    seek_s: Vec<Option<f32>>,
    avg_mbps: f32,
    max_mbps: f32,
    max_peers: u32,
    cleanup_s: Option<f32>,
    dir_removed: bool,
    error: Option<String>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let value = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
    let runs: u32 = value("--runs").and_then(|v| v.parse().ok()).unwrap_or(3);
    let watch = Duration::from_secs(
        value("--watch-secs")
            .and_then(|v| v.parse().ok())
            .unwrap_or(300),
    );
    let engines: Vec<EngineKind> = value("--engines")
        .unwrap_or_else(|| "webtorrent,rqbit".into())
        .split(',')
        .map(|e| {
            if e.trim() == "rqbit" {
                EngineKind::Rqbit
            } else {
                EngineKind::Webtorrent
            }
        })
        .collect();
    let cases: Vec<(String, Magnet)> = args
        .iter()
        .enumerate()
        .filter(|(_, a)| *a == "--case")
        .filter_map(|(i, _)| args.get(i + 1))
        .map(|c| {
            let (name, uri) = c.split_once('=').expect("--case \"Nombre=magnet:...\"");
            (
                name.to_string(),
                Magnet::parse(uri).expect("magnet inválido"),
            )
        })
        .collect();
    if cases.is_empty() {
        eprintln!("uso: bench --case \"Nombre=<magnet>\" [--case ...] [--runs 3] [--watch-secs 300] [--engines webtorrent,rqbit]");
        std::process::exit(2);
    }

    // Opcional: arrancar desde un `.torrent` (swarms sin peers para metadatos, p. ej. Internet
    // Archive, que sirve el contenido por web seeds). Aplica a todos los casos.
    let torrent_file = value("--torrent-file").map(PathBuf::from);

    let paths = AppPaths::resolve()?;
    let config = ConfigStore::new(&paths).load()?;
    let mut results = Vec::new();

    for (case_name, magnet) in &cases {
        for run in 1..=runs {
            // Alternar quién va primero en cada corrida (A/B, B/A, ...).
            let mut order = engines.clone();
            if run % 2 == 0 {
                order.reverse();
            }
            for kind in order {
                println!("\n=== {case_name} · {kind:?} · corrida {run}/{runs} ===");
                let r = run_once(
                    &paths,
                    &config,
                    case_name,
                    magnet,
                    torrent_file.as_ref(),
                    kind,
                    run,
                    watch,
                )
                .await;
                if let Some(e) = &r.error {
                    println!("  ERROR: {e}");
                }
                results.push(r);
                tokio::time::sleep(Duration::from_secs(3)).await;
            }
        }
    }

    let report = render(&results, watch);
    println!("\n{report}");
    let dir = PathBuf::from("benchmarks");
    std::fs::create_dir_all(&dir)?;
    let file = dir.join(format!(
        "bench-{}.md",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    ));
    std::fs::write(&file, &report)?;
    println!("Informe: {}", file.display());
    Ok(())
}

// Herramienta de medición: los parámetros son la configuración de una corrida, no vale la pena un struct.
#[allow(clippy::too_many_arguments)]
async fn run_once(
    paths: &AppPaths,
    base: &streamonte_core::config::Config,
    case: &str,
    magnet: &Magnet,
    torrent_file: Option<&PathBuf>,
    kind: EngineKind,
    run: u32,
    watch: Duration,
) -> RunResult {
    let mut r = RunResult {
        case: case.into(),
        engine: format!("{kind:?}"),
        run,
        seek_s: vec![None; SEEKS.len()],
        ..Default::default()
    };
    let mut cfg = base.clone();
    cfg.engine.kind = kind;
    // El benchmark corre en release: apuntar al sidecar del repo (en debug lo encuentra solo).
    if cfg.engine.webtorrent_sidecar.is_none() {
        cfg.engine.webtorrent_sidecar = Some(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../engines/webtorrent-sidecar/src/main.mjs"),
        );
    }
    let hash = magnet.info_hash.to_hex();
    let _ = std::fs::remove_file(paths.torrent_cache_file(&magnet.info_hash));
    let dir = paths
        .downloads_dir()
        .join(format!("bench-{hash}-{kind:?}-{run}"));
    let _ = std::fs::remove_dir_all(&dir);
    let cleanup = Cleanup::new(paths.clone());

    let t0 = Instant::now();
    let secs = |t: Instant| t.elapsed().as_secs_f32();
    let engine = match engine::create(&cfg.engine, paths).await {
        Ok(e) => e,
        Err(e) => {
            r.error = Some(e.to_string());
            return r;
        }
    };

    let outcome: Result<(), String> = async {
        let handle = engine
            .add(
                match torrent_file {
                    Some(path) => TorrentSource::TorrentFile(path.clone()),
                    None => TorrentSource::Magnet(magnet.with_trackers(&cfg.trackers)),
                },
                AddOptions { trackers: cfg.all_trackers(), download_dir: dir.clone(), initial_peers: Vec::new(), download_bps: None },
            )
            .await
            .map_err(|e| e.to_string())?;
        let meta = tokio::time::timeout(Duration::from_secs(120), engine.metadata(handle))
            .await
            .map_err(|_| "timeout de metadatos (120 s)".to_string())?
            .map_err(|e| e.to_string())?;
        r.metadata_s = Some(secs(t0));
        println!("  metadatos {:.1} s", secs(t0));

        let file = largest_video(&meta.files).ok_or("sin archivos")?;
        let plan = preload::plan(&file, &cfg.preload, None);
        preload::run(engine.as_ref(), handle, &plan, &cfg.preload, CancellationToken::new(), true, &|_| {})
            .await
            .map_err(|e| e.to_string())?;
        r.preload_s = Some(secs(t0));
        println!("  precarga {:.1} s", secs(t0));

        let url = engine.stream_url(handle, file.index).await.map_err(|e| e.to_string())?;
        let launcher = PlayerLauncher::new(paths.clone(), cfg.player.clone());
        let mut player = launcher
            .launch(LaunchRequest {
                kind: PlayerKind::Mpv,
                url,
                title: format!("bench {case} {kind:?} #{run}"),
                subtitle_files: Vec::new(),
                log_file: None,
                extra_args: vec!["--mute=yes".into()],
            })
            .await
            .map_err(|e| e.to_string())?;
        let mpv = player.mpv.clone().ok_or("mpv sin IPC")?;
        let mut events = mpv.events();
        let _ = mpv.command(&[json!("observe_property"), json!(1), json!("paused-for-cache")]).await;

        // Primera imagen.
        let first = tokio::time::timeout(Duration::from_secs(180), async {
            loop {
                match events.recv().await {
                    Ok(MpvEvent::FirstFrame) => return true,
                    Ok(MpvEvent::Shutdown) | Err(_) => return false,
                    _ => {}
                }
            }
        })
        .await;
        if first != Ok(true) {
            let _ = player.kill().await;
            return Err("sin primera imagen en 180 s".into());
        }
        r.first_frame_s = Some(secs(t0));
        println!("  primera imagen {:.1} s · mirando {} s…", secs(t0), watch.as_secs());

        // Ventana de reproducción continua: cortes por buffer + velocidad.
        let end = Instant::now() + watch;
        let mut stall_started: Option<Instant> = None;
        let mut speed_sum = 0.0_f32;
        let mut samples = 0u32;
        let mut tick = tokio::time::interval(Duration::from_secs(1));
        while Instant::now() < end {
            tokio::select! {
                ev = events.recv() => match ev {
                    Ok(MpvEvent::PropertyChanged { name, value }) if name == "paused-for-cache" => {
                        if value.as_bool() == Some(true) && stall_started.is_none() {
                            stall_started = Some(Instant::now());
                            r.stalls += 1;
                        } else if value.as_bool() == Some(false) {
                            if let Some(s) = stall_started.take() { r.stall_total_s += s.elapsed().as_secs_f32(); }
                        }
                    }
                    Ok(MpvEvent::Shutdown) | Err(tokio::sync::broadcast::error::RecvError::Closed) => return Err("mpv se cerró durante la prueba".into()),
                    _ => {}
                },
                _ = tick.tick() => {
                    if let Ok(s) = engine.stats(handle).await {
                        let mbps = (s.download_speed_bps * 8.0 / 1e6) as f32;
                        speed_sum += mbps;
                        samples += 1;
                        r.max_mbps = r.max_mbps.max(mbps);
                        r.max_peers = r.max_peers.max(s.peers);
                    }
                }
            }
        }
        if let Some(s) = stall_started.take() {
            r.stall_total_s += s.elapsed().as_secs_f32();
        }
        r.avg_mbps = if samples > 0 { speed_sum / samples as f32 } else { 0.0 };

        // Saltos 25/50/90 %: tiempo hasta que la reproducción re-arranca.
        for (i, pct) in SEEKS.iter().enumerate() {
            let t = Instant::now();
            let _ = mpv.command(&[json!("seek"), json!(pct), json!("absolute-percent")]).await;
            let ok = tokio::time::timeout(Duration::from_secs(120), async {
                loop {
                    match events.recv().await {
                        Ok(MpvEvent::PlaybackRestart) => return true,
                        Ok(MpvEvent::Shutdown) | Err(tokio::sync::broadcast::error::RecvError::Closed) => return false,
                        _ => {}
                    }
                }
            })
            .await;
            r.seek_s[i] = (ok == Ok(true)).then(|| t.elapsed().as_secs_f32());
            println!("  salto {pct}%: {}", r.seek_s[i].map_or("timeout".into(), |s| format!("{s:.1} s")));
            tokio::time::sleep(Duration::from_secs(8)).await;
        }

        let _ = mpv.command(&[json!("quit")]).await;
        let _ = tokio::time::timeout(Duration::from_secs(10), player.wait_exit(|| true)).await;

        // Cierre y borrado (FR-12, T-04).
        let t = Instant::now();
        let _ = engine.remove(handle, RemoveOptions { delete_data: true }).await;
        let _ = engine.shutdown().await;
        let _ = cleanup.remove_dir(&dir).await;
        r.cleanup_s = Some(t.elapsed().as_secs_f32());
        Ok(())
    }
    .await;

    if let Err(e) = outcome {
        r.error = Some(e);
        let _ = engine.shutdown().await;
        let _ = cleanup.remove_dir(&dir).await;
    }
    r.dir_removed = !dir.exists();
    r
}

fn largest_video(files: &[FileInfo]) -> Option<FileInfo> {
    files
        .iter()
        .filter(|f| engine::is_video(&f.name))
        .max_by_key(|f| f.size)
        .or_else(|| files.iter().max_by_key(|f| f.size))
        .cloned()
}

fn render(results: &[RunResult], watch: Duration) -> String {
    let f = |v: Option<f32>| v.map_or("—".into(), |x| format!("{x:.1}"));
    let mut out = String::new();
    let _ = writeln!(
        out,
        "# Benchmark de motores — {}\n",
        chrono::Local::now().format("%Y-%m-%d %H:%M")
    );
    let _ = writeln!(
        out,
        "Ventana de reproducción continua: {} s. Tiempos en segundos desde agregar el magnet.\n",
        watch.as_secs()
    );
    let _ = writeln!(
        out,
        "| Caso | Motor | # | Metadatos | Precarga | 1ª imagen | Cortes | Corte total | Salto 25/50/90 % | Mbps prom/máx | Peers máx | Cierre | Carpeta borrada | Error |"
    );
    let _ = writeln!(
        out,
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"
    );
    for r in results {
        let seeks: Vec<String> = r.seek_s.iter().map(|s| f(*s)).collect();
        let _ = writeln!(
            out,
            "| {} | {} | {} | {} | {} | {} | {} | {:.1} | {} | {:.1}/{:.1} | {} | {} | {} | {} |",
            r.case,
            r.engine,
            r.run,
            f(r.metadata_s),
            f(r.preload_s),
            f(r.first_frame_s),
            r.stalls,
            r.stall_total_s,
            seeks.join("/"),
            r.avg_mbps,
            r.max_mbps,
            r.max_peers,
            f(r.cleanup_s),
            if r.dir_removed { "sí" } else { "NO" },
            r.error.as_deref().unwrap_or("")
        );
    }

    // Medianas por caso y motor (criterio 06-D: menor 1ª imagen y menos cortes).
    let _ = writeln!(out, "\n## Medianas\n\n| Caso | Motor | Metadatos | 1ª imagen | Cortes | Fallas |\n|---|---|---|---|---|---|");
    let mut keys: Vec<(String, String)> = results
        .iter()
        .map(|r| (r.case.clone(), r.engine.clone()))
        .collect();
    keys.dedup();
    keys.sort();
    keys.dedup();
    for (case, engine) in keys {
        let rs: Vec<&RunResult> = results
            .iter()
            .filter(|r| r.case == case && r.engine == engine)
            .collect();
        let med = |mut v: Vec<f32>| {
            v.sort_by(|a, b| a.total_cmp(b));
            v.get(v.len() / 2).copied()
        };
        let ok: Vec<&&RunResult> = rs.iter().filter(|r| r.error.is_none()).collect();
        let _ = writeln!(
            out,
            "| {case} | {engine} | {} | {} | {} | {}/{} |",
            f(med(ok.iter().filter_map(|r| r.metadata_s).collect())),
            f(med(ok.iter().filter_map(|r| r.first_frame_s).collect())),
            med(ok.iter().map(|r| r.stalls as f32).collect())
                .map_or("—".into(), |x| format!("{x:.0}")),
            rs.len() - ok.len(),
            rs.len()
        );
    }
    out
}
