//! Experimento salud-fiel/01: ¿cuántos peers ENTRANTES llegan en N s si el motor del análisis
//! escucha y se anuncia con el puerto real, vs. el análisis actual (sin escucha)?
//! `cargo run -p streamonte-core --release --example announce_probe -- [--secs 60] [--order ab|ba] <magnet>...`
//! Con la app CERRADA. Hasta 10 magnets (= swarm::CONCURRENCY). Usa la config, la caché de
//! .torrent/peers y el dht.json reales; sus carpetas de descarga las borra al terminar.

use std::sync::Arc;
use std::time::{Duration, Instant};

use streamonte_core::config::{Config, ConfigStore};
use streamonte_core::engine::{self, AddOptions, RemoveOptions, TorrentEngine};
use streamonte_core::magnet::{self, Magnet};
use streamonte_core::paths::AppPaths;

#[derive(Default, Clone, Copy)]
struct Probe {
    meta_secs: Option<f32>,
    peers: u32,
    seeds: u32,
    incoming: u32,
    first_in: Option<u64>,
}

fn median(mut v: Vec<f64>) -> Option<f64> {
    v.sort_by(|a, b| a.total_cmp(b));
    v.get(v.len() / 2).copied()
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let arg_after = |flag: &str| {
        args.iter()
            .position(|a| a == flag)
            .and_then(|i| args.get(i + 1).cloned())
    };
    let secs: u64 = arg_after("--secs")
        .and_then(|n| n.parse().ok())
        .unwrap_or(60);
    let order = arg_after("--order").unwrap_or_else(|| "ab".into());
    let magnets: Vec<Magnet> = magnet::extract_all(&args.join("\n"));
    assert!(
        !magnets.is_empty() && magnets.len() <= 10,
        "uso: 1 a 10 magnets"
    );
    let paths = AppPaths::resolve()?;
    let cfg = ConfigStore::new(&paths).load()?;

    let mut results: [Vec<Probe>; 2] = [vec![], vec![]];
    for (i, mode) in order.chars().enumerate() {
        if i > 0 {
            println!("pausa de 30 s entre modos…");
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
        let listen = mode == 'b';
        println!(
            "modo {mode} ({})…",
            if listen { "escuchando" } else { "sin escucha" }
        );
        results[listen as usize] = run(listen, &magnets, secs, &cfg, &paths).await;
    }
    let [a, b] = results;
    println!(
        "\n{:<10} {:>7} {:>7} | {:>7} {:>7} {:>7} {:>7}",
        "hash", "peers_a", "seeds_a", "peers_b", "seeds_b", "in_b", "1er_in"
    );
    let (mut g1, mut g2, mut g3, mut dseeds, mut n) = (0, vec![], vec![], vec![], 0);
    for (m, (pa, pb)) in magnets.iter().zip(a.iter().zip(b.iter())) {
        println!(
            "{:<10} {:>7} {:>7} | {:>7} {:>7} {:>7} {:>7}",
            &m.info_hash.to_hex()[..8],
            pa.peers,
            pa.seeds,
            pb.peers,
            pb.seeds,
            pb.incoming,
            pb.first_in.map_or("-".into(), |s| s.to_string())
        );
        if pa.meta_secs.is_none() || pb.meta_secs.is_none() {
            continue; // solo con metadatos en ambos modos
        }
        n += 1;
        g1 += (pb.incoming > 0) as u32;
        g2.push(pb.peers as f64 / pa.peers.max(1) as f64);
        g3.extend(pb.first_in.map(|s| s as f64));
        dseeds.push(pb.seeds as f64 - pa.seeds as f64);
    }
    if n == 0 || a.is_empty() || b.is_empty() {
        println!("sin torrents con metadatos en ambos modos (usá --order ab o ba, no uno solo)");
        return Ok(());
    }
    println!(
        "\nn={n} (objetivo >= 25 en total)  G1={:.0}% (>=40)  G2={:.2} (>=1.25)  G3={}s  dseeds={}",
        100.0 * g1 as f64 / n as f64,
        median(g2).unwrap_or(0.0),
        median(g3).map_or("-".into(), |v| format!("{v:.0}")),
        median(dseeds).map_or("-".into(), |v| format!("{v:.0}")),
    );
    Ok(())
}

async fn run(
    listen: bool,
    magnets: &[Magnet],
    secs: u64,
    cfg: &Config,
    paths: &AppPaths,
) -> Vec<Probe> {
    let mut ecfg = cfg.engine.clone();
    ecfg.max_connections = 30; // = MAX_PEERS de analyzer/swarm.rs
    let engine = if listen {
        engine::create_for_playback(&ecfg, paths).await
    } else {
        engine::create(&ecfg, paths).await
    }
    .expect("motor");
    let mut tasks = tokio::task::JoinSet::new();
    for (i, m) in magnets.iter().cloned().enumerate() {
        let (engine, cfg, paths) = (engine.clone(), cfg.clone(), paths.clone());
        tasks.spawn(async move { (i, probe_one(engine, m, secs, cfg, paths, listen).await) });
    }
    let mut out = vec![Probe::default(); magnets.len()];
    while let Some(Ok((i, p))) = tasks.join_next().await {
        out[i] = p;
    }
    let _ = engine.shutdown().await;
    out
}

async fn probe_one(
    engine: Arc<dyn TorrentEngine>,
    m: Magnet,
    secs: u64,
    cfg: Config,
    paths: AppPaths,
    listen: bool,
) -> Probe {
    let tag = if listen { "b" } else { "a" };
    let dir = paths.downloads_dir().join(format!(
        "{}-{}-probe-{tag}",
        m.info_hash.to_hex(),
        std::process::id()
    ));
    let cached = paths.torrent_cache_file(&m.info_hash);
    let opts = AddOptions {
        trackers: cfg.all_trackers(&[]),
        download_dir: dir.clone(),
        initial_peers: vec![],
        download_bps: Some(16 * 1024), // = COUNT_DOWNLOAD_BPS de analyzer/swarm.rs
    };
    let Ok(h) = engine::add_cached_or_magnet(
        &*engine,
        &cached,
        m.with_trackers(&cfg.all_trackers(&[])),
        opts,
    )
    .await
    else {
        return Probe::default();
    };
    let t0 = Instant::now();
    let mut probe = Probe::default();
    if let Ok(Ok(meta)) = tokio::time::timeout(Duration::from_secs(90), engine.metadata(h)).await {
        probe.meta_secs = Some(t0.elapsed().as_secs_f32());
        meta.save_torrent_cache(&cached); // así el 2º modo arranca igual que el 1º
        if let Some(f) = meta.files.iter().max_by_key(|f| f.size) {
            let _ =
                tokio::time::timeout(Duration::from_secs(5), engine.hold_peers(h, f.index)).await;
        }
        for sec in 1..=secs {
            tokio::time::sleep(Duration::from_secs(1)).await;
            if let Ok(Ok(s)) = tokio::time::timeout(Duration::from_secs(2), engine.stats(h)).await {
                probe.peers = probe.peers.max(s.peers);
                probe.seeds = probe.seeds.max(s.seeds);
                probe.incoming = probe.incoming.max(s.incoming_peers);
                if s.incoming_peers > 0 && probe.first_in.is_none() {
                    probe.first_in = Some(sec);
                }
            }
        }
    }
    let _ = engine.remove(h, RemoveOptions { delete_data: false }).await;
    let _ = std::fs::remove_dir_all(dir);
    probe
}
