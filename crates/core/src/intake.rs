//! `intake` — cómo entran los magnets a *Mis magnets* (FR-01, FR-02): pegar o arrastrar texto,
//! captura en vivo del portapapeles y "Leer portapapeles" (con o sin diálogo). Lo recién llegado
//! pasa en tandas a buscar su nombre real y, si la config lo pide, al análisis automático.

use std::sync::Arc;

use serde::Serialize;
use tokio::sync::{mpsc, Mutex, RwLock};

use crate::analyzer::{AnalyzeScope, AnalyzerHandle};
use crate::clipboard::{ClipboardMagnet, ClipboardSource, WatchGuard};
use crate::config::Config;
use crate::events::{CoreEvent, EventSink, StatusLevel};
use crate::library::{AddOutcome, Library};
use crate::magnet::{InfoHash, Magnet};
use crate::paths::AppPaths;
use crate::video_key::VideoKey;

/// Cuánto se juntan los magnets que llegan seguidos (pegar 5 juntos = una sola tanda).
const BATCH_WINDOW: std::time::Duration = std::time::Duration::from_millis(400);

/// Diálogo "Leer portapapeles": magnets encontrados para elegir (2026-11-14).
#[derive(Debug, Clone, Serialize)]
pub struct ClipboardPreview {
    pub items: Vec<ClipboardPreviewItem>,
    /// `false` → solo se vio el último copiado (Win+V apagado o macOS).
    pub history_available: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClipboardPreviewItem {
    #[serde(flatten)]
    pub magnet: ClipboardMagnet,
    /// Ya está en la lista.
    pub in_list: bool,
    /// Nombre real si ya lo conocemos (metadatos de una vez anterior).
    pub known_name: Option<String>,
}

/// Resultado de "Leer portapapeles" sin diálogo (FR-02, lectura al abrir la app).
#[derive(Debug, Clone, Serialize)]
pub struct ClipboardReadReport {
    pub added: usize,
    /// `false` → la UI avisa que Win+V está apagado o no existe en el SO.
    pub history_available: bool,
}

/// Entrada de magnets de la app: la biblioteca, el portapapeles del SO y la cola de recién
/// llegados (nombre real + análisis automático, ver [`spawn_batches`]).
#[derive(Clone)]
pub(crate) struct Intake {
    library: Arc<Mutex<Library>>,
    events: Arc<dyn EventSink>,
    clipboard: Arc<dyn ClipboardSource>,
    fresh: mpsc::UnboundedSender<Vec<Magnet>>,
}

impl Intake {
    pub(crate) fn spawn(
        paths: AppPaths,
        config: Arc<RwLock<Config>>,
        library: Arc<Mutex<Library>>,
        events: Arc<dyn EventSink>,
        analyzer: AnalyzerHandle,
        clipboard: Arc<dyn ClipboardSource>,
    ) -> Self {
        let fresh = spawn_batches(paths, config, library.clone(), events.clone(), analyzer);
        Self {
            library,
            events,
            clipboard,
            fresh,
        }
    }

    /// Agrega todos los magnets de un texto (pegar, arrastrar, captura en vivo; FR-01).
    /// Devuelve cuántos quedaron en "Pegados ahora" por este texto.
    pub(crate) async fn add_from_text(&self, text: &str) -> usize {
        self.add(&crate::magnet::extract_all_with_raw(text)).await
    }

    /// "Leer portapapeles" (FR-02): historial Win+V del más nuevo al más viejo hasta el primer
    /// no-magnet. Sin historial (apagado o macOS): solo el último copiado + aviso.
    pub(crate) async fn read_clipboard(&self) -> ClipboardReadReport {
        let crate::clipboard::ClipboardImport {
            magnets,
            unavailable,
        } = crate::clipboard::import(self.clipboard.as_ref()).await;
        if let Some(reason) = unavailable {
            self.events
                .emit(CoreEvent::ClipboardHistoryUnavailable { reason });
        }
        ClipboardReadReport {
            added: self.add(&magnets).await,
            history_available: unavailable.is_none(),
        }
    }

    /// Diálogo "Leer portapapeles" (2026-11-14): TODOS los magnets del historial Win+V con la
    /// hora en que se copiaron, para que el usuario elija cuáles agregar. Marca los que ya están.
    pub(crate) async fn clipboard_preview(&self) -> ClipboardPreview {
        let (items, unavailable) = crate::clipboard::scan_all(self.clipboard.as_ref()).await;
        let library = self.library.lock().await;
        let items = items
            .into_iter()
            .map(|m| {
                // Pegarlo agregaría la fila del torrent entero (no las de episodios).
                let in_list = library.get(&VideoKey::whole(m.info_hash)).is_some();
                ClipboardPreviewItem {
                    in_list,
                    known_name: library
                        .any_of(&m.info_hash)
                        .and_then(|e| e.torrent_name.clone()),
                    magnet: m,
                }
            })
            .collect();
        ClipboardPreview {
            items,
            history_available: unavailable.is_none(),
        }
    }

    /// Captura en vivo (FR-01): de cada texto copiado se extraen todos los magnets. Si el SO no
    /// lo permite, la app sigue (se puede pegar a mano) y queda anotado en el log (NFR-13).
    pub(crate) fn watch_clipboard(&self) -> Option<WatchGuard> {
        let (tx, mut rx) = mpsc::channel::<String>(64);
        let guard = match self.clipboard.watch(tx) {
            Ok(g) => g,
            Err(e) => {
                tracing::warn!("sin captura en vivo del portapapeles: {e}");
                return None;
            }
        };
        let intake = self.clone();
        tokio::spawn(async move {
            while let Some(text) = rx.recv().await {
                let magnets = crate::magnet::extract_all_with_raw(&text);
                if !magnets.is_empty() {
                    let n = intake.add(&magnets).await;
                    tracing::debug!(magnets = magnets.len(), nuevos = n, "portapapeles");
                }
            }
        });
        Some(guard)
    }

    /// Agrega magnets a la biblioteca y avisa a la UI. Devuelve cuántos quedaron en "Pegados
    /// ahora" por esta operación (nuevos o movidos desde "Anteriores").
    async fn add(&self, magnets: &[(Magnet, String)]) -> usize {
        let mut library = self.library.lock().await;
        let mut count = 0;
        let mut fresh = Vec::new();
        for (m, raw) in magnets {
            // `raw` = el magnet tal cual se copió ("Copiar magnet", FR-04).
            match library.add_or_touch(m, raw) {
                AddOutcome::AlreadyPresent => {}
                AddOutcome::Added | AddOutcome::MovedToPastedNow => {
                    count += 1;
                    let key = VideoKey::whole(m.info_hash);
                    if let Some(entry) = library.get(&key) {
                        if entry.torrent_name.is_none() || entry.live.is_none() {
                            fresh.push(m.clone());
                        }
                        library.emit_rows(&[key], self.events.as_ref());
                    }
                }
            }
        }
        if !fresh.is_empty() {
            let _ = self.fresh.send(fresh);
        }
        count
    }
}

/// Al pegar: 1) metadatos de todos a la vez para mostrar el nombre real en segundos (el `dn` de
/// Torrentio es genérico) y 2) si `analyzer.auto_on_paste`, análisis rápido de esos magnets.
/// Agrupa lo que llega en [`BATCH_WINDOW`].
fn spawn_batches(
    paths: AppPaths,
    config: Arc<RwLock<Config>>,
    library: Arc<Mutex<Library>>,
    events: Arc<dyn EventSink>,
    analyzer: AnalyzerHandle,
) -> mpsc::UnboundedSender<Vec<Magnet>> {
    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<Magnet>>();
    tokio::spawn(async move {
        while let Some(mut batch) = rx.recv().await {
            tokio::time::sleep(BATCH_WINDOW).await;
            while let Ok(more) = rx.try_recv() {
                batch.extend(more);
            }
            batch.dedup_by_key(|m| m.info_hash);
            let cfg = config.read().await.clone();
            let hashes: Vec<InfoHash> = batch.iter().map(|m| m.info_hash).collect();

            // 1. Nombres (en paralelo, sin bloquear la próxima tanda).
            let need_name: Vec<Magnet> = {
                let lib = library.lock().await;
                batch
                    .into_iter()
                    .filter(|m| {
                        lib.any_of(&m.info_hash)
                            .is_some_and(|e| e.torrent_name.is_none())
                    })
                    .collect()
            };
            if !need_name.is_empty() {
                events.emit(CoreEvent::Status {
                    level: StatusLevel::Info,
                    message: format!("Buscando el nombre de {} magnet(s)…", need_name.len()),
                });
                let (paths, cfg2, library, events) =
                    (paths.clone(), cfg.clone(), library.clone(), events.clone());
                let handle = tokio::runtime::Handle::current();
                tokio::spawn(async move {
                    crate::analyzer::fetch_names(
                        &paths,
                        &cfg2,
                        need_name,
                        move |hash, name, video_size| {
                            let (library, events) = (library.clone(), events.clone());
                            handle.spawn(async move {
                                let mut lib = library.lock().await;
                                let keys = lib.update_torrent(&hash, |e| {
                                    e.torrent_name = Some(name.clone());
                                    e.video_size = e.video_size.or(video_size);
                                });
                                lib.emit_rows(&keys, events.as_ref());
                            });
                        },
                    )
                    .await;
                });
            }

            // 2. Análisis automático (usa el `.torrent` en caché cuando ya llegó).
            if cfg.analyzer.auto_on_paste {
                if let Err(e) = analyzer.enqueue(AnalyzeScope::Pasted(hashes)).await {
                    tracing::warn!("análisis automático al pegar: {e}");
                }
            }
        }
    });
    tx
}
