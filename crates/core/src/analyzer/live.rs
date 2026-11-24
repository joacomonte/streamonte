//! Medidor real: un motor propio por fase (aislado de las reproducciones), carpetas de análisis
//! reservadas (FR-06d) y mpv sin ventana.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use tokio_util::sync::CancellationToken;

use super::pipeline::{measure_with, quick_one};
use super::speed::{partial_measurement, PartialRef};
use super::{MeasureCtl, MeasurePhase, Measurer, QuickSink, SpeedProgress};
use crate::cleanup::Cleanup;
use crate::config::Config;
use crate::engine::FilePick;
use crate::library::LiveMeasurement;
use crate::magnet::{InfoHash, Magnet};
use crate::paths::AppPaths;
use crate::trackers::ScrapeResult;
use crate::{CoreError, Result};

/// Mide con un motor propio por torrent (aislado de las reproducciones) y mpv sin ventana.
pub struct LiveMeasurer {
    paths: AppPaths,
    cleanup: Cleanup,
    trackers: crate::trackers::Shared,
    next_id: std::sync::atomic::AtomicU64,
}

impl LiveMeasurer {
    pub fn new(paths: AppPaths, trackers: crate::trackers::Shared) -> Self {
        Self {
            cleanup: Cleanup::new(paths.clone()),
            paths,
            trackers,
            next_id: std::sync::atomic::AtomicU64::new(1),
        }
    }
}

#[async_trait]
impl Measurer for LiveMeasurer {
    async fn scrape(&self, hashes: &[InfoHash], cfg: &Config) -> HashMap<InfoHash, ScrapeResult> {
        let t0 = Instant::now();
        let r = crate::trackers::scrape_batch(
            hashes,
            &cfg.all_trackers(&self.trackers.get()),
            Duration::from_secs(cfg.analyzer.scrape_timeout_secs),
        )
        .await;
        tracing::info!(
            pedidos = hashes.len(),
            respondidos = r.len(),
            secs = format!("{:.1}", t0.elapsed().as_secs_f32()),
            "scrape en lote"
        );
        r
    }

    async fn measure(
        &self,
        magnet: &Magnet,
        pick: FilePick,
        cfg: &Config,
        ctl: MeasureCtl,
    ) -> Result<LiveMeasurement> {
        let cancel = ctl.cancel.clone();
        let id = self
            .next_id
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        (ctl.progress)(SpeedProgress::phase(MeasurePhase::Connecting));
        // El motor antes de reservar: si no arranca, no queda la carpeta reservada.
        let engine = crate::engine::create(&cfg.engine, &self.paths).await?;
        // FR-06d: se mide en la carpeta de análisis del hash (sigue lo de una medición anterior).
        let (dir, keep) = reserve_dir(
            &self.paths,
            &self.cleanup,
            &magnet.info_hash,
            format!("a{id}"),
        );
        let shared_trackers = self.trackers.get();
        let started = std::time::Instant::now();
        let partial: PartialRef = Arc::default();
        let result = tokio::select! {
            r = measure_with(&self.paths, &self.cleanup, engine.as_ref(), &dir, magnet, pick, cfg, &shared_trackers, &ctl, &partial) => r,
            _ = cancel.cancelled() => Err(CoreError::Cancelled),
        };
        // Pausa/cancelación a mitad de medición: lo medido no se tira (pedido del usuario,
        // 2026-11-13). Queda como medición parcial, menos precisa.
        let result = match result {
            Err(CoreError::Cancelled) => partial_measurement(&partial).ok_or(CoreError::Cancelled),
            r => r,
        };
        // FR-06d: el motor se apaga (nada sigue bajando ni compartiendo) y lo bajado queda
        // para la reproducción; solo se borra la carpeta descartable.
        let _ = engine.shutdown().await;
        release_dir(&self.cleanup, &dir, keep).await;
        tracing::info!(
            hash = %magnet.info_hash,
            ok = result.is_ok(),
            secs = format!("{:.1}", started.elapsed().as_secs_f32()),
            "medición terminada"
        );
        result
    }

    async fn quick(
        &self,
        magnets: Vec<(Magnet, FilePick)>,
        cfg: &Config,
        cancel: CancellationToken,
        on_result: QuickSink,
    ) {
        if magnets.is_empty() {
            return;
        }
        let engine = match crate::engine::create(&cfg.engine, &self.paths).await {
            Ok(e) => e,
            Err(e) => {
                tracing::warn!("fase rápida: no se pudo iniciar el motor: {e}");
                return;
            }
        };
        let started = Instant::now();
        let total = magnets.len();
        let sem = Arc::new(tokio::sync::Semaphore::new(
            cfg.analyzer.quick_concurrency.max(1),
        ));
        let mut tasks = tokio::task::JoinSet::new();
        for (magnet, pick) in magnets {
            let id = self
                .next_id
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let (engine, sem, cfg, shared_trackers, paths, cancel, on_result) = (
                engine.clone(),
                sem.clone(),
                cfg.clone(),
                self.trackers.get(),
                self.paths.clone(),
                cancel.clone(),
                on_result.clone(),
            );
            // Devuelve si resolvió y la carpeta a soltar tras apagar el motor (si queda alguna).
            tasks.spawn(async move {
                let Ok(_permit) = sem.acquire_owned().await else {
                    return (false, None);
                };
                if cancel.is_cancelled() {
                    return (false, None);
                }
                // Se reserva recién con el permiso: los que esperan turno no bloquean la carpeta.
                let cleanup = Cleanup::new(paths.clone());
                let (dir, keep) =
                    reserve_dir(&paths, &cleanup, &magnet.info_hash, format!("q{id}"));
                let ok = tokio::select! {
                    r = quick_one(engine.as_ref(), &paths, &cleanup, &dir, &magnet, pick, &cfg, &shared_trackers) => match r {
                        Ok(info) => {
                            on_result(magnet.info_hash, info);
                            Some(true)
                        }
                        Err(e) => {
                            tracing::warn!(hash = %magnet.info_hash, "fase rápida: {e}");
                            Some(false)
                        }
                    },
                    _ = cancel.cancelled() => None,
                };
                match ok {
                    // `quick_one` terminó y sacó el torrent del motor: ya se puede soltar.
                    Some(ok) if keep => {
                        cleanup.release(&dir);
                        (ok, None)
                    }
                    // Descartable, o cancelado con el torrent aún en el motor: tras el apagado.
                    ok => (ok.unwrap_or(false), Some((dir, keep))),
                }
            });
        }
        let mut ok = 0;
        let mut pending = Vec::new();
        while let Some(r) = tasks.join_next().await {
            let Ok((resolved, dir)) = r else { continue };
            ok += usize::from(resolved);
            pending.extend(dir);
        }
        let _ = engine.shutdown().await;
        for (dir, keep) in pending {
            release_dir(&self.cleanup, &dir, keep).await;
        }
        tracing::info!(
            ok,
            total,
            secs = format!("{:.1}", started.elapsed().as_secs_f32()),
            "fase rápida"
        );
    }
}

/// FR-06d: carpeta donde analizar `hash` y si se conserva. La del análisis (la adopta la
/// reproducción) o, si otra fase del mismo hash ya la está usando, una descartable con `tag`.
fn reserve_dir(
    paths: &AppPaths,
    cleanup: &Cleanup,
    hash: &InfoHash,
    tag: String,
) -> (PathBuf, bool) {
    let dir = paths.analysis_dir(hash);
    if cleanup.try_reserve(&dir) {
        return (dir, true);
    }
    let scratch =
        paths
            .downloads_dir()
            .join(format!("{}-{}-{tag}", hash.to_hex(), std::process::id()));
    (scratch, false)
}

/// Fin de una fase: la carpeta de análisis queda libre (y en disco); la descartable se borra.
async fn release_dir(cleanup: &Cleanup, dir: &Path, keep: bool) {
    if keep {
        cleanup.release(dir);
    } else if let Err(e) = cleanup.remove_dir(dir).await {
        tracing::warn!("no se pudo borrar {dir:?}: {e} (se reintenta al abrir la app)");
    }
}
