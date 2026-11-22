//! La cola del analizador: una única tarea de fondo que recibe comandos por canal (NFR-10),
//! con un [`Job`] por hash pedido, y que vuelca lo medido en `library`.
//!
//! Todo el estado de un hash vive en su `Job` (etapa, forzado, solo rápido, reintentos). Lo que
//! se deriva de ahí se deriva en un solo lugar: "ya está pedido" (`jobs.contains_key`), lo que ve
//! la UI ([`Queue::report`]) y el "N de M" ([`Queue::counters`]). (2026-11-15: antes eran siete
//! colecciones sincronizadas a mano y los contadores y la pausa de uno se desfasaban.)

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::subs::{Prefetched, SubsCtx};
use super::{
    AnalyzeScope, AnalyzerDeps, AnalyzerState, MeasureCtl, Measurer, ProgressSink, QuickInfo,
    QuickSink, SpeedProgress,
};
use crate::engine::FilePick;
use crate::events::{CoreEvent, StatusLevel};
use crate::library::{settled_status, EntryStatus, LiveMeasurement};
use crate::magnet::{InfoHash, Magnet};
use crate::{CoreError, Result};

#[derive(Debug)]
pub(super) enum Command {
    Enqueue(AnalyzeScope),
    Pause,
    Resume,
    Cancel,
    /// "Listo": terminar la medición de velocidad en curso con lo medido.
    Finish,
    /// Pausar solo este (2026-11-14): sale de turno; si se estaba midiendo, guarda lo parcial.
    PauseOne(InfoHash),
    /// Reanudar solo este: vuelve a la cola.
    ResumeOne(InfoHash),
    /// "Reiniciar análisis" (2026-11-14, el usuario: "se bugeó y quería mandarlo de nuevo"):
    /// lo saca de la cola / pausa / medición en curso y lo vuelve a pedir desde cero.
    Restart {
        hash: InfoHash,
        quick: bool,
    },
    /// Olvidar este (se quitó de la lista): sale de la cola y, si se está midiendo, se corta.
    CancelOne(InfoHash),
}

/// Por qué se cortó la medición en curso.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stop {
    /// Pausa general, o pausar y reanudar este antes de que terminara de cortarse: vuelve al
    /// frente de la cola (lo parcial queda guardado).
    Requeue,
    /// Cancelar (todo o este solo): se suelta.
    Cancel,
    /// Pausa de este solo: queda retenido hasta que se reanude.
    Hold,
    /// "Reiniciar análisis": lo medido se descarta y se vuelve a pedir.
    Restart { quick: bool },
}

struct Running {
    cancel: CancellationToken,
    finish: CancellationToken,
    stop: Option<Stop>,
    task: tokio::task::JoinHandle<Result<LiveMeasurement>>,
}

enum Stage {
    /// Pedido, todavía sin scrape.
    Pending,
    /// Scrapeado, esperando turno para medir la velocidad.
    Queued,
    /// Midiéndose (de a uno). No está en `Queue::order`.
    Running(Running),
    /// Pausado uno por uno (2026-11-14): fuera de turno hasta "Reanudar".
    Held,
}

struct Job {
    stage: Stage,
    /// "Re-analizar uno": se mide aunque el tracker diga 0 seeders.
    forced: bool,
    /// [`AnalyzeScope::QuickOnly`]: tras la fase rápida no entra a la medición.
    quick_only: bool,
    /// Intentos fallidos (reintento automático, FR-08 / NFR-12).
    failures: u32,
}

pub(super) struct Queue {
    deps: AnalyzerDeps,
    measurer: Arc<dyn Measurer>,
    /// Todo lo pedido y no terminado, uno por hash.
    jobs: HashMap<InfoHash, Job>,
    /// Orden de los que no se están midiendo; el primer `Queued` es el próximo a medir.
    order: VecDeque<InfoHash>,
    paused: bool,
    /// Terminados de la tanda actual (el total se deriva, ver [`Queue::counters`]).
    done: usize,
    last_state: Option<AnalyzerState>,
    last_queue: Option<(Vec<InfoHash>, Vec<InfoHash>)>,
    /// Subtítulos ya pedidos al analizar en esta sesión (uno por magnet).
    subs: Prefetched,
}

impl Queue {
    pub(super) fn new(deps: AnalyzerDeps, measurer: Arc<dyn Measurer>) -> Self {
        Self {
            deps,
            measurer,
            jobs: HashMap::new(),
            order: VecDeque::new(),
            paused: false,
            done: 0,
            last_state: None,
            last_queue: None,
            subs: Prefetched::default(),
        }
    }

    pub(super) async fn run(mut self, mut rx: mpsc::Receiver<Command>) {
        loop {
            if !self.paused && self.running().is_none() {
                if self
                    .jobs
                    .values()
                    .any(|j| matches!(j.stage, Stage::Pending))
                {
                    let batch = self.scrape_pending().await;
                    // Fase rápida en paralelo; los comandos que llegan mientras tanto se atienden después.
                    let buffered = self.quick_pending(batch, &mut rx).await;
                    for cmd in buffered {
                        self.handle(cmd).await;
                    }
                    while let Ok(cmd) = rx.try_recv() {
                        self.handle(cmd).await;
                    }
                    continue;
                }
                self.start_next().await;
            }
            self.report();

            let wake = {
                let finished = async {
                    match self.running_mut() {
                        Some((_, run)) => (&mut run.task).await,
                        None => std::future::pending().await,
                    }
                };
                tokio::select! {
                    cmd = rx.recv() => Wake::Command(cmd),
                    joined = finished => Wake::Finished(joined.unwrap_or_else(|e| {
                        Err(CoreError::Engine(format!("medición abortada: {e}")))
                    })),
                }
            };
            match wake {
                Wake::Command(Some(cmd)) => self.handle(cmd).await,
                Wake::Command(None) => break, // la app se cerró
                Wake::Finished(result) => self.finish_current(result).await,
            }
        }
        if let Some((_, run)) = self.running_mut() {
            run.cancel.cancel();
            let _ = (&mut run.task).await;
        }
    }

    async fn handle(&mut self, cmd: Command) {
        match cmd {
            Command::Enqueue(scope) => self.enqueue(scope).await,
            Command::Pause => {
                self.paused = true;
                self.stop_running(None, Stop::Requeue);
            }
            Command::Resume => self.paused = false,
            Command::Finish => {
                if let Some((_, run)) = self.running_mut() {
                    run.finish.cancel();
                }
            }
            Command::PauseOne(hash) => {
                if self.stop_running(Some(hash), Stop::Hold) {
                    return; // guarda lo parcial; finish_current lo retiene
                }
                if let Some(job) = self.jobs.get_mut(&hash) {
                    if matches!(job.stage, Stage::Pending | Stage::Queued) {
                        job.stage = Stage::Held;
                        self.settle(&[hash]).await;
                    }
                }
            }
            Command::ResumeOne(hash) => {
                let quick_only = match self.jobs.get_mut(&hash) {
                    // Pausado y reanudado antes de que la medición terminara de cortarse: vuelve
                    // al frente al cortarse, sin un segundo clic.
                    Some(Job {
                        stage: Stage::Running(run),
                        ..
                    }) => {
                        if run.stop == Some(Stop::Hold) {
                            run.stop = Some(Stop::Requeue);
                        }
                        return;
                    }
                    Some(job) if matches!(job.stage, Stage::Held) => {
                        job.forced = true;
                        job.quick_only
                    }
                    _ => return,
                };
                let scraped = self
                    .deps
                    .library
                    .lock()
                    .await
                    .any_of(&hash)
                    .is_some_and(|e| e.scrape.is_some());
                // La fase rápida sale del scrape: un "solo rápido" vuelve a pasar por ahí.
                let stage = if scraped && !quick_only {
                    Stage::Queued
                } else {
                    Stage::Pending
                };
                self.place(hash, stage, false);
            }
            Command::Restart { hash, quick } => {
                if !self.stop_running(Some(hash), Stop::Restart { quick }) {
                    self.drop_job(hash);
                    self.settle(&[hash]).await;
                    self.enqueue(restart_scope(hash, quick)).await;
                }
            }
            Command::CancelOne(hash) => {
                if !self.stop_running(Some(hash), Stop::Cancel) && self.drop_job(hash) {
                    self.settle(&[hash]).await;
                }
            }
            Command::Cancel => {
                let dropped: Vec<InfoHash> = self.order.drain(..).collect();
                for hash in &dropped {
                    self.jobs.remove(hash);
                }
                self.settle(&dropped).await;
                self.stop_running(None, Stop::Cancel);
                self.paused = false;
            }
        }
    }

    /// Corta la medición en curso (la de `hash`, o cualquiera con `None`) por `stop`.
    /// Devuelve `false` si no había una que cortar.
    fn stop_running(&mut self, hash: Option<InfoHash>, stop: Stop) -> bool {
        let Some((running, run)) = self.running_mut() else {
            return false;
        };
        if hash.is_some_and(|h| h != running) {
            return false;
        }
        run.stop = match (run.stop, stop) {
            (Some(Stop::Cancel), _) => Some(Stop::Cancel), // cancelar gana siempre
            (Some(old), Stop::Requeue) => Some(old),       // la pausa general no pisa algo puntual
            _ => Some(stop),
        };
        run.cancel.cancel();
        true
    }

    async fn enqueue(&mut self, scope: AnalyzeScope) {
        let quick_only = matches!(scope, AnalyzeScope::QuickOnly(_) | AnalyzeScope::Pasted(_));
        let (hashes, forced) = {
            let library = self.deps.library.lock().await;
            match scope {
                AnalyzeScope::All => (library.hashes(), false),
                AnalyzeScope::OnlyUnmeasured => (library.unmeasured(), false),
                AnalyzeScope::One(h) | AnalyzeScope::QuickOnly(h) => (
                    library
                        .any_of(&h)
                        .map(|e| vec![e.info_hash])
                        .unwrap_or_default(),
                    true,
                ),
                AnalyzeScope::Pasted(hs) => (
                    hs.into_iter()
                        .filter(|h| library.any_of(h).is_some_and(|e| e.live.is_none()))
                        .collect(),
                    false,
                ),
                AnalyzeScope::Selected(hs) => (
                    hs.into_iter().filter(|h| library.has_torrent(h)).collect(),
                    true,
                ),
            }
        };
        for hash in hashes {
            match self.jobs.get_mut(&hash) {
                // Ya en cola, midiéndose o pausado uno por uno: pedirlo de nuevo no hace nada
                // (2026-11-14, contra el doble clic; pausado se sigue con `ResumeOne`). Un pedido
                // completo después de uno rápido (aún pendiente) sí mide la velocidad.
                Some(job) => job.quick_only &= quick_only,
                None => {
                    self.jobs.insert(
                        hash,
                        Job {
                            stage: Stage::Pending,
                            forced,
                            quick_only,
                            failures: 0,
                        },
                    );
                    self.order.push_back(hash);
                }
            }
        }
    }

    /// Scrape en lote de todo lo pendiente (FR-05) y pasa a la cola de medición, mejores primero.
    /// Devuelve lo que entró a la cola (para la fase rápida).
    async fn scrape_pending(&mut self) -> Vec<InfoHash> {
        let hashes = self.in_order(|s| matches!(s, Stage::Pending));
        self.order.retain(|h| !hashes.contains(h));
        self.set_state(AnalyzerState::Scraping {
            total: hashes.len(),
        });
        self.update_entries(&hashes, |e| e.status = EntryStatus::Scraping)
            .await;

        let cfg = self.deps.config.read().await.clone();
        let results = self.measurer.scrape(&hashes, &cfg).await;

        let mut to_measure: Vec<(InfoHash, Option<u32>, Job)> = Vec::new();
        let mut quick_only: Vec<InfoHash> = Vec::new();
        let mut library = self.deps.library.lock().await;
        for hash in hashes {
            // Sale de `jobs`; vuelve solo si se va a medir.
            let Some(job) = self.jobs.remove(&hash) else {
                continue;
            };
            let scrape = results.get(&hash).cloned();
            let seeders = scrape.as_ref().map(|s| s.seeders);
            let updated = library.update_torrent(&hash, |e| {
                if scrape.is_some() {
                    e.scrape = scrape.clone();
                }
                e.status = settled_status(e);
            });
            if updated.is_empty() {
                continue; // la quitaron mientras tanto
            }
            library.emit_rows(&updated, self.deps.events.as_ref());
            // FR-06: se miden los que tienen seeders. Sin respuesta de ningún tracker también se
            // mide (los trackers pueden no conocerlo; ADR-09: manda la medición en vivo).
            if job.quick_only {
                quick_only.push(hash);
            } else if job.forced || seeders != Some(0) {
                to_measure.push((hash, seeders, job));
            }
        }
        drop(library);
        // Más seeders primero: lo prometedor se mide antes (sin dato al final).
        to_measure.sort_by_key(|t| std::cmp::Reverse(t.1));
        let mut queued = Vec::with_capacity(to_measure.len());
        for (hash, _, mut job) in to_measure {
            job.stage = Stage::Queued;
            self.jobs.insert(hash, job);
            self.order.push_back(hash);
            queued.push(hash);
        }
        queued.into_iter().chain(quick_only).collect()
    }

    /// Fase rápida (2026-11-13): en paralelo y casi sin ancho de banda, nombre real, tamaño,
    /// duración real y seeds/peers conectados. La velocidad se mide después, de a uno.
    /// Pausa/cancelación la cortan; los demás comandos se devuelven para atenderlos después.
    async fn quick_pending(
        &mut self,
        hashes: Vec<InfoHash>,
        rx: &mut mpsc::Receiver<Command>,
    ) -> Vec<Command> {
        let mut buffered = Vec::new();
        let magnets: Vec<(Magnet, FilePick)> = {
            let library = self.deps.library.lock().await;
            hashes
                .iter()
                .filter_map(|h| {
                    let e = library.any_of(h)?;
                    Some((Magnet::parse(&e.magnet).ok()?, e.file_pick()))
                })
                .collect()
        };
        if magnets.is_empty() {
            return buffered;
        }
        self.set_state(AnalyzerState::QuickScan {
            total: magnets.len(),
        });
        let cfg = self.deps.config.read().await.clone();
        let cancel = CancellationToken::new();
        let (library, events) = (self.deps.library.clone(), self.deps.events.clone());
        let handle = tokio::runtime::Handle::current();
        let subs = self.subs_ctx();
        let sink: QuickSink = Arc::new(move |hash, info: QuickInfo| {
            let (library, events, subs) = (library.clone(), events.clone(), subs.clone());
            handle.spawn(async move {
                let mut lib = library.lock().await;
                let keys = lib.update_torrent(&hash, |e| apply_quick(e, &info));
                lib.emit_rows(&keys, events.as_ref());
                drop(lib);
                subs.prefetch(hash); // ya se sabe qué video es: a buscar subtítulos
            });
        });
        let quick = self.measurer.quick(magnets, &cfg, cancel.clone(), sink);
        tokio::pin!(quick);
        loop {
            tokio::select! {
                _ = &mut quick => break,
                cmd = rx.recv() => match cmd {
                    Some(c @ (Command::Pause | Command::Cancel)) => {
                        cancel.cancel();
                        buffered.push(c);
                    }
                    Some(c) => buffered.push(c),
                    None => {
                        cancel.cancel();
                        break;
                    }
                },
            }
        }
        buffered
    }

    async fn start_next(&mut self) {
        while let Some(pos) = self.order.iter().position(|h| {
            self.jobs
                .get(h)
                .is_some_and(|j| matches!(j.stage, Stage::Queued))
        }) {
            let Some(hash) = self.order.remove(pos) else {
                return;
            };
            let (magnet, pick, scorer) = {
                let library = self.deps.library.lock().await;
                let e = library.any_of(&hash);
                (
                    e.map(|e| Magnet::parse(&e.magnet)),
                    e.map(|e| e.file_pick()).unwrap_or_default(),
                    library.live_scorer(&hash),
                )
            };
            let magnet = match magnet {
                None => {
                    self.jobs.remove(&hash); // la quitaron de la lista
                    continue;
                }
                Some(Err(e)) => {
                    self.fail(hash, e.user_message()).await;
                    continue;
                }
                Some(Ok(m)) => m,
            };
            self.update_entries(&[hash], |e| e.status = EntryStatus::Measuring)
                .await;
            let cfg = self.deps.config.read().await.clone();
            let cancel = CancellationToken::new();
            let finish = CancellationToken::new();
            let measurer = self.measurer.clone();
            // Velocidad en vivo para la tarjeta (≈ X / Y Mbps · N s), su × provisorio y el
            // botón "Listo". shortcut: el × usa tamaño/duración de las filas al arrancar; si la
            // medición los cambia, el puntaje final (al terminar) ya los tiene.
            let (done, total) = self.counters();
            let events = self.deps.events.clone();
            let progress: ProgressSink = Arc::new(move |live: SpeedProgress| {
                events.emit(CoreEvent::AnalyzerProgress {
                    state: AnalyzerState::Measuring {
                        done,
                        total,
                        current: Some(hash),
                        live: Some(live),
                        provisional: scorer.score(live.speed_bps),
                    },
                });
            });
            let ctl = MeasureCtl {
                cancel: cancel.clone(),
                finish: finish.clone(),
                progress,
            };
            let Some(job) = self.jobs.get_mut(&hash) else {
                continue;
            };
            let task =
                tokio::spawn(async move { measurer.measure(&magnet, pick, &cfg, ctl).await });
            job.stage = Stage::Running(Running {
                cancel,
                finish,
                stop: None,
                task,
            });
            return;
        }
    }

    async fn finish_current(&mut self, result: Result<LiveMeasurement>) {
        let Some((hash, run)) = self.running_mut() else {
            return;
        };
        let stop = run.stop;
        match (result, stop) {
            (_, Some(Stop::Restart { quick })) => {
                // Se descarta y se pide de nuevo.
                self.drop_job(hash);
                self.settle(&[hash]).await;
                self.enqueue(restart_scope(hash, quick)).await;
            }
            (Ok(measurement), stop) => {
                let partial = measurement.partial;
                // Una medición completa vale aunque haya llegado justo con el corte.
                match stop.filter(|_| partial) {
                    // Pausa: se guarda lo parcial y al reanudar se completa la medición.
                    Some(Stop::Requeue) => self.place(hash, Stage::Queued, true),
                    // Pausa de este solo: queda retenido hasta "Reanudar".
                    Some(Stop::Hold) => self.place(hash, Stage::Held, false),
                    Some(_) => {
                        self.drop_job(hash);
                    }
                    None => {
                        self.done += 1;
                        self.drop_job(hash);
                    }
                }
                if let Some(job) = self.jobs.get_mut(&hash) {
                    job.failures = 0;
                }
                self.update_entries(&[hash], move |e| {
                    if e.torrent_name.is_none() {
                        e.torrent_name = measurement.torrent_name.clone();
                    }
                    e.video_size = Some(measurement.file_size);
                    // Una medición parcial nunca pisa una completa anterior.
                    let keep_old = partial
                        && e.live
                            .as_ref()
                            .is_some_and(|old| !old.partial && old.avg_speed_bps > 0.0);
                    if !keep_old {
                        let mut new = measurement.clone();
                        // La duración real puede venir de la fase rápida: no perderla.
                        if new.duration_secs.is_none() {
                            new.duration_secs = e.live.as_ref().and_then(|old| old.duration_secs);
                        }
                        if new.audio.is_none() {
                            new.audio = e.live.as_ref().and_then(|old| old.audio.clone());
                        }
                        if new.subs.is_none() {
                            new.subs = e.live.as_ref().and_then(|old| old.subs.clone());
                        }
                        if new.fps.is_none() {
                            new.fps = e.live.as_ref().and_then(|old| old.fps);
                        }
                        e.live = Some(new);
                    }
                    e.status = EntryStatus::Measured;
                })
                .await;
                self.subs_ctx().prefetch(hash);
            }
            (Err(_), Some(stop)) => {
                match stop {
                    // Vuelve al frente de la cola: al reanudar se mide de nuevo (FR-08).
                    Stop::Requeue => self.place(hash, Stage::Queued, true),
                    Stop::Hold => self.place(hash, Stage::Held, false),
                    Stop::Cancel | Stop::Restart { .. } => {
                        self.drop_job(hash);
                    }
                }
                self.settle(&[hash]).await;
            }
            (Err(e), None) => {
                let retries = self.deps.config.read().await.analyzer.retries;
                let failures = match self.jobs.get_mut(&hash) {
                    Some(job) => {
                        job.failures += 1;
                        job.failures
                    }
                    None => u32::MAX,
                };
                if failures <= retries {
                    tracing::warn!(%hash, intento = failures, "medición falló, reintento: {e}");
                    self.place(hash, Stage::Queued, true);
                } else {
                    tracing::warn!(%hash, "medición falló definitivamente: {e}");
                    self.fail(hash, e.user_message()).await;
                }
            }
        }
    }

    /// Terminó sin medir (definitivamente): cuenta como hecho y la fila lo dice.
    async fn fail(&mut self, hash: InfoHash, reason: String) {
        self.done += 1;
        self.drop_job(hash);
        self.deps.events.emit(CoreEvent::Status {
            level: StatusLevel::Warn,
            message: format!("No se pudo medir un torrent: {reason}"),
        });
        self.update_entries(&[hash], move |e| {
            e.status = EntryStatus::Failed {
                reason: reason.clone(),
            }
        })
        .await;
    }

    /// Vuelve las entradas a su estado "quieto" (lo medido no se pierde).
    async fn settle(&mut self, hashes: &[InfoHash]) {
        self.update_entries(hashes, |e| e.status = settled_status(e))
            .await;
    }

    async fn update_entries<F>(&self, hashes: &[InfoHash], f: F)
    where
        F: Fn(&mut crate::library::LibraryEntry) + Clone,
    {
        let mut library = self.deps.library.lock().await;
        for hash in hashes {
            let keys = library.update_torrent(hash, f.clone());
            library.emit_rows(&keys, self.deps.events.as_ref());
        }
    }

    fn report(&mut self) {
        // Qué está en cola (en el orden en que se va a medir) y qué está pausado uno por uno,
        // para la tarjeta de cada magnet.
        let queued: Vec<InfoHash> = self
            .in_order(|s| matches!(s, Stage::Queued))
            .into_iter()
            .chain(self.in_order(|s| matches!(s, Stage::Pending)))
            .collect();
        let snapshot = (queued, self.in_order(|s| matches!(s, Stage::Held)));
        if self.last_queue.as_ref() != Some(&snapshot) {
            self.deps.events.emit(CoreEvent::AnalyzerQueue {
                queued: snapshot.0.clone(),
                held: snapshot.1.clone(),
            });
            self.last_queue = Some(snapshot);
        }
        let (done, total) = self.counters();
        let state = if self.paused {
            AnalyzerState::Paused { done, total }
        } else if let Some(current) = self.running() {
            AnalyzerState::Measuring {
                done,
                total,
                current: Some(current),
                live: None,
                provisional: Vec::new(),
            }
        } else {
            AnalyzerState::Idle
        };
        self.set_state(state);
    }

    fn set_state(&mut self, state: AnalyzerState) {
        if self.last_state.as_ref() != Some(&state) {
            self.last_state = Some(state.clone());
            self.deps.events.emit(CoreEvent::AnalyzerProgress { state });
        }
    }
}

/// Estado derivado de `jobs`.
impl Queue {
    /// "N de M" de la tanda: terminados y total = terminados + en cola + midiéndose (lo pausado
    /// uno por uno y lo todavía sin scrape no cuentan). Único lugar donde la tanda se reinicia:
    /// cuando no queda nada pedido, en cola ni midiéndose.
    fn counters(&mut self) -> (usize, usize) {
        let (mut active, mut pending) = (0, false);
        for job in self.jobs.values() {
            match job.stage {
                Stage::Queued | Stage::Running(_) => active += 1,
                Stage::Pending => pending = true,
                Stage::Held => {}
            }
        }
        if active == 0 && !pending {
            self.done = 0;
        }
        (self.done, self.done + active)
    }

    fn running(&self) -> Option<InfoHash> {
        self.jobs
            .iter()
            .find_map(|(h, j)| matches!(j.stage, Stage::Running(_)).then_some(*h))
    }

    fn running_mut(&mut self) -> Option<(InfoHash, &mut Running)> {
        self.jobs.iter_mut().find_map(|(h, j)| match &mut j.stage {
            Stage::Running(run) => Some((*h, run)),
            _ => None,
        })
    }

    /// Los hashes en `order` cuya etapa cumple `want`, en orden.
    fn in_order(&self, want: fn(&Stage) -> bool) -> Vec<InfoHash> {
        self.order
            .iter()
            .copied()
            .filter(|h| self.jobs.get(h).is_some_and(|j| want(&j.stage)))
            .collect()
    }

    /// Pone un job existente en `stage` (no `Running`), al frente o al fondo de `order`.
    fn place(&mut self, hash: InfoHash, stage: Stage, front: bool) {
        let Some(job) = self.jobs.get_mut(&hash) else {
            return;
        };
        job.stage = stage;
        self.order.retain(|h| *h != hash);
        if front {
            self.order.push_front(hash);
        } else {
            self.order.push_back(hash);
        }
    }

    /// Olvida un hash; `false` si no estaba.
    fn drop_job(&mut self, hash: InfoHash) -> bool {
        self.order.retain(|h| *h != hash);
        self.jobs.remove(&hash).is_some()
    }

    fn subs_ctx(&self) -> SubsCtx {
        SubsCtx {
            paths: self.deps.paths.clone(),
            config: self.deps.config.clone(),
            library: self.deps.library.clone(),
            started: self.subs.clone(),
        }
    }
}

enum Wake {
    Command(Option<Command>),
    Finished(Result<LiveMeasurement>),
}

fn restart_scope(hash: InfoHash, quick: bool) -> AnalyzeScope {
    if quick {
        AnalyzeScope::QuickOnly(hash)
    } else {
        AnalyzeScope::One(hash)
    }
}

/// Aplica la fase rápida a una entrada sin pisar una velocidad ya medida.
fn apply_quick(e: &mut crate::library::LibraryEntry, info: &QuickInfo) {
    if e.torrent_name.is_none() {
        e.torrent_name = info.torrent_name.clone();
    }
    e.video_size = Some(info.file.size);
    match &mut e.live {
        Some(live) => {
            live.peers = info.peers;
            live.seeds = info.seeds;
            if info.duration_secs.is_some() {
                live.duration_secs = info.duration_secs;
            }
            if info.audio.is_some() {
                live.audio = info.audio.clone();
            }
            if info.subs.is_some() {
                live.subs = info.subs.clone();
            }
            if info.fps.is_some() {
                live.fps = info.fps;
            }
        }
        None => {
            e.live = Some(LiveMeasurement {
                measured_at: chrono::Utc::now(),
                torrent_name: info.torrent_name.clone(),
                file_index: info.file.index,
                file_name: info.file.name.clone(),
                file_size: info.file.size,
                peers: info.peers,
                seeds: info.seeds,
                partial: false,
                measured_secs: 0.0,
                avg_speed_bps: 0.0, // todavía sin velocidad: la mide la fase 2
                max_speed_bps: 0.0,
                duration_secs: info.duration_secs,
                audio: info.audio.clone(),
                subs: info.subs.clone(),
                fps: info.fps,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;

    use tokio::time::Instant;

    use async_trait::async_trait;

    use crate::analyzer::{AnalyzerHandle, MeasurePhase};
    use crate::config::Config;
    use crate::events::EventSink;
    use crate::library::Library;
    use crate::paths::AppPaths;
    use crate::trackers::ScrapeResult;

    use std::sync::Mutex;

    /// Medición del Fake: velocidad = 1er byte × 1 MB/s; la parcial siempre 100 kB/s.
    fn live_of(hash: InfoHash, partial: bool) -> LiveMeasurement {
        LiveMeasurement {
            measured_at: chrono::Utc::now(),
            torrent_name: None,
            file_index: 0,
            file_name: "video.mkv".into(),
            file_size: 1_000_000_000,
            peers: 3,
            seeds: 1,
            partial,
            measured_secs: 15.0,
            avg_speed_bps: if partial {
                100_000.0
            } else {
                f64::from(hash.as_bytes()[0]) * 1e6
            },
            max_speed_bps: 0.0,
            duration_secs: Some(888.0),
            audio: None,
            subs: None,
            fps: None,
        }
    }

    /// Medidor falso: scrape con seeders = 1er byte del hash; medición que tarda `delay`,
    /// falla las primeras `fail_first` veces y devuelve velocidad = 1er byte × 1 MB/s.
    /// Con `partial` activo, al cortarlo (pausa) o al "terminar ya" devuelve lo medido hasta ahí.
    struct Fake {
        partial: AtomicBool,
        delay: Duration,
        fail_first: Mutex<u32>,
        measured: Mutex<Vec<InfoHash>>,
        quicked: Mutex<Vec<InfoHash>>,
    }

    #[async_trait]
    impl Measurer for Fake {
        async fn scrape(&self, hashes: &[InfoHash], _: &Config) -> HashMap<InfoHash, ScrapeResult> {
            hashes
                .iter()
                .map(|h| {
                    (
                        *h,
                        ScrapeResult {
                            seeders: u32::from(h.as_bytes()[0]),
                            leechers: 1,
                            completed: 0,
                            trackers_ok: 1,
                            scraped_at: chrono::Utc::now(),
                        },
                    )
                })
                .collect()
        }
        async fn quick(
            &self,
            magnets: Vec<(Magnet, FilePick)>,
            _: &Config,
            _: CancellationToken,
            _: QuickSink,
        ) {
            let mut q = self.quicked.lock().unwrap();
            q.extend(magnets.iter().map(|(m, _)| m.info_hash));
        }
        async fn measure(
            &self,
            magnet: &Magnet,
            _: FilePick,
            _: &Config,
            ctl: MeasureCtl,
        ) -> Result<LiveMeasurement> {
            (ctl.progress)(SpeedProgress::phase(MeasurePhase::Connecting));
            tokio::select! {
                _ = tokio::time::sleep(self.delay) => {}
                _ = ctl.finish.cancelled() => {
                    return Ok(live_of(magnet.info_hash, true));
                }
                _ = ctl.cancel.cancelled() => {
                    if self.partial.load(Ordering::SeqCst) {
                        return Ok(live_of(magnet.info_hash, true));
                    }
                    return Err(CoreError::Cancelled);
                }
            }
            let should_fail = {
                let mut left = self.fail_first.lock().unwrap();
                let fail = *left > 0;
                *left = left.saturating_sub(1);
                fail
            };
            if should_fail {
                return Err(CoreError::Engine("falla simulada".into()));
            }
            self.measured.lock().unwrap().push(magnet.info_hash);
            Ok(live_of(magnet.info_hash, false))
        }
    }

    #[derive(Default)]
    struct Sink(Mutex<Vec<CoreEvent>>);
    impl EventSink for Sink {
        fn emit(&self, event: CoreEvent) {
            self.0.lock().unwrap().push(event);
        }
    }

    struct Setup {
        handle: AnalyzerHandle,
        library: Arc<tokio::sync::Mutex<Library>>,
        fake: Arc<Fake>,
        sink: Arc<Sink>,
        root: std::path::PathBuf,
    }

    fn hash(b: u8) -> InfoHash {
        InfoHash::from_bytes([b; 20])
    }

    async fn setup(
        name: &str,
        seeders: &[u8],
        delay_ms: u64,
        fail_first: u32,
        retries: u32,
    ) -> Setup {
        let root =
            std::env::temp_dir().join(format!("streamonte-test-an-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let paths = AppPaths::under(&root);
        paths.ensure_dirs().unwrap();
        let mut library = Library::load(paths.library_file()).unwrap();
        for &s in seeders {
            let m = Magnet {
                info_hash: hash(s),
                display_name: Some(format!("t{s}")),
                trackers: vec![],
            };
            library.add_or_touch(&m, &m.to_uri());
        }
        let library = Arc::new(tokio::sync::Mutex::new(library));
        let mut cfg = Config::default();
        cfg.analyzer.retries = retries;
        // Sin búsquedas reales de subtítulos en las pruebas.
        cfg.subtitles.language = crate::config::SubtitleLanguage::None;
        let fake = Arc::new(Fake {
            partial: AtomicBool::new(false),
            delay: Duration::from_millis(delay_ms),
            fail_first: Mutex::new(fail_first),
            measured: Mutex::default(),
            quicked: Mutex::default(),
        });
        let sink = Arc::new(Sink::default());
        let handle = AnalyzerHandle::spawn_with(
            AnalyzerDeps {
                paths,
                config: Arc::new(tokio::sync::RwLock::new(cfg)),
                library: library.clone(),
                events: sink.clone(),
            },
            fake.clone(),
        );
        Setup {
            handle,
            library,
            fake,
            sink,
            root,
        }
    }

    impl Setup {
        async fn wait_idle(&self) {
            let deadline = Instant::now() + Duration::from_secs(10); // plazo virtual
            loop {
                tokio::time::sleep(Duration::from_millis(20)).await;
                let idle = matches!(
                    self.sink
                        .0
                        .lock()
                        .unwrap()
                        .iter()
                        .rev()
                        .find_map(|e| match e {
                            CoreEvent::AnalyzerProgress { state } => Some(state.clone()),
                            _ => None,
                        }),
                    Some(AnalyzerState::Idle)
                );
                let lib = self.library.lock().await;
                let busy = lib.hashes().iter().any(|h| {
                    matches!(
                        lib.any_of(h).unwrap().status,
                        EntryStatus::Scraping | EntryStatus::Measuring
                    )
                });
                if idle && !busy {
                    return;
                }
                assert!(Instant::now() < deadline, "el analizador no terminó");
            }
        }
        fn cleanup(&self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
        /// "N de M" de cada estado de progreso emitido, en orden.
        fn counters(&self) -> Vec<(usize, usize)> {
            self.sink
                .0
                .lock()
                .unwrap()
                .iter()
                .filter_map(|e| match e {
                    CoreEvent::AnalyzerProgress {
                        state:
                            AnalyzerState::Measuring { done, total, .. }
                            | AnalyzerState::Paused { done, total },
                    } => Some((*done, *total)),
                    _ => None,
                })
                .collect()
        }
        async fn wait_until(&self, what: &str, ok: impl Fn(&Self) -> bool) {
            let deadline = Instant::now() + Duration::from_secs(5);
            while !ok(self) {
                assert!(Instant::now() < deadline, "no pasó: {what}");
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }
    }

    #[tokio::test(start_paused = true)]
    async fn mide_los_que_tienen_seeders_mejores_primero() {
        let s = setup("order", &[2, 0, 9], 10, 0, 0).await;
        s.handle.enqueue(AnalyzeScope::All).await.unwrap();
        s.wait_idle().await;
        assert_eq!(*s.fake.measured.lock().unwrap(), vec![hash(9), hash(2)]);
        let lib = s.library.lock().await;
        assert_eq!(lib.any_of(&hash(9)).unwrap().status, EntryStatus::Measured);
        let sin = lib.any_of(&hash(0)).unwrap();
        assert_eq!(sin.status, EntryStatus::Scraped, "0 seeders: no se mide");
        assert_eq!(sin.scrape.as_ref().unwrap().seeders, 0);
        drop(lib);
        // Re-analizar uno lo mide aunque el tracker diga 0 seeders (FR-08).
        s.handle.enqueue(AnalyzeScope::One(hash(0))).await.unwrap();
        s.wait_idle().await;
        assert_eq!(s.fake.measured.lock().unwrap().len(), 3);
        s.cleanup();
    }

    #[tokio::test(start_paused = true)]
    async fn pausa_no_pierde_lo_medido_y_reanuda() {
        let s = setup("pause", &[1, 2, 3], 300, 0, 0).await;
        s.handle.enqueue(AnalyzeScope::All).await.unwrap();
        // Esperar a que termine el primero (hash 3) y pausar durante el segundo.
        let deadline = Instant::now() + Duration::from_secs(5);
        while s.fake.measured.lock().unwrap().is_empty() {
            assert!(Instant::now() < deadline);
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        s.handle.pause().await.unwrap();
        tokio::time::sleep(Duration::from_millis(600)).await;
        assert_eq!(s.fake.measured.lock().unwrap().len(), 1, "en pausa no mide");
        {
            let lib = s.library.lock().await;
            assert!(
                lib.any_of(&hash(3)).unwrap().live.is_some(),
                "lo medido queda"
            );
            assert_eq!(lib.any_of(&hash(2)).unwrap().status, EntryStatus::Scraped);
        }
        assert!(s.sink.0.lock().unwrap().iter().any(|e| matches!(
            e,
            CoreEvent::AnalyzerProgress {
                state: AnalyzerState::Paused { .. }
            }
        )));
        s.handle.resume().await.unwrap();
        s.wait_idle().await;
        assert_eq!(
            *s.fake.measured.lock().unwrap(),
            vec![hash(3), hash(2), hash(1)]
        );
        // "Analizar solo los no medidos" no vuelve a medir nada.
        s.handle
            .enqueue(AnalyzeScope::OnlyUnmeasured)
            .await
            .unwrap();
        s.wait_idle().await;
        assert_eq!(s.fake.measured.lock().unwrap().len(), 3);
        s.cleanup();
    }

    #[tokio::test(start_paused = true)]
    async fn pausar_uno_no_frena_a_los_demas_y_se_reanuda_solo() {
        // Orden por seeders: 9, 5, 1. Se pausa el 5 (en cola) mientras se mide el 9.
        let s = setup("hold", &[1, 5, 9], 200, 0, 0).await;
        s.handle.enqueue(AnalyzeScope::All).await.unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        s.handle.pause_one(hash(5)).await.unwrap();
        s.wait_idle().await;
        assert_eq!(
            *s.fake.measured.lock().unwrap(),
            vec![hash(9), hash(1)],
            "el 5 quedó pausado"
        );
        let held = s.sink.0.lock().unwrap().iter().rev().find_map(|e| match e {
            CoreEvent::AnalyzerQueue { held, .. } => Some(held.clone()),
            _ => None,
        });
        assert_eq!(
            held,
            Some(vec![hash(5)]),
            "la UI sabe que el 5 está pausado"
        );
        s.handle.resume_one(hash(5)).await.unwrap();
        s.wait_idle().await;
        assert_eq!(
            *s.fake.measured.lock().unwrap(),
            vec![hash(9), hash(1), hash(5)]
        );
        s.cleanup();
    }

    #[tokio::test(start_paused = true)]
    async fn analizar_seleccionados_mide_solo_esos() {
        let s = setup("selected", &[1, 5, 9], 5, 0, 0).await;
        s.handle
            .enqueue(AnalyzeScope::Selected(vec![hash(1), hash(5)]))
            .await
            .unwrap();
        s.wait_idle().await;
        let mut got = s.fake.measured.lock().unwrap().clone();
        got.sort();
        assert_eq!(got, vec![hash(1), hash(5)]);
        s.cleanup();
    }

    #[tokio::test(start_paused = true)]
    async fn pedir_de_nuevo_lo_que_ya_se_analiza_no_hace_nada_y_la_fase_llega_a_la_ui() {
        let s = setup("twice", &[5, 9], 300, 0, 0).await;
        s.handle.enqueue(AnalyzeScope::One(hash(5))).await.unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        // Doble clic, "Analizar todo" y "Análisis rápido" mientras se mide: el 5 no se repite.
        s.handle.enqueue(AnalyzeScope::One(hash(5))).await.unwrap();
        s.handle
            .enqueue(AnalyzeScope::QuickOnly(hash(5)))
            .await
            .unwrap();
        s.handle.enqueue(AnalyzeScope::All).await.unwrap();
        s.wait_idle().await;
        let mut got = s.fake.measured.lock().unwrap().clone();
        got.sort();
        assert_eq!(got, vec![hash(5), hash(9)], "cada uno una sola vez");
        // La fase ("conectando") viaja en el progreso de la medición.
        assert!(s.sink.0.lock().unwrap().iter().any(|e| matches!(
            e,
            CoreEvent::AnalyzerProgress {
                state: AnalyzerState::Measuring {
                    live: Some(SpeedProgress {
                        phase: MeasurePhase::Connecting,
                        ..
                    }),
                    ..
                }
            }
        )));
        // Pausado uno por uno: pedirlo de nuevo no lo reactiva; "Seguir analizando" sí.
        s.handle.enqueue(AnalyzeScope::One(hash(9))).await.unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        s.handle.pause_one(hash(9)).await.unwrap();
        s.wait_idle().await;
        s.handle.enqueue(AnalyzeScope::One(hash(9))).await.unwrap();
        s.wait_idle().await;
        assert_eq!(
            s.fake.measured.lock().unwrap().len(),
            2,
            "pausado: no se mide"
        );
        s.handle.resume_one(hash(9)).await.unwrap();
        s.wait_idle().await;
        assert_eq!(s.fake.measured.lock().unwrap().len(), 3);
        s.cleanup();
    }

    #[tokio::test(start_paused = true)]
    async fn reiniciar_corta_lo_que_se_mide_y_lo_pide_de_nuevo() {
        let s = setup("restart", &[5, 9], 300, 0, 0).await;
        s.handle.enqueue(AnalyzeScope::One(hash(5))).await.unwrap();
        tokio::time::sleep(Duration::from_millis(80)).await;
        // Trabado a mitad de medición: reiniciar lo corta (sin guardar) y lo mide de nuevo.
        s.handle.restart(hash(5), false).await.unwrap();
        s.wait_idle().await;
        assert_eq!(
            *s.fake.measured.lock().unwrap(),
            vec![hash(5)],
            "una sola medición completa"
        );
        // Pausado uno por uno: reiniciar lo saca de la pausa y lo vuelve a pedir.
        s.handle.enqueue(AnalyzeScope::One(hash(9))).await.unwrap();
        tokio::time::sleep(Duration::from_millis(80)).await;
        s.handle.pause_one(hash(9)).await.unwrap();
        s.wait_idle().await;
        s.handle.restart(hash(9), false).await.unwrap();
        s.wait_idle().await;
        assert_eq!(s.fake.measured.lock().unwrap().len(), 2);
        // Reiniciar solo el rápido: no mide velocidad.
        s.handle.restart(hash(9), true).await.unwrap();
        s.wait_idle().await;
        assert_eq!(s.fake.measured.lock().unwrap().len(), 2);
        assert!(s.fake.quicked.lock().unwrap().contains(&hash(9)));
        s.cleanup();
    }

    #[tokio::test(start_paused = true)]
    async fn analisis_rapido_no_mide_velocidad() {
        let s = setup("quick-only", &[0, 5], 5, 0, 0).await;
        // Forzado como `One`: también con 0 seeders en el tracker.
        s.handle
            .enqueue(AnalyzeScope::QuickOnly(hash(0)))
            .await
            .unwrap();
        s.wait_idle().await;
        assert_eq!(*s.fake.quicked.lock().unwrap(), vec![hash(0)]);
        assert!(s.fake.measured.lock().unwrap().is_empty(), "no mide");
        let st = s
            .library
            .lock()
            .await
            .any_of(&hash(0))
            .unwrap()
            .status
            .clone();
        assert_eq!(st, EntryStatus::Scraped);
        // "Medir velocidad" después sí mide.
        s.handle.enqueue(AnalyzeScope::One(hash(0))).await.unwrap();
        s.wait_idle().await;
        assert_eq!(*s.fake.measured.lock().unwrap(), vec![hash(0)]);
        s.cleanup();
    }

    #[tokio::test(start_paused = true)]
    async fn reintenta_y_despues_marca_fallido() {
        let s = setup("retry", &[5], 5, 2, 2).await;
        s.handle.enqueue(AnalyzeScope::All).await.unwrap();
        s.wait_idle().await;
        assert_eq!(
            s.library.lock().await.any_of(&hash(5)).unwrap().status,
            EntryStatus::Measured,
            "2 fallas + 2 reintentos → mide"
        );
        s.cleanup();

        let s = setup("retry-fail", &[5], 5, 10, 1).await;
        s.handle.enqueue(AnalyzeScope::All).await.unwrap();
        s.wait_idle().await;
        let status = s
            .library
            .lock()
            .await
            .any_of(&hash(5))
            .unwrap()
            .status
            .clone();
        assert!(matches!(status, EntryStatus::Failed { .. }), "{status:?}");
        s.cleanup();
    }
    #[tokio::test(start_paused = true)]
    async fn pausar_y_reanudar_rapido_lo_que_se_mide_basta_un_clic() {
        let s = setup("hold-race", &[5], 300, 0, 0).await;
        s.handle.enqueue(AnalyzeScope::One(hash(5))).await.unwrap();
        tokio::time::sleep(Duration::from_millis(80)).await;
        // "Reanudar" llega antes de que la medición termine de cortarse.
        s.handle.pause_one(hash(5)).await.unwrap();
        s.handle.resume_one(hash(5)).await.unwrap();
        s.wait_idle().await;
        assert_eq!(*s.fake.measured.lock().unwrap(), vec![hash(5)]);
        let held = s.sink.0.lock().unwrap().iter().rev().find_map(|e| match e {
            CoreEvent::AnalyzerQueue { held, .. } => Some(held.clone()),
            _ => None,
        });
        assert_eq!(held, Some(vec![]), "no quedó pausado");
        s.cleanup();
    }

    #[tokio::test(start_paused = true)]
    async fn contador_pausar_uno_en_cola_lo_saca_del_total() {
        // Orden por seeders: 9, 5, 1.
        let s = setup("cnt-hold", &[1, 5, 9], 200, 0, 0).await;
        s.handle.enqueue(AnalyzeScope::All).await.unwrap();
        s.wait_until("mide el 9", |s| s.counters().contains(&(0, 3)))
            .await;
        s.handle.pause_one(hash(5)).await.unwrap();
        s.wait_until("total baja", |s| s.counters().contains(&(0, 2)))
            .await;
        s.cleanup();
    }

    #[tokio::test(start_paused = true)]
    async fn contador_cancelar_en_pausa_reinicia_la_tanda() {
        let s = setup("cnt-cancel", &[1, 5, 9], 200, 0, 0).await;
        s.handle.enqueue(AnalyzeScope::All).await.unwrap();
        s.wait_until("mide el 9", |s| s.counters().contains(&(0, 3)))
            .await;
        s.handle.pause_one(hash(5)).await.unwrap();
        // Pausa general a mitad del 1: queda en cola, nada midiéndose.
        s.wait_until("mide el 1", |s| s.counters().contains(&(1, 2)))
            .await;
        s.handle.pause().await.unwrap();
        s.wait_until("pausado", |s| {
            s.sink.0.lock().unwrap().iter().any(|e| {
                matches!(
                    e,
                    CoreEvent::AnalyzerProgress {
                        state: AnalyzerState::Paused { done: 1, total: 2 }
                    }
                )
            })
        })
        .await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        // Cancelar sin nada midiéndose reinicia la tanda.
        s.handle.cancel().await.unwrap();
        s.wait_idle().await;
        let before = s.counters().len();
        s.handle.enqueue(AnalyzeScope::One(hash(1))).await.unwrap();
        s.wait_idle().await;
        assert_eq!(s.counters()[before], (0, 1), "tanda nueva: 0 de 1");
        s.cleanup();
    }

    #[tokio::test(start_paused = true)]
    async fn contador_pausar_el_ultimo_y_reanudar_es_0_de_1() {
        let s = setup("cnt-last", &[9], 200, 0, 0).await;
        s.handle.enqueue(AnalyzeScope::One(hash(9))).await.unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        s.handle.pause_one(hash(9)).await.unwrap();
        s.wait_idle().await;
        let before = s.counters().len();
        s.handle.resume_one(hash(9)).await.unwrap();
        s.wait_idle().await;
        // Nunca "0 de 0" ni "1 de 0".
        assert_eq!(s.counters()[before], (0, 1));
        s.cleanup();
    }

    #[tokio::test(start_paused = true)]
    async fn contador_reiniciar_lo_que_se_mide_no_lo_cuenta_dos_veces() {
        let s = setup("cnt-restart", &[9], 200, 0, 0).await;
        s.handle.enqueue(AnalyzeScope::One(hash(9))).await.unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        s.handle.restart(hash(9), false).await.unwrap();
        s.wait_idle().await;
        for (done, total) in s.counters() {
            assert!(done <= total && total <= 1, "{done} de {total}");
        }
        assert!(s.counters().iter().all(|c| *c != (0, 0)));
        s.cleanup();
    }

    /// Entrada de la biblioteca del hash dado.
    async fn entry(s: &Setup, h: InfoHash) -> crate::library::LibraryEntry {
        s.library.lock().await.any_of(&h).unwrap().clone()
    }

    #[tokio::test(start_paused = true)]
    async fn pausa_general_con_medicion_parcial_la_guarda_y_vuelve_al_frente() {
        // Orden por seeders: 9, 5. Se pausa a mitad del 9: queda primero, no el 5.
        let s = setup("part-requeue", &[5, 9], 300, 0, 0).await;
        s.fake.partial.store(true, Ordering::SeqCst);
        s.handle.enqueue(AnalyzeScope::All).await.unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        s.handle.pause().await.unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(entry(&s, hash(9)).await.live.unwrap().partial);
        s.fake.partial.store(false, Ordering::SeqCst);
        s.handle.resume().await.unwrap();
        s.wait_idle().await;
        assert_eq!(*s.fake.measured.lock().unwrap(), vec![hash(9), hash(5)]);
        assert!(
            !entry(&s, hash(9)).await.live.unwrap().partial,
            "se completó"
        );
        s.cleanup();
    }

    #[tokio::test(start_paused = true)]
    async fn pausar_uno_con_medicion_parcial_lo_retiene_con_lo_medido() {
        let s = setup("part-hold", &[5, 9], 300, 0, 0).await;
        s.fake.partial.store(true, Ordering::SeqCst);
        s.handle.enqueue(AnalyzeScope::All).await.unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        s.handle.pause_one(hash(9)).await.unwrap();
        s.wait_idle().await;
        assert_eq!(*s.fake.measured.lock().unwrap(), vec![hash(5)], "el 9 no");
        assert!(entry(&s, hash(9)).await.live.unwrap().partial);
        let held = s.sink.0.lock().unwrap().iter().rev().find_map(|e| match e {
            CoreEvent::AnalyzerQueue { held, .. } => Some(held.clone()),
            _ => None,
        });
        assert_eq!(held, Some(vec![hash(9)]), "retenido hasta Reanudar");
        s.cleanup();
    }

    #[tokio::test(start_paused = true)]
    async fn terminar_ya_guarda_lo_medido_y_cuenta_como_hecho() {
        let s = setup("finish", &[5], 300, 0, 0).await;
        s.handle.enqueue(AnalyzeScope::One(hash(5))).await.unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        s.handle.finish().await.unwrap();
        s.wait_idle().await;
        let e = entry(&s, hash(5)).await;
        assert!(e.live.unwrap().partial, "queda lo medido hasta ahí");
        assert_eq!(e.status, EntryStatus::Measured);
        assert!(s.fake.measured.lock().unwrap().is_empty(), "no se repite");
        s.cleanup();
    }

    #[tokio::test(start_paused = true)]
    async fn medicion_parcial_nunca_pisa_una_completa_anterior() {
        let s = setup("keep-old", &[5], 300, 0, 0).await;
        s.handle.enqueue(AnalyzeScope::One(hash(5))).await.unwrap();
        s.wait_idle().await;
        assert_eq!(entry(&s, hash(5)).await.live.unwrap().avg_speed_bps, 5e6);
        // Re-medir y cortar con parcial (100 kB/s): la completa de 5 MB/s se queda.
        s.fake.partial.store(true, Ordering::SeqCst);
        s.handle.enqueue(AnalyzeScope::One(hash(5))).await.unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        s.handle.pause_one(hash(5)).await.unwrap();
        s.wait_idle().await;
        let live = entry(&s, hash(5)).await.live.unwrap();
        assert!(!live.partial);
        assert_eq!(live.avg_speed_bps, 5e6);
        s.cleanup();
    }

    #[tokio::test(start_paused = true)]
    async fn apply_quick_fusiona_sin_pisar_la_velocidad_medida() {
        let s = setup("apply-quick", &[5], 5, 0, 0).await;
        let mut e = entry(&s, hash(5)).await;
        let info = QuickInfo {
            torrent_name: Some("peli".into()),
            file: crate::engine::FileInfo {
                index: 2,
                name: "peli.mkv".into(),
                size: 42,
                offset: 0,
            },
            peers: 7,
            seeds: 4,
            duration_secs: Some(100.0),
            audio: None,
            subs: None,
            fps: Some(24.0),
        };
        // Sin medición previa: crea la entrada rápida, sin velocidad.
        apply_quick(&mut e, &info);
        let live = e.live.clone().unwrap();
        assert_eq!(
            (live.avg_speed_bps, live.peers, live.file_index),
            (0.0, 7, 2)
        );
        assert_eq!(e.video_size, Some(42));
        // Con una medición completa previa: actualiza datos, la velocidad queda.
        e.live = Some(live_of(hash(5), false));
        apply_quick(&mut e, &info);
        let live = e.live.unwrap();
        assert_eq!(live.avg_speed_bps, 5e6);
        assert_eq!((live.peers, live.seeds, live.fps), (7, 4, Some(24.0)));
        s.cleanup();
    }

    #[tokio::test(start_paused = true)]
    async fn cancelar_uno_solo_corta_ese() {
        // Orden por seeders: 9, 5, 1. Se cancela el 9 (midiéndose) y el 1 (en cola).
        let s = setup("cancel-one", &[1, 5, 9], 200, 0, 0).await;
        s.handle.enqueue(AnalyzeScope::All).await.unwrap();
        s.wait_until("mide el 9", |s| s.counters().contains(&(0, 3)))
            .await;
        s.handle.cancel_one(hash(9)).await.unwrap();
        s.handle.cancel_one(hash(1)).await.unwrap();
        s.wait_idle().await;
        assert_eq!(*s.fake.measured.lock().unwrap(), vec![hash(5)]);
        s.cleanup();
    }
}
