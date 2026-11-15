//! `library` — lista + historial persistente, grupos y estados (FR-03, FR-04).
//! Persiste en `library.json` (escritura atómica, debounce ~500 ms desde `AppCore`).

use std::collections::BTreeMap;
use std::path::PathBuf;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::config::RankingConfig;
use crate::magnet::{InfoHash, Magnet};
use crate::ranking::{RankInput, RankScore};
use crate::trackers::ScrapeResult;
use crate::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Group {
    /// Copiados en esta sesión.
    PastedNow,
    /// De sesiones anteriores.
    Previous,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum EntryStatus {
    New,
    Scraping,
    Scraped,
    Measuring,
    Measured,
    Failed { reason: String },
}

/// Medición en vivo (FR-06).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LiveMeasurement {
    pub measured_at: DateTime<Utc>,
    /// Nombre completo del torrent según sus metadatos (el `dn` del magnet puede faltar o venir
    /// recortado). Agregado tras la validación de F3: el usuario quiere ver qué torrent copió.
    #[serde(default)]
    pub torrent_name: Option<String>,
    /// Archivo de video elegido (el más grande con extensión de video).
    pub file_index: usize,
    pub file_name: String,
    pub file_size: u64,
    /// Peers conectados (máximo durante la medición).
    pub peers: u32,
    /// Seeders conectados de verdad (tienen el archivo completo), máximo durante la medición.
    #[serde(default)]
    pub seeds: u32,
    /// Medición cortada (pausa/cancelación): los números valen, pero son menos precisos.
    #[serde(default)]
    pub partial: bool,
    /// Segundos de velocidad efectivamente medidos (precisión).
    #[serde(default)]
    pub measured_secs: f64,
    pub avg_speed_bps: f64,
    pub max_speed_bps: f64,
    /// Duración REAL (mpv sin ventana). `None` si no se pudo leer.
    pub duration_secs: Option<f64>,
    /// Pistas de audio leídas con mpv junto con la duración. `None` = todavía no se leyeron.
    #[serde(default)]
    pub audio: Option<Vec<crate::audio::AudioTrack>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LibraryEntry {
    pub info_hash: InfoHash,
    /// Magnet tal cual se copió (para "Copiar magnet", FR-04).
    pub magnet: String,
    /// `dn` del magnet (o el hash si no trae). Ojo: Torrentio y otros ponen nombres genéricos.
    pub name: String,
    /// Nombre real del torrent según sus metadatos; se busca apenas se pega el magnet.
    #[serde(default)]
    pub torrent_name: Option<String>,
    /// Tamaño del video (el archivo que se reproduciría), conocido apenas llegan los metadatos.
    #[serde(default)]
    pub video_size: Option<u64>,
    pub group: Group,
    pub status: EntryStatus,
    pub scrape: Option<ScrapeResult>,
    pub live: Option<LiveMeasurement>,
    /// Calculado al vuelo por `ranking`; no se persiste.
    #[serde(skip_deserializing)]
    pub score: Option<RankScore>,
    /// Idiomas de audio: de las pistas reales si ya se leyeron, si no adivinados por el nombre.
    /// Calculado al vuelo como `score`; no se persiste.
    #[serde(default, skip_deserializing)]
    pub languages: Vec<crate::audio::AudioLang>,
    /// Título limpio, año / episodio y calidad para la fila (FR-29b). Al vuelo; no se persiste.
    #[serde(default, skip_deserializing)]
    pub release: Option<ReleaseInfo>,
    /// Bytes del video ya en disco (análisis FR-06d o reproducción pausada). Lo llena
    /// `AppCore::library()` mirando el disco; no se persiste.
    #[serde(default, skip_deserializing)]
    pub downloaded_bytes: Option<u64>,
    pub added_at: DateTime<Utc>,
    pub last_copied_at: DateTime<Utc>,
    /// Si vino del catálogo (F4b, spec 09 §8.1): qué video es y qué archivo del torrent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<CatalogOrigin>,
}

/// De dónde salió una entrada agregada desde el catálogo (FR-49, FR-50).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CatalogOrigin {
    /// `tt…` o `tt…:T:E`.
    pub video_id: String,
    pub imdb_id: String,
    pub title: String,
    pub year: Option<String>,
    pub season: Option<u32>,
    pub episode: Option<u32>,
    /// Archivo del torrent (`fileIdx` del addon); `None` = resolver por SxxExx o el más grande.
    pub file_idx: Option<usize>,
    pub addons: Vec<String>,
}

impl LibraryEntry {
    /// Qué archivo medir / reproducir: el del catálogo si lo hay (FR-48, FR-49).
    pub fn file_pick(&self) -> crate::engine::FilePick {
        self.origin
            .as_ref()
            .map(|o| crate::engine::FilePick {
                index: o.file_idx,
                episode: o.season.zip(o.episode),
            })
            .unwrap_or_default()
    }

    /// ¿Ya tiene velocidad real medida? (la fase rápida sola no alcanza).
    pub fn speed_measured(&self) -> bool {
        self.live.as_ref().is_some_and(|l| l.avg_speed_bps > 0.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddOutcome {
    Added,
    /// Estaba en "Anteriores" y pasó a "Pegados ahora" (FR-03).
    MovedToPastedNow,
    /// Ya estaba en "Pegados ahora": no se duplica (FR-01).
    AlreadyPresent,
}

pub struct Library {
    path: PathBuf,
    entries: BTreeMap<InfoHash, LibraryEntry>,
    /// Umbrales y duraciones estimadas para el puntaje y el orden (FR-07). Lo fija `AppCore` desde la config.
    ranking: RankingConfig,
    /// Hay cambios sin guardar. `AppCore` guarda con debounce (~500 ms) mirando este flag.
    dirty: bool,
}

impl Library {
    /// Carga (o vacía si no existe). Llama a [`Library::start_session`].
    pub fn load(path: PathBuf) -> Result<Self> {
        // Se guarda como lista (más legible y estable que un mapa por hash).
        let list: Vec<LibraryEntry> = match crate::fsutil::read_json(&path) {
            Ok(list) => list.unwrap_or_default(),
            Err(crate::CoreError::Json { .. }) => {
                let moved = crate::fsutil::quarantine(&path)?;
                tracing::warn!(
                    ?moved,
                    "library.json inválido; se empieza con la lista vacía"
                );
                Vec::new()
            }
            Err(e) => return Err(e),
        };
        let entries = list.into_iter().map(|e| (e.info_hash, e)).collect();
        let mut library = Self {
            path,
            entries,
            ranking: RankingConfig::default(),
            dirty: false,
        };
        library.start_session();
        Ok(library)
    }

    pub fn save(&self) -> Result<()> {
        let list: Vec<&LibraryEntry> = self.entries.values().collect();
        crate::fsutil::write_json_atomic(&self.path, &list)
    }

    /// Guarda solo si hubo cambios; devuelve si guardó. Lo llama el debounce de `AppCore`.
    pub fn save_if_dirty(&mut self) -> Result<bool> {
        if !self.dirty {
            return Ok(false);
        }
        self.save()?;
        self.dirty = false;
        Ok(true)
    }

    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    /// Al abrir la app: todo pasa a "Anteriores" (FR-03). Un análisis que quedó a medias
    /// (la app se cerró midiendo) vuelve al último estado completo.
    pub fn start_session(&mut self) {
        for e in self.entries.values_mut() {
            e.group = Group::Previous;
            if matches!(e.status, EntryStatus::Scraping | EntryStatus::Measuring) {
                e.status = settled_status(e);
            }
        }
        self.rescore_all();
    }

    /// Cambia umbrales del semáforo / duraciones estimadas y recalcula todo (FR-07).
    pub fn set_ranking(&mut self, cfg: RankingConfig) {
        self.ranking = cfg;
        self.rescore_all();
    }

    /// Alta de un magnet copiado (FR-01, FR-03):
    /// - nuevo → "Pegados ahora";
    /// - estaba en "Anteriores" → pasa a "Pegados ahora" (conserva sus mediciones);
    /// - ya estaba en "Pegados ahora" → no se duplica.
    ///
    /// `raw` es el magnet tal cual se copió (para "Copiar magnet", FR-04).
    pub fn add_or_touch(&mut self, magnet: &Magnet, raw: &str) -> AddOutcome {
        let now = Utc::now();
        self.dirty = true;
        if let Some(entry) = self.entries.get_mut(&magnet.info_hash) {
            entry.last_copied_at = now;
            // Si antes no tenía nombre (magnet solo hash) y ahora sí, se aprovecha.
            if entry.name == magnet.info_hash.to_hex() {
                if let Some(dn) = &magnet.display_name {
                    entry.name = dn.clone();
                }
            }
            return if entry.group == Group::Previous {
                entry.group = Group::PastedNow;
                AddOutcome::MovedToPastedNow
            } else {
                AddOutcome::AlreadyPresent
            };
        }
        let mut entry = LibraryEntry {
            info_hash: magnet.info_hash,
            magnet: raw.trim().to_string(),
            name: magnet
                .display_name
                .clone()
                .unwrap_or_else(|| magnet.info_hash.to_hex()),
            torrent_name: None,
            video_size: None,
            group: Group::PastedNow,
            status: EntryStatus::New,
            scrape: None,
            live: None,
            score: None,
            languages: Vec::new(),
            release: None,
            downloaded_bytes: None,
            added_at: now,
            last_copied_at: now,
            origin: None,
        };
        derive(&mut entry, &self.ranking);
        self.entries.insert(magnet.info_hash, entry);
        AddOutcome::Added
    }

    pub fn get(&self, hash: &InfoHash) -> Option<&LibraryEntry> {
        self.entries.get(hash)
    }

    /// Modifica una entrada; devuelve la versión nueva (para emitir `LibraryEntryUpdated`).
    /// El puntaje se recalcula solo.
    pub fn update<F: FnOnce(&mut LibraryEntry)>(
        &mut self,
        hash: &InfoHash,
        f: F,
    ) -> Option<&LibraryEntry> {
        let entry = self.entries.get_mut(hash)?;
        f(entry);
        derive(entry, &self.ranking);
        self.dirty = true;
        Some(entry)
    }

    pub fn remove(&mut self, hash: &InfoHash) -> bool {
        let removed = self.entries.remove(hash).is_some();
        self.dirty |= removed;
        removed
    }

    pub fn clear(&mut self) {
        self.dirty |= !self.entries.is_empty();
        self.entries.clear();
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Todos los hashes (orden estable por hash).
    pub fn hashes(&self) -> Vec<InfoHash> {
        self.entries.keys().copied().collect()
    }

    /// Entradas de un grupo, en el orden por defecto de `ranking` (FR-07).
    pub fn list(&self, group: Group) -> Vec<&LibraryEntry> {
        let entries: Vec<&LibraryEntry> =
            self.entries.values().filter(|e| e.group == group).collect();
        let inputs: Vec<RankInput> = entries.iter().map(|e| rank_input(e)).collect();
        crate::ranking::default_order(&inputs, &self.ranking)
            .into_iter()
            .map(|i| entries[i])
            .collect()
    }

    pub fn unmeasured(&self) -> Vec<InfoHash> {
        self.entries
            .values()
            .filter(|e| !e.speed_measured())
            .map(|e| e.info_hash)
            .collect()
    }

    fn rescore_all(&mut self) {
        for e in self.entries.values_mut() {
            derive(e, &self.ranking);
        }
    }
}

/// Datos calculados al vuelo (no se persisten): puntaje e idiomas de audio.
fn derive(e: &mut LibraryEntry, ranking: &RankingConfig) {
    e.score = Some(crate::ranking::score(&rank_input(e), ranking));
    let name = format!(
        "{} {} {}",
        e.name,
        e.torrent_name.as_deref().unwrap_or(""),
        e.live.as_ref().map_or("", |l| l.file_name.as_str())
    );
    e.languages = crate::audio::languages(e.live.as_ref().and_then(|l| l.audio.as_deref()), &name);
    let full = e
        .torrent_name
        .as_deref()
        .or(e.live.as_ref().and_then(|l| l.torrent_name.as_deref()))
        .unwrap_or(&e.name);
    let mut release = release_info(full, e.live.as_ref().map(|l| l.file_name.as_str()));
    // Del catálogo se sabe el título de verdad (con sus dos puntos, tildes…).
    if let Some(o) = &e.origin {
        release.title = o.title.clone();
        release.year = o.year.as_deref().and_then(|y| y.parse().ok());
        release.season = o.season.and_then(|s| u16::try_from(s).ok());
        release.episode = o.episode.and_then(|s| u16::try_from(s).ok());
    }
    e.release = Some(release);
}

/// Título limpio + año o temporada/episodio + insignias de calidad (diseño de filas FR-29b).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ReleaseInfo {
    pub title: String,
    pub year: Option<u16>,
    pub season: Option<u16>,
    pub episode: Option<u16>,
    /// En orden: resolución (`4K`, `1080p`…), `Dolby Vision`, `HDR`, `Atmos`, fuente (`WEB-DL`…).
    pub quality: Vec<String>,
}

/// Reusa los dos parsers que ya existen: `subtitles::parse_release_name` (título, año, SxxExx)
/// y `catalog::normalize::parse` (resolución, HDR/DV, Atmos, fuente). `file_name`: el archivo
/// elegido, que en un pack de temporada trae el episodio que el nombre del torrent no tiene.
pub fn release_info(name: &str, file_name: Option<&str>) -> ReleaseInfo {
    use crate::catalog::normalize::{parse, ParseCtx, Parsed};
    let id = crate::subtitles::parse_release_name(name);
    let file = file_name.map(crate::subtitles::parse_release_name);
    let (season, episode) = match &file {
        Some(f) if id.episode.is_none() && f.episode.is_some() => (f.season, f.episode),
        _ => (id.season, id.episode),
    };
    let stream = crate::catalog::protocol::Stream {
        info_hash: Some("0".repeat(40)),
        title: Some(format!("{name}\n{}", file_name.unwrap_or(""))),
        ..Default::default()
    };
    let ctx = ParseCtx {
        addon_name: "",
        addon_rank: 0,
        spain_flag_is_generic: true,
        is_series: false,
    };
    let mut quality = Vec::new();
    if let Parsed::Candidate(c) = parse(&stream, &ctx) {
        if let Some(r) = c.resolution {
            quality.push(if r == "2160p" { "4K".into() } else { r });
        }
        if c.hdr.iter().any(|h| h == "DV") {
            quality.push("Dolby Vision".into());
        }
        if c.hdr.iter().any(|h| h == "HDR") {
            quality.push("HDR".into());
        }
        if c.audio_format.iter().any(|a| a == "Atmos") {
            quality.push("Atmos".into());
        }
        quality.extend(c.source);
    }
    ReleaseInfo {
        title: id.title.unwrap_or_else(|| name.trim().to_string()),
        year: id.year,
        season,
        episode,
        quality,
    }
}

/// Estado "quieto" según lo que ya se sabe de la entrada.
pub fn settled_status(e: &LibraryEntry) -> EntryStatus {
    if e.live.is_some() {
        EntryStatus::Measured
    } else if e.scrape.is_some() {
        EntryStatus::Scraped
    } else {
        EntryStatus::New
    }
}

/// Lo que `ranking` necesita de una entrada. Para distinguir película/episodio también se mira
/// el nombre del archivo medido (suele traer `SxxExx` aunque el `dn` no).
pub fn rank_input(e: &LibraryEntry) -> RankInput {
    RankInput {
        name: e
            .live
            .as_ref()
            .map_or_else(|| e.name.clone(), |l| format!("{} {}", e.name, l.file_name)),
        size_bytes: e.live.as_ref().map(|l| l.file_size),
        real_duration_secs: e.live.as_ref().and_then(|l| l.duration_secs),
        // Solo la fase rápida (sin velocidad todavía) no cuenta como medida.
        measured_speed_bps: e
            .live
            .as_ref()
            .map(|l| l.avg_speed_bps)
            .filter(|s| *s > 0.0),
        seeders: e.scrape.as_ref().map(|s| s.seeders),
        leechers: e.scrape.as_ref().map(|s| s.leechers),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn magnet(byte: u8, name: &str) -> Magnet {
        Magnet {
            info_hash: InfoHash::from_bytes([byte; 20]),
            display_name: Some(name.into()),
            trackers: Vec::new(),
        }
    }

    fn temp_path(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("tstream-test-lib-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("library.json")
    }

    fn measured(speed: f64, size: u64) -> LiveMeasurement {
        LiveMeasurement {
            measured_at: Utc::now(),
            torrent_name: None,
            file_index: 0,
            file_name: "a.mkv".into(),
            file_size: size,
            peers: 5,
            seeds: 2,
            partial: false,
            measured_secs: 15.0,
            avg_speed_bps: speed,
            max_speed_bps: speed,
            duration_secs: Some(1000.0),
            audio: None,
        }
    }

    #[test]
    fn titulo_limpio_y_calidad_de_los_nombres_del_diseno() {
        let r = release_info(
            "Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX",
            None,
        );
        assert_eq!((r.title.as_str(), r.year), ("Dune Part Two", Some(2024)));
        assert_eq!(r.quality, ["4K", "Dolby Vision", "HDR", "Atmos", "WEB-DL"]);

        let r = release_info("The.Bear.S03E01.1080p.WEB.h264-ETHEL", None);
        assert_eq!(r.title, "The Bear");
        assert_eq!((r.season, r.episode), (Some(3), Some(1)));
        assert_eq!(r.quality, ["1080p", "WEB"]);

        let r = release_info("Oppenheimer.2023.1080p.BluRay.x264-SPARKS", None);
        assert_eq!((r.title.as_str(), r.year), ("Oppenheimer", Some(2023)));
        assert_eq!(r.quality, ["1080p", "BluRay"]);

        let r = release_info("Severance.S02E05.2160p.ATVP.WEB-DL.DV.HDR.H.265-FLUX", None);
        assert_eq!((r.season, r.episode), (Some(2), Some(5)));
        assert_eq!(r.quality, ["4K", "Dolby Vision", "HDR", "WEB-DL"]);

        // dn genérico de Torrentio: queda tal cual, sin calidad.
        let r = release_info("Torrentio", None);
        assert_eq!(r.title, "Torrentio");
        assert!(r.quality.is_empty());

        // Pack de temporada: el episodio sale del archivo elegido.
        let r = release_info(
            "The.Bear.S03.1080p.WEB.h264-ETHEL",
            Some("The.Bear.S03E04.1080p.WEB.h264-ETHEL.mkv"),
        );
        assert_eq!((r.season, r.episode), (Some(3), Some(4)));
    }

    #[test]
    fn alta_duplicado_y_movimiento_entre_grupos() {
        let path = temp_path("groups");
        let mut lib = Library::load(path.clone()).unwrap();
        let a = magnet(1, "A");
        assert_eq!(lib.add_or_touch(&a, "magnet:a"), AddOutcome::Added);
        assert_eq!(lib.add_or_touch(&a, "magnet:a"), AddOutcome::AlreadyPresent);
        assert_eq!(lib.len(), 1);
        assert!(lib.save_if_dirty().unwrap());
        assert!(!lib.save_if_dirty().unwrap());

        let mut lib = Library::load(path.clone()).unwrap();
        assert_eq!(lib.list(Group::Previous).len(), 1);
        assert_eq!(lib.list(Group::PastedNow).len(), 0);
        assert_eq!(
            lib.add_or_touch(&a, "magnet:a"),
            AddOutcome::MovedToPastedNow
        );
        assert_eq!(lib.list(Group::PastedNow).len(), 1);
        assert_eq!(lib.get(&a.info_hash).unwrap().magnet, "magnet:a");
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn lista_en_orden_por_defecto_y_estado_a_medias_se_asienta() {
        let path = temp_path("order");
        let mut lib = Library::load(path.clone()).unwrap();
        for (i, name) in [(1u8, "lento"), (2, "rapido"), (3, "sin medir")] {
            lib.add_or_touch(&magnet(i, name), "m");
        }
        let h = |b: u8| InfoHash::from_bytes([b; 20]);
        lib.update(&h(1), |e| e.live = Some(measured(500_000.0, 1_000_000_000)));
        lib.update(&h(2), |e| {
            e.live = Some(measured(3_000_000.0, 1_000_000_000));
            e.status = EntryStatus::Measuring;
        });
        let names: Vec<&str> = lib
            .list(Group::PastedNow)
            .iter()
            .map(|e| e.name.as_str())
            .collect();
        assert_eq!(names, ["rapido", "lento", "sin medir"]);
        let rapido = lib.get(&h(2)).unwrap().score.unwrap();
        assert_eq!(rapido.light, crate::ranking::Light::Green);

        lib.save().unwrap();
        let lib = Library::load(path.clone()).unwrap();
        assert_eq!(lib.get(&h(2)).unwrap().status, EntryStatus::Measured);
        assert!(
            lib.get(&h(2)).unwrap().score.is_some(),
            "puntaje recalculado al cargar"
        );
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
