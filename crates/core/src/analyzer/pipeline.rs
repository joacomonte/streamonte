//! Los pasos de red de un torrent en el analizador: fase rápida ([`quick_one`]) y medición de
//! velocidad ([`measure_with`]), con los pasos que comparten (sumar deseleccionado, metadatos,
//! precarga, duración con mpv).

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use tokio_util::sync::CancellationToken;

use super::speed::{sample_speed, PartialRef, SpeedWindow};
use super::{MeasureCtl, MeasurePhase, QuickInfo, SpeedProgress};
use crate::cleanup::{Cleanup, OwnerRecord};
use crate::config::Config;
use crate::engine::{
    AddOptions, FileInfo, FilePick, Metadata, RemoveOptions, TorrentEngine, TorrentHandle,
};
use crate::library::LiveMeasurement;
use crate::magnet::{InfoHash, Magnet};
use crate::paths::{find_executable, AppPaths, Executable};
use crate::player::MediaProbe;
use crate::Result;

// ---------- plazos de cada camino ----------
// Distintos a propósito: la fase rápida corre muchos en paralelo y no debe trabarse; la medición
// usa los de la config; los nombres al pegar esperan más porque es lo único que hacen.

/// Fase rápida: metadatos.
const QUICK_METADATA_SECS: u64 = 30;
/// Fase rápida: plan B de la precarga.
const QUICK_PRELOAD_FALLBACK_SECS: u64 = 20;
/// Fase rápida: lectura de duración/audios con mpv.
const QUICK_PROBE_TIMEOUT: Duration = Duration::from_secs(20);
/// Medición: lectura de la duración con mpv una vez precargado inicio y final.
/// (Metadatos: `cfg.engine.metadata_timeout_secs`; precarga: [`measure_preload_fallback_secs`].)
const MEASURE_PROBE_TIMEOUT: Duration = Duration::from_secs(30);
/// Nombres al pegar ([`super::names::fetch_names`]): metadatos de un magnet recién pegado.
pub(super) const NAME_TIMEOUT: Duration = Duration::from_secs(45);

/// Plan B de la precarga al medir: más corto que al reproducir, el analizador no debe trabarse
/// en un swarm lento.
fn measure_preload_fallback_secs(cfg: &Config) -> u64 {
    cfg.preload
        .fallback_open_secs
        .min(cfg.analyzer.measure_secs + 15)
}

// ---------- pasos compartidos ----------

/// Registra la carpeta y suma el torrent sin bajar nada (lección 3): `.torrent` en caché si ya
/// lo vimos (FR-13), si no magnet + trackers (FR-10).
pub(super) async fn add_deselected(
    engine: &dyn TorrentEngine,
    paths: &AppPaths,
    cleanup: &Cleanup,
    dir: &Path,
    magnet: &Magnet,
    cfg: &Config,
    download_bps: Option<u32>,
) -> Result<TorrentHandle> {
    // Dueño: esta app y su motor (T-05, sin reproductor).
    cleanup.claim(dir, &OwnerRecord::now(engine.pid(), None))?;
    crate::engine::add_cached_or_magnet(
        engine,
        &paths.torrent_cache_file(&magnet.info_hash),
        magnet.with_trackers(&cfg.all_trackers()),
        AddOptions {
            trackers: cfg.all_trackers(),
            download_dir: dir.to_path_buf(),
            initial_peers: Vec::new(),
            download_bps,
        },
    )
    .await
}

/// Metadatos (quedan guardados para reproducir sin esperarlos, FR-13) y el archivo a analizar.
async fn metadata_and_file(
    engine: &dyn TorrentEngine,
    handle: TorrentHandle,
    paths: &AppPaths,
    hash: &InfoHash,
    pick: FilePick,
    timeout_secs: u64,
) -> Result<(Arc<Metadata>, FileInfo)> {
    let metadata = crate::engine::wait_metadata(engine, handle, timeout_secs).await?;
    let cached = paths.torrent_cache_file(hash);
    if !cached.is_file() {
        metadata.save_torrent_cache(&cached);
    }
    let file = metadata.pick_file(pick)?;
    Ok((metadata, file))
}

/// Precarga inicio(+final MP4): lo que mpv necesita para leer la duración (lección 2).
async fn preload_file(
    engine: &dyn TorrentEngine,
    handle: TorrentHandle,
    file: &FileInfo,
    cfg: &Config,
    fallback_open_secs: u64,
    cancel: CancellationToken,
    select_after: bool,
) -> Result<crate::preload::PreloadOutcome> {
    let plan = crate::preload::plan(file, &cfg.preload, None);
    let mut preload_cfg = cfg.preload.clone();
    preload_cfg.fallback_open_secs = fallback_open_secs;
    crate::preload::run(
        engine,
        handle,
        &plan,
        &preload_cfg,
        cancel,
        select_after,
        &|_: crate::preload::PreloadProgress| {},
    )
    .await
}

/// Duración + pistas de audio (idiomas) con mpv sin ventana (FR-06, lección 9), en la misma
/// lectura de cabecera. Sin mpv o si no se puede leer → `None` (se estima con "~").
async fn probe(
    engine: &dyn TorrentEngine,
    handle: TorrentHandle,
    file: &FileInfo,
    cfg: &Config,
    timeout: Duration,
) -> Result<Option<MediaProbe>> {
    let Some(mpv) = find_executable(Executable::Mpv, cfg.player.mpv_path.as_deref()) else {
        tracing::warn!("mpv no encontrado: la duración se estima");
        return Ok(None);
    };
    let url = engine.stream_url(handle, file.index).await?;
    match crate::player::probe_media(&mpv, &url, timeout).await {
        Ok(p) => Ok(Some(p)),
        Err(e) => {
            tracing::warn!("no se pudo leer la duración: {e}");
            Ok(None)
        }
    }
}

// ---------- caminos ----------

/// Fase rápida de un torrent: metadatos → precarga inicio(+final MP4) mientras se cuentan
/// seeds/peers conectados (`quick_secs`) → duración real con mpv. Casi no usa ancho de banda.
pub(super) async fn quick_one(
    engine: &dyn TorrentEngine,
    paths: &AppPaths,
    cleanup: &Cleanup,
    dir: &Path,
    magnet: &Magnet,
    pick: FilePick,
    cfg: &Config,
) -> Result<QuickInfo> {
    let handle = add_deselected(engine, paths, cleanup, dir, magnet, cfg, None).await?;
    let result = async {
        let (metadata, file) = metadata_and_file(
            engine,
            handle,
            paths,
            &magnet.info_hash,
            pick,
            QUICK_METADATA_SECS,
        )
        .await?;
        let count = async {
            let (mut peers, mut seeds) = (0, 0);
            for _ in 0..cfg.analyzer.quick_secs.max(3) {
                tokio::time::sleep(Duration::from_secs(1)).await;
                if let Ok(Ok(s)) =
                    tokio::time::timeout(Duration::from_secs(2), engine.stats(handle)).await
                {
                    peers = peers.max(s.peers);
                    seeds = seeds.max(s.seeds);
                }
            }
            (peers, seeds)
        };
        let (preload, (peers, seeds)) = tokio::join!(
            preload_file(
                engine,
                handle,
                &file,
                cfg,
                QUICK_PRELOAD_FALLBACK_SECS,
                CancellationToken::new(),
                false, // solo principio y final: no bajar el video entero
            ),
            count,
        );
        // Sin nada del principio (precarga trabada en 0 %), mpv no puede leer la duración: se
        // esperaban 20 s en vano (2026-11-15, logs: 6 de 8 timeouts). Se estima sin probe.
        let media = match preload {
            Ok(crate::preload::PreloadOutcome::TimedOut { fraction: 0.0, .. }) => None,
            Ok(_) => probe(engine, handle, &file, cfg, QUICK_PROBE_TIMEOUT).await?,
            Err(_) => None,
        };
        Ok(QuickInfo {
            torrent_name: Some(metadata.name.clone()).filter(|n| !n.is_empty()),
            file,
            peers,
            seeds,
            duration_secs: media.as_ref().map(|p| p.duration_secs),
            audio: media.map(|p| p.audio),
        })
    }
    .await;
    // Sin borrar: la carpeta la conserva o la borra `quick` (FR-06d).
    let _ = engine
        .remove(handle, RemoveOptions { delete_data: false })
        .await;
    result
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn measure_with(
    paths: &AppPaths,
    cleanup: &Cleanup,
    engine: &dyn TorrentEngine,
    dir: &Path,
    magnet: &Magnet,
    pick: FilePick,
    cfg: &Config,
    ctl: &MeasureCtl,
    partial: &PartialRef,
) -> Result<LiveMeasurement> {
    // 1. Torrent sin bajar nada.
    let handle = add_deselected(engine, paths, cleanup, dir, magnet, cfg, None).await?;

    // 2. Metadatos y archivo a medir.
    (ctl.progress)(SpeedProgress::phase(MeasurePhase::Metadata));
    let (metadata, file) = metadata_and_file(
        engine,
        handle,
        paths,
        &magnet.info_hash,
        pick,
        cfg.engine.metadata_timeout_secs,
    )
    .await?;
    {
        let mut p = partial.lock().expect("partial");
        p.torrent_name = Some(metadata.name.clone()).filter(|n| !n.is_empty());
        p.file = Some(file.clone());
    }

    // 3. Precarga inicio(+final MP4) y, a la vez, velocidad real durante `measure_secs`.
    let window = Duration::from_secs(cfg.analyzer.measure_secs.max(1));
    (ctl.progress)(SpeedProgress::phase(MeasurePhase::Preload));
    let (preload, speed) = tokio::join!(
        preload_file(
            engine,
            handle,
            &file,
            cfg,
            measure_preload_fallback_secs(cfg),
            ctl.cancel.clone(),
            true, // medir velocidad necesita que siga bajando
        ),
        sample_speed(
            engine,
            handle,
            SpeedWindow {
                min: window,
                max: Duration::from_secs(
                    cfg.analyzer.speed_max_secs.max(cfg.analyzer.measure_secs)
                )
            },
            partial,
            &ctl.finish,
            &ctl.progress,
        ),
    );
    preload?;
    // Lo último bajado que se vio: con 0 la barra de la fila retrocedería.
    let (speed, downloaded_bytes) = speed?;
    (ctl.progress)(SpeedProgress {
        speed_bps: speed.avg_bps,
        secs: speed.secs,
        peers: speed.peers,
        seeds: speed.seeds,
        stable: true,
        downloaded_bytes,
        phase: MeasurePhase::Probing,
    });

    // 4. Duración real con mpv.
    let media = probe(engine, handle, &file, cfg, MEASURE_PROBE_TIMEOUT).await?;
    let _ = engine
        .remove(handle, RemoveOptions { delete_data: false })
        .await;

    Ok(LiveMeasurement {
        measured_at: chrono::Utc::now(),
        torrent_name: Some(metadata.name.clone()).filter(|n| !n.is_empty()),
        file_index: file.index,
        file_name: file.name.clone(),
        file_size: file.size,
        peers: speed.peers,
        seeds: speed.seeds,
        partial: false,
        measured_secs: speed.secs,
        avg_speed_bps: speed.avg_bps,
        max_speed_bps: speed.max_bps,
        duration_secs: media.as_ref().map(|p| p.duration_secs),
        audio: media.map(|p| p.audio),
    })
}
