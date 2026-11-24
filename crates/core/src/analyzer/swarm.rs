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

/// Metadatos: sin ellos no se sabe quién tiene el archivo completo. Se espera mientras haya
/// novedades (2026-11-16): con el puerto cerrado conectarse tarda, y un corte fijo a los 35 s marcaba
/// "sin respuesta" a torrents vivos. Como mínimo `METADATA_MIN_SECS`; después corta tras
/// `METADATA_STALL_SECS` sin que la red dé direcciones nuevas, y nunca pasa de `METADATA_MAX_SECS`.
const METADATA_MIN_SECS: u64 = 35;
const METADATA_STALL_SECS: u64 = 25;
const METADATA_MAX_SECS: u64 = 90;
/// Tope de descarga de cada torrent al contar (2026-11-16): `hold_peers` selecciona el archivo
/// para anunciarse como que le falta (los trackers y los seeders le dan seeders, no solo
/// leechers) y esto evita bajarlo: ~1 MB por minuto por torrent. librqbit pide de a 16 KB y con un
/// tope menor da error y corta al peer: no bajar de 16384.
const COUNT_DOWNLOAD_BPS: u32 = 16 * 1024;
/// Qué tan a fondo se cuenta (2026-11-17, embudo): `Quick` prueba todas las opciones al abrir un
/// video para descartar con seeds reales y no con los anunciados (que vienen muy inflados);
/// `Deep` cuenta las mejores con una ventana larga, la que decide la salud.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Depth {
    Quick,
    Deep,
}

/// Cómo cuenta cada profundidad.
struct Plan {
    /// Torrents a la vez. El motor tiene 40 permisos de E/S y cada uno retiene uno mientras cuenta
    /// (ver `hold_peers`); conexiones en total ≈ `concurrency × max_peers` y los routers caseros se
    /// saturan pasando ~300 (2026-11-16: con 25 × 30 ≈ 750 fallaban muchas por eso).
    concurrency: usize,
    /// Conexiones por torrent: también es el techo de seeds que se pueden contar.
    max_peers: u32,
    /// Ventana de conteo una vez que hay metadatos: `(mínimo, máximo, estable)` en segundos. Sigue
    /// mientras aparezcan peers nuevos hasta el máximo, o corta tras `estable` s sin subir.
    window: (u64, u64, u64),
    /// Corta apenas cuenta estos seeds (ya decidió: está viva).
    enough_seeds: Option<u32>,
    /// Tope total desde que arranca ese torrent, metadatos incluidos.
    budget_secs: Option<u64>,
    /// Espera máxima de metadatos (sin ellos no se sabe quién tiene el archivo completo).
    metadata_secs: u64,
    /// Sin ningún peer a estos segundos (ni por DHT ni trackers) se da por muerto y libera el lugar.
    dead_secs: u64,
    /// Con metadatos, 0 seeds a estos segundos de contar: se descarta ya.
    zero_seeds_secs: Option<u64>,
}

impl Depth {
    fn plan(self) -> Plan {
        match self {
            // 30 × 8 ≈ 240 conexiones: todas las opciones de una peli en ~1 min. 8 seeds reales ya
            // dicen "viva"; lo fino lo decide el profundo.
            Depth::Quick => Plan {
                concurrency: 30,
                max_peers: 8,
                window: (0, 30, 30),
                enough_seeds: Some(8),
                budget_secs: Some(30),
                // Descarta rápido (2026-11-17): sin metadatos a los 12 s o sin seeds a los 10 s de
                // contar, no vale la pena esperar más.
                metadata_secs: 12,
                dead_secs: 8,
                zero_seeds_secs: Some(10),
            },
            // 10 × 30 ≈ 300 conexiones; 35 + 85 ≈ 2 min, cerca de lo que se ve a los minutos de reproducir.
            Depth::Deep => Plan {
                concurrency: 10,
                max_peers: 30,
                window: (45, 85, 25),
                enough_seeds: None,
                budget_secs: None,
                metadata_secs: METADATA_MAX_SECS,
                dead_secs: 15,
                zero_seeds_secs: None,
            },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
pub struct SwarmCount {
    /// Conectados con el archivo completo.
    pub seeds: u32,
    /// Conectados en total; sin metadatos, los que encontró la DHT (sin poder conectarse).
    pub peers: u32,
    /// ¿Algún peer dio los metadatos? Si no, nadie respondió: casi seguro muerto o muy flojo.
    pub reached: bool,
    /// Direcciones únicas conocidas (DHT + trackers + PEX), conectadas o no.
    pub known: u32,
    /// Conectados que se conectaron ellos (entrantes; solo con `announce_early`).
    pub incoming: u32,
}

/// Cuenta el enjambre de cada magnet. Falta en el resultado = no se pudo (sin metadatos a tiempo,
/// o se cortó). Nunca deja el motor ni las carpetas de fondo. `on_count(hash, count, done)`:
/// parcial mientras cuenta (sin metadatos todavía: `reached = false` y los peers de la DHT) y el
/// final con `done = true`.
pub async fn count(
    paths: &AppPaths,
    cfg: &Config,
    shared_trackers: Vec<String>,
    magnets: Vec<Magnet>,
    depth: Depth,
    cancel: CancellationToken,
    on_count: impl Fn(InfoHash, SwarmCount, bool) + Send + Sync + 'static,
) -> HashMap<InfoHash, SwarmCount> {
    let plan = Arc::new(depth.plan());
    let on_count = Arc::new(on_count);
    let cleanup = Cleanup::new(paths.clone());
    let mut engine_cfg = cfg.engine.clone();
    engine_cfg.max_connections = plan.max_peers;
    // Idea 1: escuchando, los peers que ven el anuncio se conectan solos (entrantes).
    let created = if cfg.engine.announce_early {
        crate::engine::create_for_playback(&engine_cfg, paths).await
    } else {
        crate::engine::create(&engine_cfg, paths).await
    };
    let engine = match created {
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
    let slots = Arc::new(tokio::sync::Semaphore::new(plan.concurrency));
    let mut tasks = tokio::task::JoinSet::new();
    for (m, dir) in magnets.into_iter().zip(dirs.clone()) {
        let (engine, paths, cfg, shared_trackers, slots, report, plan) = (
            engine.clone(),
            paths.clone(),
            cfg.clone(),
            shared_trackers.clone(),
            slots.clone(),
            on_count.clone(),
            plan.clone(),
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
                &shared_trackers,
                &m,
                &dir,
                &plan,
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
    shared_trackers: &[String],
    magnet: &Magnet,
    dir: &std::path::Path,
    plan: &Plan,
    progress: &(dyn Fn(SwarmCount) + Sync),
) -> Option<(InfoHash, SwarmCount)> {
    let (min_secs, max_secs, stable_secs) = plan.window;
    // Arrancó (2026-11-17): la UI distingue los que cuentan de los que esperan lugar.
    progress(SwarmCount {
        seeds: 0,
        peers: 0,
        reached: false,
        known: 0,
        incoming: 0,
    });
    let handle = add_deselected(
        engine,
        paths,
        cleanup,
        dir,
        magnet,
        cfg,
        shared_trackers,
        Some(COUNT_DOWNLOAD_BPS),
    )
    .await
    .ok()?;
    let result = async {
        // Sin `wait_metadata`: acá que no respondan es un resultado, no un error para el log.
        // Se corta antes si a los `dead_secs` la red no conoce ni un peer.
        let meta = engine.metadata(handle);
        tokio::pin!(meta);
        let start = Instant::now();
        let mut dht_peers = 0;
        let mut last_news = 0;
        let got = loop {
            tokio::select! {
                r = &mut meta => break r.ok(),
                _ = tokio::time::sleep(Duration::from_secs(1)) => {
                    let secs = start.elapsed().as_secs();
                    let waiting = engine.waiting_on(handle).await;
                    if let Some(crate::engine::Waiting::Metadata { peers: Some(n) }) = waiting {
                        if n as u32 != dht_peers {
                            dht_peers = n as u32;
                            last_news = secs;
                            progress(SwarmCount { seeds: 0, peers: dht_peers, reached: false, known: dht_peers, incoming: 0 });
                        }
                    }
                    let stalled = secs >= METADATA_MIN_SECS && secs - last_news >= METADATA_STALL_SECS;
                    if stalled || secs >= plan.metadata_secs {
                        break None;
                    }
                    if secs >= plan.dead_secs
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
            return Some((magnet.info_hash, SwarmCount { seeds: 0, peers: found, reached: false, known: found, incoming: 0 }));
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
        let mut best = SwarmCount { seeds: 0, peers: 0, reached: true, known: 0, incoming: 0 };
        let mut known_meta = None;
        progress(best); // ya hay metadatos: empieza a contar
        let mut last_rise = 0;
        for sec in 1..=max_secs {
            tokio::time::sleep(Duration::from_secs(1)).await;
            if let Ok(Ok(s)) =
                tokio::time::timeout(Duration::from_secs(2), engine.stats(handle)).await
            {
                known_meta = known_meta.or(s.known_peers);
                // Una dirección nueva también es novedad: extiende la ventana como un peer nuevo.
                let more_known = s.known_peers.is_some_and(|k| k > best.known);
                if s.peers > best.peers || s.seeds > best.seeds || s.incoming_peers > best.incoming || more_known {
                    last_rise = sec;
                    best.peers = best.peers.max(s.peers);
                    best.seeds = best.seeds.max(s.seeds);
                    best.incoming = best.incoming.max(s.incoming_peers);
                    best.known = best.known.max(s.known_peers.unwrap_or(0));
                    progress(best);
                }
            }
            if sec >= min_secs && sec - last_rise >= stable_secs {
                break;
            }
            // Rápido: ya decidió (viva) o se acabó su tiempo.
            if plan.enough_seeds.is_some_and(|n| best.seeds >= n)
                || plan.zero_seeds_secs.is_some_and(|z| sec >= z && best.seeds == 0)
                || plan.budget_secs.is_some_and(|b| start.elapsed().as_secs() >= b)
            {
                break;
            }
        }
        tracing::info!(
            "swarm {}: peers={} seeds={} known_meta={} known_fin={}",
            magnet.info_hash.to_hex(),
            best.peers,
            best.seeds,
            known_meta.unwrap_or(0),
            best.known
        );
        // Deja listo el play (2026-11-15): metadatos sin esperarlos y los peers que respondieron,
        // para conectarse de entrada.
        metadata.save_torrent_cache(&paths.torrent_cache_file(&magnet.info_hash));
        crate::engine::save_peers(
            &paths.peers_cache_file(&magnet.info_hash),
            &engine.connected_peers(handle).await,
        );
        Some((magnet.info_hash, best))
    }
    .await;
    // La carpeta la borra `Cleanup` al final (tiene el registro de dueño: el motor no podría).
    let _ = engine
        .remove(handle, RemoveOptions { delete_data: false })
        .await;
    result
}

/// Plazo del censo DHT: arranque en frío (~3–6 s) + 1–2 rondas de búsqueda.
pub const CENSUS_SECS: u64 = 12;

/// Censo sin conectarse (2026-11-16): direcciones únicas que da la DHT para cada hash, con un
/// motor propio sin escucha ni persistencia y cero TCP. Falta en el mapa = 0. Cortable con `cancel`.
pub async fn census(
    paths: &AppPaths,
    cfg: &Config,
    hashes: Vec<InfoHash>,
    cancel: CancellationToken,
) -> HashMap<InfoHash, u32> {
    let engine = match crate::engine::create(&cfg.engine, paths).await {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!("censo DHT: no arrancó el motor: {e}");
            return HashMap::new();
        }
    };
    let out = tokio::select! {
        r = engine.dht_census(&hashes, CENSUS_SECS) => r.unwrap_or_default(),
        _ = cancel.cancelled() => HashMap::new(),
    };
    let _ = engine.shutdown().await;
    out
}
