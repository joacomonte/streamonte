//! Descargas pausadas y guardadas (FR-12/FR-12b): `<carpeta>/.streamonte-kept.json` con el minuto
//! donde se dejó de ver; sobreviven a cerrar la app (`load_kept`) y se retoman desde lo ya bajado.
//! También FR-06d: lo bajado al analizar se adopta (play) o reemplaza al de la pausada (retomar).

use std::path::PathBuf;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::cleanup::KEPT_FILE;
use crate::config::PlayerKind;
use crate::events::CoreEvent;
use crate::magnet::InfoHash;
use crate::video_key::{VideoKey, VideoPart};
use crate::Result;

use super::{PlaybackId, PlaybackRow, PlaybackState, Shared, Slot};

/// Lo que se guarda en `<carpeta>/.streamonte-kept.json` para retomar (también tras reabrir la app).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct KeptRecord {
    /// Qué video es. Los registros de antes no la traen: ver [`migrated_key`].
    #[serde(default)]
    key: Option<VideoKey>,
    info_hash: InfoHash,
    /// Magnet completo (con trackers) para volver a agregar el torrent.
    pub(super) magnet: String,
    pub(super) name: String,
    pub(super) file_index: usize,
    pub(super) position_secs: Option<f64>,
    progress: f32,
    pub(super) player: PlayerKind,
    saved_at: DateTime<Utc>,
    /// Audio elegido: al retomar se usa el mismo sin volver a preguntar.
    #[serde(default)]
    pub(super) audio: Option<crate::audio::AudioPick>,
}

pub(super) struct Kept {
    pub(super) record: KeptRecord,
    pub(super) dir: PathBuf,
    /// `record.key` ya resuelta (con la migración de los registros viejos).
    key: VideoKey,
}

impl Shared {
    /// Al abrir la app: las descargas pausadas de sesiones anteriores vuelven al panel (FR-12).
    /// Las de antes de la clave por video se migran ([`migrated_key`]) y se reescriben.
    pub(super) async fn load_kept(&self) {
        let Ok(entries) = std::fs::read_dir(self.deps.paths.downloads_dir()) else {
            return;
        };
        for dir in entries.filter_map(|e| e.ok()).map(|e| e.path()) {
            let file = dir.join(KEPT_FILE);
            let Ok(Some(mut record)) = crate::fsutil::read_json::<KeptRecord>(&file) else {
                continue;
            };
            let key = match record.key {
                Some(key) => key,
                None => {
                    let rows: Vec<VideoKey> = self
                        .deps
                        .library
                        .lock()
                        .await
                        .of_torrent(record.info_hash)
                        .map(|e| e.key)
                        .collect();
                    let key = migrated_key(&record, &rows);
                    record.key = Some(key);
                    if let Err(e) = crate::fsutil::write_json_atomic(&file, &record) {
                        tracing::warn!("no se pudo migrar {file:?}: {e}");
                    }
                    key
                }
            };
            let id = self.new_id();
            tracing::info!(?dir, name = record.name, %key, "descarga pausada recuperada");
            self.insert_kept(id, Kept { record, dir, key });
        }
    }

    /// FR-06d: si el análisis dejó datos de este hash, pasan a ser la carpeta de la reproducción
    /// (renombrar: sin copiar). No mientras se esté midiendo (la reserva falla).
    pub(super) fn adopt_analysis(&self, hash: &InfoHash, dir: &std::path::Path) -> bool {
        let analysis = self.deps.paths.analysis_dir(hash);
        if !analysis.is_dir() || !self.cleanup.try_reserve(&analysis) {
            return false;
        }
        let result = std::fs::rename(&analysis, dir);
        self.cleanup.release(&analysis);
        if let Err(e) = &result {
            tracing::warn!("no se pudo adoptar {analysis:?}: {e}");
        }
        result.is_ok()
    }

    /// FR-06d al RETOMAR una pausada: si después de pausar se midió la velocidad, lo bajado quedó
    /// en la carpeta del análisis. Si tiene más bytes del video que la pausada, su archivo
    /// reemplaza al de la pausada (son pedazos distintos del mismo archivo: no se pueden juntar).
    pub(super) fn merge_analysis(&self, hash: &InfoHash, kept_dir: &std::path::Path) -> bool {
        let analysis = self.deps.paths.analysis_dir(hash);
        if !analysis.is_dir() || !self.cleanup.try_reserve(&analysis) {
            return false;
        }
        let result = (|| -> std::io::Result<bool> {
            let Some((from, got)) = crate::fsutil::biggest_file(&analysis) else {
                return Ok(false);
            };
            let have = crate::fsutil::biggest_file(kept_dir).map_or(0, |(_, n)| n);
            if got <= have {
                return Ok(false);
            }
            let to = kept_dir.join(from.strip_prefix(&analysis).unwrap_or(&from));
            if let Some(parent) = to.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let _ = std::fs::remove_file(&to);
            std::fs::rename(&from, &to)?;
            tracing::info!(got, have, "retomo con lo bajado al analizar (FR-06d)");
            Ok(true)
        })();
        let merged = match result {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!("no se pudo reusar {analysis:?}: {e}");
                false
            }
        };
        if merged {
            let _ = std::fs::remove_dir_all(&analysis);
        }
        self.cleanup.release(&analysis);
        merged
    }

    /// La pausada de ESTE video (misma clave), nunca la de otro episodio del mismo torrent.
    pub(super) fn take_kept(&self, key: &VideoKey) -> Option<(PlaybackId, Kept)> {
        let mut kept = self.kept.lock().expect("kept");
        let id = kept
            .iter()
            .find(|(_, k)| k.key == *key)
            .map(|(id, _)| *id)?;
        kept.remove(&id).map(|k| (id, k))
    }

    pub(super) fn kept_info(&self, id: PlaybackId) -> Option<(VideoKey, PathBuf)> {
        self.kept
            .lock()
            .expect("kept")
            .get(&id)
            .map(|k| (k.key, k.dir.clone()))
    }

    fn insert_kept(&self, id: PlaybackId, kept: Kept) {
        let row = kept_row(id, &kept);
        self.kept.lock().expect("kept").insert(id, kept);
        self.deps.events.emit(CoreEvent::PlaybackUpdated { row });
    }

    /// "Borrar" una pausada: borra su carpeta y la saca del panel.
    pub(super) async fn delete_kept(&self, id: PlaybackId) -> Result<()> {
        let Some(kept) = self.kept.lock().expect("kept").remove(&id) else {
            return Ok(());
        };
        let freed = self.cleanup.remove_dir(&kept.dir).await?;
        tracing::info!(freed, name = kept.record.name, "descarga pausada borrada");
        self.deps.events.emit(CoreEvent::PlaybackRemoved { id });
        Ok(())
    }

    /// La reproducción terminó y quedó guardada: pasa de "activa" a "pausada" con el mismo id.
    /// Primero entra a `kept` y después sale de `slots`: quien espera con [`Self::wait_gone`]
    /// la encuentra pausada apenas deja de estar activa.
    pub(super) fn slot_to_kept(&self, slot: &Arc<Slot>) {
        let (id, key) = {
            let row = slot.row.lock().expect("row");
            (row.id, row.key)
        };
        let record = crate::fsutil::read_json::<KeptRecord>(&slot.dir.join(KEPT_FILE));
        if let Ok(Some(record)) = record {
            self.insert_kept(
                id,
                Kept {
                    record,
                    dir: slot.dir.clone(),
                    key,
                },
            );
            self.slots.lock().expect("slots").remove(&id);
        } else {
            self.slots.lock().expect("slots").remove(&id);
            self.deps.events.emit(CoreEvent::PlaybackRemoved { id });
        }
    }

    /// Guarda el registro para retomar la reproducción que se cierra (lo llama `teardown`).
    pub(super) fn save_kept(&self, slot: &Slot, file_index: usize, magnet: String) {
        let row = slot.row.lock().expect("row").clone();
        let record = KeptRecord {
            key: Some(row.key),
            info_hash: row.info_hash,
            magnet,
            name: row.name.clone(),
            file_index,
            position_secs: *slot.position.lock().expect("position"),
            progress: row.progress,
            player: row.player,
            saved_at: Utc::now(),
            audio: slot.audio.clone(),
        };
        if let Err(e) = crate::fsutil::write_json_atomic(&slot.dir.join(KEPT_FILE), &record) {
            tracing::warn!("no se pudo guardar la descarga pausada: {e}");
        }
    }
}

pub(super) fn kept_row(id: PlaybackId, k: &Kept) -> PlaybackRow {
    let r = &k.record;
    PlaybackRow {
        id,
        key: k.key,
        info_hash: r.info_hash,
        name: r.name.clone(),
        state: PlaybackState::Paused {
            position_secs: r.position_secs,
        },
        player: r.player,
        progress: r.progress,
        speed_bps: 0.0,
        peers: 0,
        seeds: 0,
        incoming_peers: 0,
        started_at: r.saved_at,
        metadata_secs: None,
        preload_secs: None,
        time_to_first_frame_secs: None,
    }
}

/// Registro pausado de antes de la clave por video: a qué fila de *Mis magnets* (`rows`, las de
/// su torrent) corresponde. Solo a una cuyo video coincida con lo guardado (episodio en el nombre
/// del archivo, o el mismo archivo); si no, al torrent entero (como antes, retoma su archivo).
fn migrated_key(r: &KeptRecord, rows: &[VideoKey]) -> VideoKey {
    rows.iter()
        .copied()
        .find(|k| match k.part {
            Some(VideoPart::Episode { season, episode }) => {
                crate::engine::names_episode(&r.name, season, episode)
            }
            Some(VideoPart::File(i)) => i == r.file_index,
            None => false,
        })
        .unwrap_or(VideoKey::whole(r.info_hash))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::Library;
    use crate::paths::AppPaths;
    use crate::playback::clock;
    use crate::playback::{PlaybackDeps, PlaybackManager};

    #[test]
    fn registro_de_pausada_ida_y_vuelta() {
        let r = KeptRecord {
            key: Some(VideoKey::whole(InfoHash::from_bytes([7; 20]))),
            info_hash: InfoHash::from_bytes([7; 20]),
            magnet: "magnet:?xt=urn:btih:0707070707070707070707070707070707070707".into(),
            name: "Pelicula.mkv".into(),
            file_index: 3,
            position_secs: Some(1234.5),
            progress: 0.4,
            player: PlayerKind::Mpv,
            saved_at: Utc::now(),
            audio: None,
        };
        let json = serde_json::to_string(&r).unwrap();
        let back: KeptRecord = serde_json::from_str(&json).unwrap();
        assert_eq!(back.file_index, 3);
        assert_eq!(back.position_secs, Some(1234.5));
        assert_eq!(back.key, r.key);
        let kept = Kept {
            key: back.key.unwrap(),
            record: back,
            dir: PathBuf::new(),
        };
        assert_eq!(
            kept_row(PlaybackId(9), &kept).state,
            PlaybackState::Paused {
                position_secs: Some(1234.5)
            }
        );
        assert_eq!(clock(3725.0), "1:02:05");
    }

    /// `.streamonte-kept.json` de antes de la clave por video: se lee y se asigna a la fila cuyo
    /// video coincide; si ninguna coincide, al torrent entero (nunca a otro episodio).
    #[test]
    fn registro_viejo_sin_clave_se_migra_a_su_video() {
        let hash = InfoHash::from_bytes([7; 20]);
        let old = format!(
            r#"{{"info_hash":"{}","magnet":"magnet:?xt=urn:btih:{}","name":"Show.S03E01.1080p.mkv",
            "file_index":4,"position_secs":61.0,"progress":0.2,"player":"mpv",
            "saved_at":"2026-11-01T10:00:00Z"}}"#,
            hash.to_hex(),
            hash.to_hex()
        );
        let r: KeptRecord = serde_json::from_str(&old).unwrap();
        assert_eq!(r.key, None);
        assert_eq!(r.file_index, 4);
        let e1 = VideoKey::new(hash, Some((3, 1)), None);
        let e2 = VideoKey::new(hash, Some((3, 2)), None);
        assert_eq!(migrated_key(&r, &[e2, e1]), e1);
        assert_eq!(migrated_key(&r, &[e2]), VideoKey::whole(hash));
        assert_eq!(
            migrated_key(&r, &[VideoKey::new(hash, None, Some(4))]),
            VideoKey::new(hash, None, Some(4))
        );
        assert_eq!(migrated_key(&r, &[]), VideoKey::whole(hash));
    }

    fn manager_under(root: &std::path::Path) -> PlaybackManager {
        let _ = std::fs::remove_dir_all(root);
        let paths = AppPaths::under(root);
        paths.ensure_dirs().unwrap();
        PlaybackManager::new(PlaybackDeps {
            paths: paths.clone(),
            config: Arc::default(),
            library: Arc::new(tokio::sync::Mutex::new(
                Library::load(paths.library_file()).unwrap(),
            )),
            events: Arc::new(crate::events::NullSink),
            calibration: Arc::new(crate::playback::Calibration::load(&paths)),
        })
    }

    fn kept_record(key: VideoKey, file_index: usize) -> KeptRecord {
        KeptRecord {
            key: Some(key),
            info_hash: key.info_hash,
            magnet: format!("magnet:?xt=urn:btih:{}", key.info_hash.to_hex()),
            name: format!("ep{file_index}.mkv"),
            file_index,
            position_secs: Some(600.0),
            progress: 0.5,
            player: PlayerKind::Mpv,
            saved_at: Utc::now(),
            audio: None,
        }
    }

    /// El bug del pack: con E1 pausado, pedir E2 (mismo info hash) NO retoma E1.
    #[tokio::test]
    async fn la_pausada_de_otro_episodio_no_se_retoma() {
        let root =
            std::env::temp_dir().join(format!("streamonte-test-keptkey-{}", std::process::id()));
        let manager = manager_under(&root);
        let shared = &manager.shared;
        let hash = InfoHash::from_bytes([3; 20]);
        let (e1, e2) = (
            VideoKey::new(hash, Some((3, 1)), None),
            VideoKey::new(hash, Some((3, 2)), None),
        );
        let id = shared.new_id();
        shared.insert_kept(
            id,
            Kept {
                record: kept_record(e1, 1),
                dir: root.join("e1"),
                key: e1,
            },
        );
        assert_eq!(
            manager.rows()[0].key,
            e1,
            "la fila pausada dice qué video es"
        );
        assert!(shared.take_kept(&e2).is_none());
        assert!(shared.take_kept(&VideoKey::whole(hash)).is_none());
        let (got, kept) = shared.take_kept(&e1).unwrap();
        assert_eq!((got, kept.record.file_index), (id, 1));
        assert!(shared.kept_info(id).is_none(), "ya no está pausada");
        // Nada activo: no hay nada que cerrar ni esperar.
        assert!(shared.pause_active().is_empty());
        assert!(shared.active_id_for(&e1).is_none());
        std::fs::remove_dir_all(root).unwrap();
    }

    /// FR-06d: dar play adopta lo bajado al analizar (sin copiar), pero no mientras se mide.
    #[test]
    fn play_adopta_la_carpeta_del_analisis() {
        let root =
            std::env::temp_dir().join(format!("streamonte-test-adopt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let paths = AppPaths::under(&root);
        paths.ensure_dirs().unwrap();
        let manager = PlaybackManager::new(PlaybackDeps {
            paths: paths.clone(),
            config: Arc::default(),
            library: Arc::new(tokio::sync::Mutex::new(
                Library::load(paths.library_file()).unwrap(),
            )),
            events: Arc::new(crate::events::NullSink),
            calibration: Arc::new(crate::playback::Calibration::load(&paths)),
        });
        let shared = &manager.shared;
        let hash = InfoHash::from_bytes([7; 20]);
        let analysis = paths.analysis_dir(&hash);
        let play_dir = paths.downloads_dir().join("play-1");

        // Sin análisis previo: nada que adoptar.
        assert!(!shared.adopt_analysis(&hash, &play_dir));

        std::fs::create_dir_all(analysis.join("Sintel")).unwrap();
        std::fs::write(analysis.join("Sintel").join("sintel.mp4"), b"cabecera").unwrap();
        // Midiendo (carpeta reservada): no se toca.
        assert!(shared.cleanup.try_reserve(&analysis));
        assert!(!shared.adopt_analysis(&hash, &play_dir));
        shared.cleanup.release(&analysis);

        assert!(shared.adopt_analysis(&hash, &play_dir));
        assert!(!analysis.exists());
        assert_eq!(
            std::fs::read(play_dir.join("Sintel").join("sintel.mp4")).unwrap(),
            b"cabecera"
        );

        // Retomar una pausada: el análisis posterior con MÁS bytes reemplaza su video.
        let kept = paths.downloads_dir().join("play-2");
        std::fs::create_dir_all(kept.join("Sintel")).unwrap();
        std::fs::write(kept.join("Sintel").join("sintel.mp4"), vec![1u8; 10_000]).unwrap();
        std::fs::write(kept.join(".streamonte-kept.json"), b"{}").unwrap();
        std::fs::create_dir_all(analysis.join("Sintel")).unwrap();
        std::fs::write(
            analysis.join("Sintel").join("sintel.mp4"),
            vec![2u8; 50_000],
        )
        .unwrap();
        assert!(shared.merge_analysis(&hash, &kept));
        assert!(!analysis.exists());
        assert_eq!(
            std::fs::read(kept.join("Sintel").join("sintel.mp4")).unwrap()[0],
            2
        );
        assert!(
            kept.join(".streamonte-kept.json").exists(),
            "el registro de la pausada queda"
        );
        // Con MENOS bytes que la pausada, no se toca nada.
        std::fs::create_dir_all(analysis.join("Sintel")).unwrap();
        std::fs::write(analysis.join("Sintel").join("sintel.mp4"), vec![3u8; 9_000]).unwrap();
        assert!(!shared.merge_analysis(&hash, &kept));
        assert_eq!(
            std::fs::read(kept.join("Sintel").join("sintel.mp4")).unwrap()[0],
            2
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
