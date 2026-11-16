//! Fastresume: lo ya verificado en una carpeta no se vuelve a hashear entero (un archivo de
//! 60 GB tardaba más que el timeout de metadatos). librqbit guarda su bitfield en la carpeta de
//! estado de la instancia y lo borra al quitar el torrent; acá se lo conserva junto a los datos.

use std::path::{Path, PathBuf};

use librqbit::dht::Id20;

use crate::logger::DIAG_ENGINE;

/// Bitfield de piezas verificadas, junto a los datos: viaja con la carpeta (FR-06d).
pub(super) const BITV_FILE: &str = ".streamonte-piezas.bitv";

/// El bitfield de un torrent: donde lo busca librqbit y donde lo guardamos nosotros.
pub(super) struct Bitfield {
    state: PathBuf,
    dir: PathBuf,
}

impl Bitfield {
    /// Antes de agregar el torrent: pone el bitfield de la carpeta donde librqbit lo busca
    /// (mismo nombre que usa librqbit).
    pub(super) fn restore(state_dir: &Path, id: &Id20, download_dir: &Path) -> Self {
        let state = state_dir.join(format!("{id:?}.bitv"));
        let dir = download_dir.join(BITV_FILE);
        if dir.is_file() {
            link_or_copy(&dir, &state);
        }
        Self { state, dir }
    }

    /// Con el torrent ya inicializado: librqbit reescribe su bitfield tras un chequeo completo y
    /// lo borra al quitar el torrent: un enlace duro en la carpeta lo conserva (y sigue al día)
    /// para la próxima.
    pub(super) fn save(&self) {
        let _ = std::fs::remove_file(&self.dir);
        link_or_copy(&self.state, &self.dir);
    }
}

/// Enlace duro (mismo archivo: lo que librqbit escriba después también queda); si no se puede
/// (otro volumen), copia: queda una foto vieja pero segura (librqbit verifica una muestra).
fn link_or_copy(from: &Path, to: &Path) {
    if let Some(parent) = to.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::remove_file(to);
    if std::fs::hard_link(from, to).is_err() {
        if let Err(e) = std::fs::copy(from, to) {
            tracing::debug!(target: DIAG_ENGINE, "fastresume {from:?} → {to:?}: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::BITV_FILE;
    use crate::engine::rqbit::RqbitEmbedded;
    use crate::engine::{wait_metadata, AddOptions, RemoveOptions, TorrentEngine, TorrentSource};

    /// El bug de los 60 s: con el `.torrent` en caché y datos ya en la carpeta, librqbit
    /// re-hasheaba el archivo entero antes de dar "metadatos". Con el bitfield guardado no.
    #[tokio::test(flavor = "multi_thread")]
    async fn bitfield_guardado_evita_reverificar_lo_bajado() {
        let root =
            std::env::temp_dir().join(format!("streamonte-test-fastresume-{}", std::process::id()));
        let dir = root.join("datos");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&dir).unwrap();
        let data: Vec<u8> = (0..4 * 16384u32).map(|i| (i * 7 % 251) as u8).collect();
        std::fs::write(dir.join("video.bin"), &data).unwrap();
        let t = librqbit::create_torrent(
            &dir.join("video.bin"),
            librqbit::CreateTorrentOptions {
                name: None,
                trackers: vec![],
                piece_length: Some(16384),
            },
            &librqbit::spawn_utils::BlockingSpawner::new(1),
        )
        .await
        .unwrap();
        let torrent_file = root.join("cache.torrent");
        std::fs::write(&torrent_file, t.as_bytes().unwrap()).unwrap();
        let cfg = crate::config::EngineConfig::default();
        let opts = || AddOptions {
            trackers: vec![],
            download_dir: dir.clone(),
            initial_peers: Vec::new(),
        };
        let bitv = dir.join(BITV_FILE);

        // 1ª vez (sin bitfield): chequeo completo; el bitfield queda junto a los datos aunque
        // librqbit borre el suyo al quitar el torrent. 4 piezas → 1111_0000.
        let e = RqbitEmbedded::spawn(&cfg, root.join("rqbit"), None)
            .await
            .unwrap();
        let h = e
            .add(TorrentSource::TorrentFile(torrent_file.clone()), opts())
            .await
            .unwrap();
        wait_metadata(&e, h, 30).await.unwrap();
        e.remove(h, RemoveOptions { delete_data: false })
            .await
            .unwrap();
        e.shutdown().await.unwrap();
        assert_eq!(std::fs::read(&bitv).unwrap(), [0b1111_0000]);

        // 2ª vez con un bitfield que dice "nada": si librqbit re-verificara el disco volvería a
        // 1111_0000; con fastresume lo usa tal cual y no hashea el archivo.
        std::fs::write(&bitv, [0u8]).unwrap();
        let e = RqbitEmbedded::spawn(&cfg, root.join("rqbit"), None)
            .await
            .unwrap();
        let h = e
            .add(TorrentSource::TorrentFile(torrent_file), opts())
            .await
            .unwrap();
        wait_metadata(&e, h, 30).await.unwrap();
        assert_eq!(std::fs::read(&bitv).unwrap(), [0u8]);
        e.shutdown().await.unwrap();
        let _ = std::fs::remove_dir_all(&root);
    }
}
