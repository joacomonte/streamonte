//! Nombres al pegar (FR-01b): solo los metadatos de varios magnets a la vez, con un único motor.

use std::sync::Arc;

use super::pipeline::NAME_TIMEOUT;
use crate::cleanup::{Cleanup, OwnerRecord};
use crate::config::Config;
use crate::engine::{AddOptions, RemoveOptions, TorrentSource};
use crate::magnet::{InfoHash, Magnet};
use crate::paths::AppPaths;

/// Busca SOLO los metadatos de varios magnets a la vez, con un único motor (pedido del usuario:
/// "al pegar, que al toque aparezca el nombre real"; el `dn` de Torrentio es genérico).
/// No baja contenido (todo deseleccionado). Guarda el `.torrent` en caché (FR-13), así el
/// análisis y Reproducir arrancan sin esperar metadatos. Llama a `on_found(hash, nombre, tamaño
/// del video)` por cada uno que
/// resuelve, apenas resuelve. Todo lo creado se borra al terminar.
///
/// No usa los pasos de `pipeline` a propósito: siempre suma el magnet (no el `.torrent` en
/// caché), espera `engine.metadata` sin el diagnóstico de `wait_metadata` (un timeout acá no se
/// informa) y borra los datos al sacar el torrent.
pub async fn fetch_names(
    paths: &AppPaths,
    cfg: &Config,
    magnets: Vec<Magnet>,
    on_found: impl Fn(InfoHash, String, Option<u64>) + Send + Sync + 'static,
) {
    if magnets.is_empty() {
        return;
    }
    let engine = match crate::engine::create(&cfg.engine, paths).await {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!("nombres al pegar: no se pudo iniciar el motor: {e}");
            return;
        }
    };
    let cleanup = Cleanup::new(paths.clone());
    let on_found = Arc::new(on_found);
    let mut tasks = tokio::task::JoinSet::new();
    let mut dirs = Vec::new();
    for (n, magnet) in magnets.into_iter().enumerate() {
        let dir = paths.downloads_dir().join(format!(
            "{}-{}-n{n}",
            magnet.info_hash.to_hex(),
            std::process::id()
        ));
        if let Err(e) = std::fs::create_dir_all(&dir)
            .map_err(|e| e.to_string())
            .and_then(|_| {
                cleanup
                    .claim(&dir, &OwnerRecord::now(engine.pid(), None))
                    .map_err(|e| e.to_string())
            })
        {
            tracing::warn!("nombres al pegar: {e}");
            continue;
        }
        dirs.push(dir.clone());
        let engine = engine.clone();
        let on_found = on_found.clone();
        let cache = paths.torrent_cache_file(&magnet.info_hash);
        let trackers = cfg.all_trackers();
        tasks.spawn(async move {
            let hash = magnet.info_hash;
            let handle = engine
                .add(
                    TorrentSource::Magnet(magnet.with_trackers(&trackers)),
                    AddOptions {
                        trackers,
                        download_dir: dir,
                        initial_peers: Vec::new(),
                        download_bps: None,
                    },
                )
                .await
                .ok()?;
            let result = tokio::time::timeout(NAME_TIMEOUT, engine.metadata(handle)).await;
            let _ = engine
                .remove(handle, RemoveOptions { delete_data: true })
                .await;
            let metadata = result.ok()?.ok()?;
            if !cache.is_file() {
                metadata.save_torrent_cache(&cache);
            }
            if !metadata.name.is_empty() {
                let video_size = metadata.choose_file(None).ok().map(|f| f.size);
                on_found(hash, metadata.name.clone(), video_size);
            }
            Some(())
        });
    }
    let total = dirs.len();
    let mut found = 0;
    while let Some(r) = tasks.join_next().await {
        if matches!(r, Ok(Some(()))) {
            found += 1;
        }
    }
    let _ = engine.shutdown().await;
    for dir in dirs {
        let _ = cleanup.remove_dir(&dir).await;
    }
    tracing::info!(found, total, "nombres al pegar");
}
