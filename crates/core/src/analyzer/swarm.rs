//! "Contar seeders reales" desde el catálogo (2026-11-15): se conecta al enjambre de cada torrent
//! y cuenta los seeders y peers que de verdad ve, sin bajar el video ni agregarlo a Mis magnets.
//! Los trackers informan lo que se les anunció (un 0 no prueba nada: hay peers solo en DHT); esto
//! es lo que ve un cliente conectado, como la fase rápida pero sin precarga ni lectura con mpv.
//!
//! Un pedido = un motor propio para todos sus torrents (deseleccionados: solo metadatos y
//! conexiones), con `CONCURRENCY` contando a la vez: apenas termina uno entra el siguiente (sin
//! esperar al más lento de una tanda). Cortable con `cancel`; al terminar o cortar se borran las
//! carpetas descartables. Cada resultado se avisa apenas sale (`on_count` con `done = true`), y
//! mientras cuenta, cada cambio (`done = false`): la UI lo muestra en vivo.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;
use tokio_util::sync::CancellationToken;

use super::pipeline::add_deselected;
use crate::cleanup::Cleanup;
use crate::config::Config;
use crate::engine::{RemoveOptions, TorrentEngine};
use crate::magnet::{InfoHash, Magnet};
use crate::paths::AppPaths;

/// Metadatos: sin ellos no se sabe quién tiene el archivo completo.
const METADATA_SECS: u64 = 35;
/// Sin ningún peer a los `DEAD_SECS` (ni por DHT ni trackers) se da por muerto y libera el lugar.
const DEAD_SECS: u64 = 15;
/// Torrents contando a la vez. shortcut: el motor tiene 40 permisos de E/S y cada uno retiene
/// uno mientras cuenta (ver `hold_peers`); para subir esto, subir `runtime_worker_threads`.
pub const CONCURRENCY: usize = 25;
/// Conexiones por torrent al contar: "30+ seeders" ya alcanza para decidir y no satura el router.
const MAX_PEERS: u32 = 30;
/// Ventana de conteo una vez que hay metadatos (máximo visto): `(mínimo, máximo, estable)` en
/// segundos. Sigue mientras aparezcan peers nuevos (DHT y trackers los van dando de a poco) hasta
/// el máximo, o corta tras `estable` s sin subir. Normal: 35 + 25 ≈ 1 min por tanda; profundo:
/// 35 + 85 ≈ 2 min, más cerca de lo que se ve a los minutos de reproducir.
const WINDOW: (u64, u64, u64) = (12, 25, 8);
const WINDOW_DEEP: (u64, u64, u64) = (45, 85, 25);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct SwarmCount {
    /// Conectados con el archivo completo.
    pub seeds: u32,
    /// Conectados en total; sin metadatos, los que encontró la DHT (sin poder conectarse).
    pub peers: u32,
    /// ¿Algún peer dio los metadatos? Si no, nadie respondió: casi seguro muerto o muy flojo.
    pub reached: bool,
}

/// Cuenta el enjambre de cada magnet. Falta en el resultado = no se pudo (sin metadatos a tiempo,
/// o se cortó). Nunca deja el motor ni las carpetas de fondo. `on_count(hash, count, done)`:
/// parcial mientras cuenta (sin metadatos todavía: `reached = false` y los peers de la DHT) y el
/// final con `done = true`.
pub async fn count(
    paths: &AppPaths,
    cfg: &Config,
    magnets: Vec<Magnet>,
    deep: bool,
    cancel: CancellationToken,
    on_count: impl Fn(InfoHash, SwarmCount, bool) + Send + Sync + 'static,
) -> HashMap<InfoHash, SwarmCount> {
    let window = if deep { WINDOW_DEEP } else { WINDOW };
    let on_count = Arc::new(on_count);
    let cleanup = Cleanup::new(paths.clone());
    let mut engine_cfg = cfg.engine.clone();
    engine_cfg.max_connections = MAX_PEERS;
    let engine = match crate::engine::create(&engine_cfg, paths).await {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!("contar seeders: no arrancó el motor: {e}");
            return HashMap::new();
        }
    };
    let dirs: Vec<_> = magnets
        .iter()
        .map(|m| {
            paths.downloads_dir().join(format!(
                "{}-{}-swarm",
                m.info_hash.to_hex(),
                std::process::id()
            ))
        })
        .collect();
    let slots = Arc::new(tokio::sync::Semaphore::new(CONCURRENCY));
    let mut tasks = tokio::task::JoinSet::new();
    for (m, dir) in magnets.into_iter().zip(dirs.clone()) {
        let (engine, paths, cfg, slots, report) = (
            engine.clone(),
            paths.clone(),
            cfg.clone(),
            slots.clone(),
            on_count.clone(),
        );
        tasks.spawn(async move {
            let _slot = slots.acquire_owned().await.ok()?;
            let cleanup = Cleanup::new(paths.clone());
            let progress = |n: SwarmCount| report(m.info_hash, n, false);
            count_one(
                engine.as_ref(),
                &paths,
                &cleanup,
                &cfg,
                &m,
                &dir,
                window,
                &progress,
            )
            .await
        });
    }
    let mut found = HashMap::new();
    loop {
        tokio::select! {
            next = tasks.join_next() => match next {
                Some(Ok(Some((hash, n)))) => { on_count(hash, n, true); found.insert(hash, n); }
                Some(_) => {}
                None => break,
            },
            _ = cancel.cancelled() => { tasks.abort_all(); found.clear(); break; }
        }
    }
    let _ = engine.shutdown().await;
    for dir in &dirs {
        let _ = cleanup.remove_dir(dir).await;
    }
    found
}

#[allow(clippy::too_many_arguments)] // todos son del pedido; agruparlos solo movería el ruido
async fn count_one(
    engine: &dyn TorrentEngine,
    paths: &AppPaths,
    cleanup: &Cleanup,
    cfg: &Config,
    magnet: &Magnet,
    dir: &std::path::Path,
    (min_secs, max_secs, stable_secs): (u64, u64, u64),
    progress: &(dyn Fn(SwarmCount) + Sync),
) -> Option<(InfoHash, SwarmCount)> {
    let handle = add_deselected(engine, paths, cleanup, dir, magnet, cfg)
        .await
        .ok()?;
    let result = async {
        // Sin `wait_metadata`: acá que no respondan es un resultado, no un error para el log.
        // Se corta antes si a los `DEAD_SECS` la red no conoce ni un peer.
        let meta = engine.metadata(handle);
        tokio::pin!(meta);
        let start = Instant::now();
        let mut dht_peers = 0;
        let got = loop {
            tokio::select! {
                r = &mut meta => break r.ok(),
                _ = tokio::time::sleep(Duration::from_secs(1)) => {
                    let secs = start.elapsed().as_secs();
                    if secs >= METADATA_SECS {
                        break None;
                    }
                    let waiting = engine.waiting_on(handle).await;
                    if let Some(crate::engine::Waiting::Metadata { peers: Some(n) }) = waiting {
                        if n as u32 != dht_peers {
                            dht_peers = n as u32;
                            progress(SwarmCount { seeds: 0, peers: dht_peers, reached: false });
                        }
                    }
                    if secs >= DEAD_SECS
                        && matches!(waiting, Some(crate::engine::Waiting::Metadata { peers: Some(0) }))
                    {
                        break None;
                    }
                }
            }
        };
        let Some(metadata) = got else {
            let found = match engine.waiting_on(handle).await {
                Some(crate::engine::Waiting::Metadata { peers: Some(n) }) => n as u32,
                _ => 0,
            };
            return Some((magnet.info_hash, SwarmCount { seeds: 0, peers: found, reached: false }));
        };
        // Sin esto los seeders se cortan al mandar su bitfield y casi nunca se ven (ver `hold_peers`).
        // El archivo más grande: el último pedazo no lo completa, así sigue "pendiente".
        if let Some(file) = metadata.files.iter().max_by_key(|f| f.size) {
            // Con el timeout, si se acaban los permisos de E/S del motor (tanda enorme) se cuenta
            // sin retener en vez de colgarse.
            let held =
                tokio::time::timeout(Duration::from_secs(5), engine.hold_peers(handle, file.index))
                    .await;
            if !matches!(held, Ok(Ok(()))) {
                tracing::debug!("contar seeders: no se pudo retener peers de {}", magnet.info_hash.to_hex());
            }
        }
        let mut best = SwarmCount { seeds: 0, peers: 0, reached: true };
        progress(best); // ya hay metadatos: empieza a contar
        let mut last_rise = 0;
        for sec in 1..=max_secs {
            tokio::time::sleep(Duration::from_secs(1)).await;
            if let Ok(Ok(s)) =
                tokio::time::timeout(Duration::from_secs(2), engine.stats(handle)).await
            {
                if s.peers > best.peers || s.seeds > best.seeds {
                    last_rise = sec;
                    best.peers = best.peers.max(s.peers);
                    best.seeds = best.seeds.max(s.seeds);
                    progress(best);
                }
            }
            if sec >= min_secs && sec - last_rise >= stable_secs {
                break;
            }
        }
        Some((magnet.info_hash, best))
    }
    .await;
    // La carpeta la borra `Cleanup` al final (tiene el registro de dueño: el motor no podría).
    let _ = engine
        .remove(handle, RemoveOptions { delete_data: false })
        .await;
    result
}
