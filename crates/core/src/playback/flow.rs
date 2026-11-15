//! Flujo de UNA reproducción (spec 04, flujo 1): origen → motor propio → metadatos → precarga →
//! reproductor → stats mientras se ve → al cerrar, "¿seguir bajando de fondo o pausar?".
//! Lo lanza [`super::PlaybackManager::start`]; al volver, `start` hace el `teardown`.

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio_util::sync::CancellationToken;

use crate::cleanup::OwnerRecord;
use crate::config::{PlayerKind, SubtitleLanguage};
use crate::engine::{AddOptions, EngineEvent, FileInfo, Metadata, TorrentEngine, TorrentHandle};
use crate::events::StatusLevel;
use crate::magnet::Magnet;
use crate::player::{LaunchRequest, MpvEvent, PlayerLauncher};
use crate::preload::{self, PreloadOutcome};
use crate::subtitles;
use crate::{CoreError, Result};

use super::calibration::CalibrationSampler;
use super::{PlaybackState, Shared, Slot, StartRequest};

/// Retomar un poco antes de donde se dejó (para no perder la frase).
const RESUME_REWIND_SECS: f64 = 3.0;
/// Cuánto se espera la respuesta a "¿seguir bajando?" antes de pausar.
const ASK_TIMEOUT: Duration = Duration::from_secs(120);
/// Tope por pedido de stats al motor (como la precarga): uno trabado no frena el bucle.
const STATS_TIMEOUT: Duration = Duration::from_secs(3);

/// `true` si el usuario eligió seguir bajando; `false` si pausó (o se detuvo / no respondió).
async fn wait_answer(
    answer: &tokio::sync::Notify,
    cancel: &CancellationToken,
    timeout: Duration,
) -> bool {
    tokio::select! {
        _ = answer.notified() => true,
        _ = cancel.cancelled() => false,
        _ = tokio::time::sleep(timeout) => false,
    }
}

pub(super) async fn run(
    shared: &Arc<Shared>,
    slot: &Arc<Slot>,
    req: StartRequest,
    player_kind: PlayerKind,
) -> Result<()> {
    let deps = &shared.deps;
    let cfg = deps.config.read().await.clone();

    // 1. Origen: `.torrent` en caché (sin esperar metadatos, FR-13) o magnet + trackers (FR-10).
    let magnet = match req.magnet {
        Some(m) => m,
        None => {
            let library = deps.library.lock().await;
            let entry = library
                .get(&req.key)
                .ok_or_else(|| CoreError::NotFound(format!("magnet {}", req.key)))?;
            Magnet::parse(&entry.magnet)?
        }
    };
    let full_magnet = magnet.with_trackers(&cfg.trackers);
    *slot.magnet_uri.lock().expect("magnet") = Some(full_magnet.to_uri());
    let cached = deps.paths.torrent_cache_file(&req.key.info_hash);
    if cached.is_file() {
        shared.log(slot, "usando metadatos guardados (FR-13)".into());
    }

    // 2. Motor propio + registro de dueño de la carpeta (T-05).
    let engine = crate::engine::create_for_playback(&cfg.engine, &deps.paths).await?;
    shared
        .cleanup
        .claim(&slot.dir, &OwnerRecord::now(engine.pid(), None))?;
    let handle = crate::engine::add_cached_or_magnet(
        engine.as_ref(),
        &cached,
        full_magnet,
        AddOptions {
            trackers: cfg.trackers.clone(),
            download_dir: slot.dir.clone(),
        },
    )
    .await?;
    *slot.engine.lock().expect("engine") = Some((engine.clone(), handle));
    spawn_engine_log_forwarder(shared.clone(), slot.clone(), engine.as_ref(), handle);

    // 3. Metadatos con timeout (NFR-08).
    // FR-06d: carpeta adoptada del análisis → su bitfield evita re-verificar el archivo entero.
    let metadata = cancellable(
        slot,
        crate::engine::wait_metadata(engine.as_ref(), handle, cfg.engine.metadata_timeout_secs),
    )
    .await?;
    let metadata_secs = slot.started.elapsed().as_secs_f32();
    if !cached.is_file() {
        metadata.save_torrent_cache(&cached);
    }
    // FR-49: sin índice pedido, el archivo del episodio si la fila vino del catálogo.
    let pick = match req.file_index {
        Some(i) => crate::engine::FilePick {
            index: Some(i),
            episode: None,
        },
        None => deps
            .library
            .lock()
            .await
            .get(&req.key)
            .map(|e| e.file_pick())
            .unwrap_or_default(),
    };
    let file = metadata.pick_file(pick)?;
    *slot.file_index.lock().expect("file_index") = Some(file.index);
    shared.log(
        slot,
        format!(
            "metadatos en {metadata_secs:.1} s · archivo {} ({} MB)",
            file.name,
            file.size / 1_048_576
        ),
    );
    {
        let mut row = slot.row.lock().expect("row");
        row.metadata_secs = Some(metadata_secs);
        row.name = file_display_name(&file.name);
    }
    slot.set_state(PlaybackState::Preparing { fraction: 0.0 });
    shared.emit_row(slot);

    // 3b. Subtítulos (FR-22–28): la búsqueda arranca ya, en paralelo con la precarga, para que
    //     estén listos al abrir mpv. Si la reproducción termina antes, se aborta al soltarse.
    let subtitles_found = if player_kind == PlayerKind::Mpv
        && !slot.background
        && cfg.subtitles.language != SubtitleLanguage::None
    {
        Some(
            prefetch_subtitles(
                shared,
                slot,
                engine.as_ref(),
                handle,
                &metadata,
                &file,
                cfg.subtitles.language,
            )
            .await,
        )
    } else {
        None
    };

    // 4. Precarga exclusiva inicio (+ final en MP4) (FR-11). Al retomar, lo ya bajado se reusa.
    let plan = preload::plan(&file, &cfg.preload);
    shared.log(
        slot,
        format!(
            "precarga {:?}: {} rango(s)",
            plan.container,
            plan.ranges.len()
        ),
    );
    let progress_slot = slot.clone();
    let progress_shared = shared.clone();
    let on_progress = move |p: preload::PreloadProgress| {
        progress_slot.set_state(PlaybackState::Preparing {
            fraction: p.fraction,
        });
        progress_shared.emit_row(&progress_slot);
    };
    let outcome = preload::run(
        engine.as_ref(),
        handle,
        &plan,
        &cfg.preload,
        slot.cancel.clone(),
        true,
        &on_progress,
    )
    .await?;
    let preload_secs = slot.started.elapsed().as_secs_f32();
    match outcome {
        PreloadOutcome::Ready { elapsed } => shared.log(
            slot,
            format!("precarga lista en {:.1} s", elapsed.as_secs_f32()),
        ),
        PreloadOutcome::TimedOut { fraction, .. } => shared.log(
            slot,
            format!(
                "precarga incompleta ({:.0} %): abro el reproductor igual (plan B)",
                fraction * 100.0
            ),
        ),
    }
    slot.row.lock().expect("row").preload_secs = Some(preload_secs);
    if slot.background {
        background_download(shared, slot, engine.as_ref(), handle).await;
        return Ok(());
    }

    // 5. Reproductor (FR-09). Al retomar, mpv arranca unos segundos antes de donde se dejó.
    let url = engine.stream_url(handle, file.index).await?;
    let mut extra_args = Vec::new();
    if let Some(pos) = slot.resume_from.filter(|p| *p > RESUME_REWIND_SECS * 2.0) {
        extra_args.push(format!("--start={:.1}", pos - RESUME_REWIND_SECS));
    }
    // Subtítulos que vienen DENTRO del video (MKV "MULTi"): que mpv elija solo la pista del
    // idioma pedido, latino primero (Q-03). Si después llegan los de la app, los reemplazan.
    match cfg.subtitles.language {
        SubtitleLanguage::Es => extra_args.push("--slang=es-419,es-MX,es-AR,lat,spa,es".into()),
        SubtitleLanguage::En => extra_args.push("--slang=en,eng".into()),
        SubtitleLanguage::None => {}
    }
    // Audio elegido al reproducir (inglés / latino…). Con audio en español los subtítulos en
    // español arrancan ocultos: no hacen falta, y S los muestra.
    let audio = slot
        .audio
        .clone()
        .filter(|_| player_kind == PlayerKind::Mpv);
    let hide_subs = audio.as_ref().is_some_and(|a| a.is_spanish())
        && cfg.subtitles.language == SubtitleLanguage::Es;
    if let Some(a) = &audio {
        extra_args.extend(a.mpv_args());
        shared.log(
            slot,
            format!("audio elegido: {} ({})", a.code, a.mpv_args().join(" ")),
        );
    }
    if hide_subs {
        extra_args.push("--sub-visibility=no".into());
    }
    let launcher = PlayerLauncher::new(deps.paths.clone(), cfg.player.clone());
    let mut player = launcher
        .launch(LaunchRequest {
            kind: player_kind,
            url,
            title: file_display_name(&file.name),
            subtitle_files: Vec::new(),
            log_file: None,
            extra_args,
        })
        .await?;
    if let Err(e) = shared
        .cleanup
        .claim(&slot.dir, &OwnerRecord::now(engine.pid(), Some(player.pid)))
    {
        // Sin esto mpv queda huérfano (no muere con la app).
        let _ = player.kill().await;
        return Err(e);
    }
    shared.log(slot, format!("reproductor abierto (pid {})", player.pid));
    slot.set_state(PlaybackState::Playing);
    shared.emit_row(slot);
    if let Some(mpv) = &player.mpv {
        spawn_first_frame_watcher(shared.clone(), slot.clone(), mpv.events());
    }
    // 5b. Subtítulos (FR-22–28): la sesión carga en mpv lo que la búsqueda (3b) ya bajó o baje.
    let subtitles = match (&player.mpv, subtitles_found) {
        (Some(mpv), Some(found)) => Some(spawn_subtitles(
            shared,
            slot,
            mpv.clone(),
            found,
            cfg.subtitles.language,
            hide_subs,
        )),
        _ => None,
    };

    // 6. Mientras se ve: stats al panel cada 1 s, posición para retomar y muestras de calibración.
    //    Termina cuando se cierra el reproductor o se detiene.
    let playing_since = Instant::now();
    let mut calibration = CalibrationSampler::default();
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    let exit = loop {
        tokio::select! {
            status = player.wait_exit() => break Some(status),
            _ = slot.cancel.cancelled() => break None,
            _ = tick.tick() => {
                // Con límite: un motor trabado no debe tapar el cierre del reproductor ni "Detener".
                if let Ok(Ok(stats)) = tokio::time::timeout(STATS_TIMEOUT, engine.stats(handle)).await {
                    let download_paused = {
                        let mut row = slot.row.lock().expect("row");
                        row.progress = stats.progress;
                        row.speed_bps = stats.download_speed_bps;
                        row.peers = stats.peers;
                        row.state == PlaybackState::DownloadPaused
                    };
                    calibration.push(playing_since.elapsed(), &stats, download_paused);
                    shared.emit_row(slot);
                }
                if let Some(mpv) = &player.mpv {
                    if let Ok(Ok(v)) = tokio::time::timeout(Duration::from_millis(500), mpv.get_property("time-pos")).await {
                        if let Some(pos) = v.as_f64() {
                            *slot.position.lock().expect("position") = Some(pos);
                        }
                    }
                }
            }
        }
    };
    if let Some(task) = subtitles {
        task.abort();
    }
    let closed_by_user = exit.is_some();
    // mpv que sale con error sin haber mostrado imagen = no pudo abrir el video: no preguntar.
    let failed_to_open = player_kind == PlayerKind::Mpv
        && slot
            .row
            .lock()
            .expect("row")
            .time_to_first_frame_secs
            .is_none()
        && matches!(&exit, Some(Ok(status)) if !status.success());
    if failed_to_open {
        let code = match &exit {
            Some(Ok(status)) => status.code().map_or("?".into(), |c| c.to_string()),
            _ => "?".into(),
        };
        let message = format!("mpv no pudo abrir el video (código {code})");
        shared.log(slot, message.clone());
        shared.status(StatusLevel::Error, message.clone());
        slot.set_state(PlaybackState::Failed { message });
        shared.emit_row(slot);
    } else if closed_by_user {
        shared.log(slot, "reproductor cerrado".into());
    } else if slot.keep_player.load(Ordering::Relaxed) {
        shared.log(
            slot,
            "app cerrada: el reproductor sigue con lo que tiene en caché (Q-10)".into(),
        );
    } else {
        shared.log(slot, "detenido desde la app".into());
        let _ = player.kill().await;
    }
    if let Some(actual_bps) = calibration.sustained() {
        shared
            .record_calibration(slot, req.key.info_hash, actual_bps)
            .await;
    }
    // 7. Reproductor cerrado sin terminar de bajar: ¿seguir bajando de fondo o pausar? (2026-11-14)
    if closed_by_user && !failed_to_open && slot.row.lock().expect("row").progress < 0.999 {
        slot.set_state(PlaybackState::AskAfterClose);
        shared.emit_row(slot);
        if wait_answer(&slot.keep_downloading, &slot.cancel, ASK_TIMEOUT).await {
            background_download(shared, slot, engine.as_ref(), handle).await;
        } else {
            shared.log(slot, "la descarga queda pausada y guardada".into());
        }
    }
    Ok(())
}

/// Sigue bajando sin reproductor hasta completar el video o hasta "Detener" (queda pausada).
async fn background_download(
    shared: &Arc<Shared>,
    slot: &Arc<Slot>,
    engine: &dyn TorrentEngine,
    handle: TorrentHandle,
) {
    shared.log(slot, "sigue bajando de fondo, sin reproductor".into());
    slot.set_state(PlaybackState::Background);
    shared.emit_row(slot);
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    loop {
        tokio::select! {
            _ = slot.cancel.cancelled() => {
                shared.log(slot, "descarga de fondo detenida: queda pausada y guardada".into());
                return;
            }
            _ = tick.tick() => {
                let Ok(Ok(stats)) = tokio::time::timeout(STATS_TIMEOUT, engine.stats(handle)).await else { continue };
                {
                    let mut row = slot.row.lock().expect("row");
                    row.progress = stats.progress;
                    row.speed_bps = stats.download_speed_bps;
                    row.peers = stats.peers;
                }
                shared.emit_row(slot);
                if stats.progress >= 0.999 {
                    shared.log(slot, "descarga completa: queda guardada para verla sin esperar".into());
                    shared.status(StatusLevel::Info, format!("Terminó de bajar {}", slot.row.lock().expect("row").name));
                    return;
                }
            }
        }
    }
}

/// Corre `fut` salvo que el usuario detenga antes.
async fn cancellable<T>(
    slot: &Slot,
    fut: impl std::future::Future<Output = Result<T>>,
) -> Result<T> {
    tokio::select! {
        r = fut => r,
        _ = slot.cancel.cancelled() => Err(CoreError::Cancelled),
    }
}

fn file_display_name(path: &str) -> String {
    path.rsplit(['/', '\\']).next().unwrap_or(path).to_string()
}

fn spawn_engine_log_forwarder(
    shared: Arc<Shared>,
    slot: Arc<Slot>,
    engine: &dyn TorrentEngine,
    handle: TorrentHandle,
) {
    let mut events = engine.subscribe();
    tokio::spawn(async move {
        loop {
            match events.recv().await {
                Ok(EngineEvent::Log {
                    handle: Some(h),
                    line,
                }) if h == handle => shared.log(&slot, line),
                Ok(EngineEvent::Error {
                    handle: Some(h),
                    message,
                }) if h == handle => shared.log(&slot, format!("motor: {message}")),
                Ok(EngineEvent::Exited { .. })
                | Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                _ => {}
            }
        }
    });
}

/// Arma lo que la búsqueda de subtítulos necesita (archivos del torrent y el video por el stream
/// del motor, identidad del video) y la lanza ya, sin mpv ([`subtitles::session::prefetch`]).
async fn prefetch_subtitles(
    shared: &Arc<Shared>,
    slot: &Arc<Slot>,
    engine: &dyn TorrentEngine,
    handle: TorrentHandle,
    metadata: &Metadata,
    file: &FileInfo,
    language: SubtitleLanguage,
) -> subtitles::session::Prefetch {
    // El hash lee 64 KiB del principio y del final por este stream; durante la precarga el final
    // puede no estar todavía: lo acota `HASH_TIMEOUT` y se busca igual sin hash.
    let video_url = engine.stream_url(handle, file.index).await.ok();
    // Los .srt/.ass del torrent se leen por el stream del motor: el stream pide solo esas
    // piezas (con rqbit y webtorrent), sin cambiar la selección del video.
    let mut torrent_files = Vec::new();
    for f in subtitles::subtitle_files_for(metadata, file) {
        if let Ok(url) = engine.stream_url(handle, f.index).await {
            torrent_files.push(subtitles::providers::TorrentSubtitleFile { name: f.name, url });
        }
    }
    let mut video = subtitles::VideoIdentity::for_file(
        &file.name,
        &metadata.name,
        metadata.info_hash,
        file.size,
    );
    let key = slot.row.lock().expect("row").key;
    let origin = shared
        .deps
        .library
        .lock()
        .await
        .get(&key)
        .and_then(|e| e.origin.clone());
    video.apply_catalog(origin.as_ref(), file.index);
    let paths = &shared.deps.paths;
    // Con el video, en su carpeta (lo del análisis ya vino adentro al adoptarla). Lo pedido
    // desde el catálogo antes de reproducir se mueve acá, salvo que ya haya guardados.
    let video_id = video.video_id();
    let cache_dir = crate::paths::AppPaths::video_subtitles_dir(&slot.dir, &video_id);
    let pending = paths.pending_subtitles_dir(&video_id);
    if pending.is_dir() && !cache_dir.exists() {
        if let Some(parent) = cache_dir.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Err(e) = std::fs::rename(&pending, &cache_dir) {
            tracing::warn!("no se pudieron mover los subtítulos del catálogo: {e}");
        }
    }
    let fetch = subtitles::session::Fetch {
        video,
        video_url,
        torrent_files,
        language,
        cache_dir,
        remembered: None, // la completa `prefetch` desde la memoria (FR-28)
        opensubtitles: true,
        log: subtitles_log(shared, slot),
    };
    subtitles::session::prefetch(fetch, &key, &paths.subtitles_memory_file())
}

/// Lanza la sesión de subtítulos en mpv con la búsqueda ya en marcha. Termina sola cuando mpv
/// se cierra.
fn spawn_subtitles(
    shared: &Arc<Shared>,
    slot: &Arc<Slot>,
    mpv: Arc<dyn crate::player::MpvControl>,
    found: subtitles::session::Prefetch,
    language: SubtitleLanguage,
    start_hidden: bool,
) -> tokio::task::JoinHandle<()> {
    let key = slot.row.lock().expect("row").key;
    let request = subtitles::session::SessionRequest {
        mpv,
        key,
        found,
        language,
        start_hidden,
        memory_file: shared.deps.paths.subtitles_memory_file(),
        log: subtitles_log(shared, slot),
    };
    tokio::spawn(subtitles::session::run(request))
}

fn subtitles_log(shared: &Arc<Shared>, slot: &Arc<Slot>) -> subtitles::session::LogFn {
    let (shared, slot) = (shared.clone(), slot.clone());
    Arc::new(move |line| shared.log(&slot, line))
}

fn spawn_first_frame_watcher(
    shared: Arc<Shared>,
    slot: Arc<Slot>,
    mut events: tokio::sync::broadcast::Receiver<MpvEvent>,
) {
    tokio::spawn(async move {
        loop {
            match events.recv().await {
                Ok(MpvEvent::FirstFrame) => {
                    let secs = slot.started.elapsed().as_secs_f32();
                    slot.row.lock().expect("row").time_to_first_frame_secs = Some(secs);
                    shared.log(&slot, format!("primera imagen a los {secs:.1} s"));
                    shared.emit_row(&slot);
                    break;
                }
                Ok(MpvEvent::Shutdown) | Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    break
                }
                _ => {}
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn al_cerrar_el_reproductor_sigue_bajando_solo_si_se_eligio() {
        let answer = tokio::sync::Notify::new();
        let cancel = CancellationToken::new();
        // "Seguir bajando" (aunque llegue antes de empezar a esperar: el permiso queda guardado).
        answer.notify_one();
        assert!(wait_answer(&answer, &cancel, Duration::from_secs(5)).await);
        // Sin respuesta: se pausa como antes.
        assert!(!wait_answer(&answer, &cancel, Duration::from_millis(30)).await);
        // "Pausar" (= Detener) o cerrar la app: se pausa.
        cancel.cancel();
        assert!(!wait_answer(&answer, &cancel, Duration::from_secs(5)).await);
    }
}
