//! `library` — lista + historial persistente, grupos y estados (FR-03, FR-04).
//! Persiste en `library.json` (escritura atómica, debounce ~500 ms desde `AppCore`).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::audio::{AudioLang, AudioOption};
use crate::config::RankingConfig;
use crate::events::{CoreEvent, EventSink};
use crate::magnet::{InfoHash, Magnet};
use crate::ranking::{RankInput, RankScore, SortKey};
use crate::trackers::ScrapeResult;
use crate::video_key::{VideoKey, VideoPart};
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
    /// Subtítulos que trae el video (embebidos + sueltos del torrent), leídos con el audio.
    /// `None` = todavía no se leyeron (2026-11-18).
    #[serde(default)]
    pub subs: Option<Vec<crate::subtitles::NativeSub>>,
    /// Cuadros por segundo reales, leídos con la duración.
    #[serde(default)]
    pub fps: Option<f64>,
}

/// Una fila de *Mis magnets* tal como se guarda en `library.json`: SOLO lo persistido. Lo que
/// ve la UI (puntaje, idiomas, título limpio, bytes en disco, orden) es [`LibraryRowView`].
/// Un `library.json` viejo con `score` / `languages` / `release` / `key` carga igual (serde
/// ignora los campos desconocidos).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LibraryEntry {
    /// Identidad de la fila: un pack de temporada da una fila por episodio. Se deriva de
    /// `info_hash` + `origin` ([`entry_key`]) al crear o cargar; no se guarda.
    #[serde(skip, default = "unset_key")]
    pub key: VideoKey,
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

/// Lo que la UI recibe de una fila (`library()` y el evento `LibraryEntryUpdated`): la entrada
/// más todo lo que el núcleo decide sobre ella. Se arma SOLO en [`Library::view`]; la UI
/// reemplaza la fila y reordena con `sort_key`, sin recalcular nada.
#[derive(Debug, Clone, Serialize)]
pub struct LibraryRowView {
    pub key: VideoKey,
    #[serde(flatten)]
    pub entry: LibraryEntry,
    pub score: RankScore,
    /// Idiomas de audio (pistas reales o adivinados por el nombre), en orden de preferencia.
    pub languages: Vec<AudioLang>,
    /// Qué ofrecer al reproducir (FR-09b), ya ordenado y con etiquetas cortas.
    pub audio_options: Vec<AudioOption>,
    /// Título limpio, año / episodio y calidad (FR-29b).
    pub release: ReleaseInfo,
    /// Subtítulos en español que trae el video (dropdown, 2026-11-18). `None` = todavía no se
    /// analizó (no se sabe); vacío = no trae.
    pub native_subs: Option<Vec<crate::subtitles::NativeSpanish>>,
    /// Bytes de ESTE video ya en disco (análisis FR-06d o descarga pausada); ver
    /// [`downloaded_bytes`].
    pub downloaded_bytes: Option<u64>,
    /// Orden dentro de su grupo (`group`): ascendente, después por `key` como texto.
    pub sort_key: SortKey,
}

/// Lo que se va a medir mientras se mide (FR-08): el margen y semáforo provisorios de cada fila
/// del torrent para una velocidad en vivo, con la misma regla que el puntaje final.
#[derive(Debug, Clone)]
pub struct LiveScorer {
    rows: Vec<(VideoKey, RankInput)>,
    ranking: RankingConfig,
    speed_factor: f64,
}

/// Puntaje provisorio de una fila durante la medición (viaja en `AnalyzerState::Measuring`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProvisionalScore {
    pub key: VideoKey,
    pub score: RankScore,
}

impl LiveScorer {
    /// Sin velocidad todavía (preparando): sin puntaje.
    pub fn score(&self, speed_bps: f64) -> Vec<ProvisionalScore> {
        if speed_bps.is_nan() || speed_bps <= 0.0 {
            return Vec::new();
        }
        self.rows
            .iter()
            .map(|(key, input)| ProvisionalScore {
                key: *key,
                score: crate::ranking::score(
                    &RankInput {
                        measured_speed_bps: Some(speed_bps),
                        ..input.clone()
                    },
                    &self.ranking,
                    self.speed_factor,
                ),
            })
            .collect()
    }
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

/// Copia de la biblioteca para escribir `library.json` fuera del lock.
pub struct LibrarySnapshot {
    path: PathBuf,
    entries: Vec<LibraryEntry>,
}

impl LibrarySnapshot {
    pub fn write(&self) -> Result<()> {
        crate::fsutil::write_json_atomic(&self.path, &self.entries)
    }
}

pub struct Library {
    path: PathBuf,
    /// Una fila por video ([`VideoKey`]); las de un mismo torrent quedan juntas (orden por hash).
    entries: BTreeMap<VideoKey, LibraryEntry>,
    /// Umbrales y duraciones estimadas para el puntaje y el orden (FR-07). Lo fija `AppCore` desde la config.
    ranking: RankingConfig,
    /// Calibración automática del semáforo (`playback::Calibration`); 1,0 = sin datos.
    speed_factor: f64,
    /// Carpeta de descargas, para los bytes en disco de cada fila. `None` (pruebas) = sin dato.
    downloads: Option<PathBuf>,
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
        // `library.json` viejo (una fila por hash): cada fila toma la clave de su `origin`.
        let entries = list
            .into_iter()
            .map(|mut e| {
                e.key = entry_key(&e);
                (e.key, e)
            })
            .collect();
        let mut library = Self {
            path,
            entries,
            ranking: RankingConfig::default(),
            speed_factor: 1.0,
            downloads: None,
            dirty: false,
        };
        library.start_session();
        Ok(library)
    }

    pub fn save(&self) -> Result<()> {
        let list: Vec<&LibraryEntry> = self.entries.values().collect();
        crate::fsutil::write_json_atomic(&self.path, &list)
    }

    /// Si hubo cambios, una copia para guardarla SIN tener el lock (lo hace `AppCore`) y la
    /// marca como guardada; `None` si no hubo cambios. Si la escritura falla: [`Self::mark_dirty`].
    pub fn take_dirty_snapshot(&mut self) -> Option<LibrarySnapshot> {
        if !self.dirty {
            return None;
        }
        self.dirty = false;
        Some(LibrarySnapshot {
            path: self.path.clone(),
            entries: self.entries.values().cloned().collect(),
        })
    }

    /// La última copia no se pudo guardar: el próximo intento vuelve a guardar.
    pub fn mark_dirty(&mut self) {
        self.dirty = true;
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
    }

    /// Cambia umbrales del semáforo / duraciones estimadas (FR-07); vale desde la próxima vista.
    pub fn set_ranking(&mut self, cfg: RankingConfig) {
        self.ranking = cfg;
    }

    /// Nuevo factor de calibración (al abrir y tras cada reproducción calibrada).
    pub fn set_speed_factor(&mut self, factor: f64) {
        self.speed_factor = factor;
    }

    /// Dónde buscar lo bajado de cada fila (`AppCore` al arrancar).
    pub fn set_downloads_dir(&mut self, dir: PathBuf) {
        self.downloads = Some(dir);
    }

    /// La fila como la ve la UI: el ÚNICO lugar donde se arma (puntaje, idiomas, opciones de
    /// audio, título limpio, bytes en disco y orden).
    pub fn view(&self, e: &LibraryEntry) -> LibraryRowView {
        let input = rank_input(e);
        let score = crate::ranking::score(&input, &self.ranking, self.speed_factor);
        let languages = languages_of(e);
        LibraryRowView {
            key: e.key,
            score,
            audio_options: crate::audio::play_options(&languages),
            languages,
            release: release_of(e),
            native_subs: e
                .live
                .as_ref()
                .and_then(|l| l.subs.as_deref())
                .map(|subs| crate::subtitles::spanish_natives(subs, e.info_hash)),
            downloaded_bytes: self
                .downloads
                .as_deref()
                .and_then(|d| downloaded_bytes(e, d)),
            sort_key: crate::ranking::sort_key(&input, &score),
            entry: e.clone(),
        }
    }

    /// Emite `LibraryEntryUpdated` con la vista completa de cada fila de `keys` que siga en la
    /// lista. Lo usan todos los que cambian filas.
    pub fn emit_rows(&self, keys: &[VideoKey], events: &dyn EventSink) {
        for e in keys.iter().filter_map(|k| self.entries.get(k)) {
            events.emit(CoreEvent::LibraryEntryUpdated {
                entry: Box::new(self.view(e)),
            });
        }
    }

    /// Para el margen provisorio mientras se mide `hash` (con lo que se sabe al arrancar).
    pub fn live_scorer(&self, hash: &InfoHash) -> LiveScorer {
        LiveScorer {
            rows: self
                .of_torrent(*hash)
                .map(|e| (e.key, rank_input(e)))
                .collect(),
            ranking: self.ranking.clone(),
            speed_factor: self.speed_factor,
        }
    }

    /// Alta de un magnet copiado (FR-01, FR-03):
    /// - nuevo → "Pegados ahora";
    /// - estaba en "Anteriores" → pasa a "Pegados ahora" (conserva sus mediciones);
    /// - ya estaba en "Pegados ahora" → no se duplica.
    ///
    /// `raw` es el magnet tal cual se copió (para "Copiar magnet", FR-04). Es la fila del torrent
    /// entero: las filas de episodios del mismo hash (del catálogo) no se tocan.
    pub fn add_or_touch(&mut self, magnet: &Magnet, raw: &str) -> AddOutcome {
        self.touch_or_insert(VideoKey::whole(magnet.info_hash), magnet, raw)
    }

    /// Alta desde el catálogo (spec 09 §8.1): una fila por video (episodio / archivo), con su
    /// `origin`. Otro episodio del mismo pack es otra fila; nunca pisa el `origin` de otra.
    pub fn add_from_catalog(
        &mut self,
        magnet: &Magnet,
        raw: &str,
        origin: CatalogOrigin,
        video_size: Option<u64>,
    ) -> VideoKey {
        let key = VideoKey::new(
            magnet.info_hash,
            origin.season.zip(origin.episode),
            origin.file_idx,
        );
        self.touch_or_insert(key, magnet, raw);
        let entry = self.entries.get_mut(&key).expect("recién agregada");
        entry.origin = Some(origin);
        entry.video_size = entry.video_size.or(video_size);
        key
    }

    fn touch_or_insert(&mut self, key: VideoKey, magnet: &Magnet, raw: &str) -> AddOutcome {
        let now = Utc::now();
        self.dirty = true;
        if let Some(entry) = self.entries.get_mut(&key) {
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
        // El análisis es por torrent (mismo enjambre): otra fila del mismo hash ya lo trae.
        let sibling = self.any_of(&magnet.info_hash);
        let entry = LibraryEntry {
            key,
            info_hash: magnet.info_hash,
            magnet: raw.trim().to_string(),
            name: magnet
                .display_name
                .clone()
                .unwrap_or_else(|| magnet.info_hash.to_hex()),
            torrent_name: sibling.and_then(|s| s.torrent_name.clone()),
            video_size: None,
            group: Group::PastedNow,
            status: sibling.map_or(EntryStatus::New, |s| s.status.clone()),
            scrape: sibling.and_then(|s| s.scrape.clone()),
            live: sibling.and_then(|s| s.live.clone()),
            added_at: now,
            last_copied_at: now,
            origin: None,
        };
        self.entries.insert(key, entry);
        AddOutcome::Added
    }

    pub fn get(&self, key: &VideoKey) -> Option<&LibraryEntry> {
        self.entries.get(key)
    }

    /// Las filas de un torrent (sus episodios y/o el torrent entero).
    pub fn of_torrent(&self, hash: InfoHash) -> impl Iterator<Item = &LibraryEntry> {
        self.entries
            .range(VideoKey::whole(hash)..)
            .take_while(move |(k, _)| k.info_hash == hash)
            .map(|(_, e)| e)
    }

    /// Una fila cualquiera del torrent (la del torrent entero si existe), para lo que es del
    /// torrent y no del video: magnet, trackers, análisis de velocidad (mismo enjambre).
    pub fn any_of(&self, hash: &InfoHash) -> Option<&LibraryEntry> {
        self.of_torrent(*hash).next()
    }

    /// Modifica TODAS las filas de un torrent (el análisis es por torrent: lo medido vale para
    /// cada episodio del pack). Devuelve sus claves (para [`Self::emit_rows`]); vacío si ya no
    /// hay ninguna.
    pub fn update_torrent<F: FnMut(&mut LibraryEntry)>(
        &mut self,
        hash: &InfoHash,
        mut f: F,
    ) -> Vec<VideoKey> {
        let keys: Vec<VideoKey> = self.of_torrent(*hash).map(|e| e.key).collect();
        for key in &keys {
            f(self.entries.get_mut(key).expect("clave recién leída"));
        }
        self.dirty |= !keys.is_empty();
        keys
    }

    /// ¿Queda alguna fila de este torrent? (su análisis, FR-06d, es del torrent).
    pub fn has_torrent(&self, hash: &InfoHash) -> bool {
        self.any_of(hash).is_some()
    }

    pub fn remove(&mut self, key: &VideoKey) -> bool {
        let removed = self.entries.remove(key).is_some();
        self.dirty |= removed;
        removed
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Todos los hashes, sin repetir (orden estable por hash).
    pub fn hashes(&self) -> Vec<InfoHash> {
        let mut hashes: Vec<InfoHash> = self.entries.keys().map(|k| k.info_hash).collect();
        hashes.dedup();
        hashes
    }

    /// Filas de un grupo, en el orden por defecto (FR-07): `sort_key` y después la clave como
    /// texto (la UI ordena igual).
    pub fn list(&self, group: Group) -> Vec<LibraryRowView> {
        let mut rows: Vec<LibraryRowView> = self
            .entries
            .values()
            .filter(|e| e.group == group)
            .map(|e| self.view(e))
            .collect();
        rows.sort_by(|a, b| {
            crate::ranking::cmp_sort_keys(&a.sort_key, &b.sort_key)
                .then_with(|| a.key.to_string().cmp(&b.key.to_string()))
        });
        rows
    }

    /// Torrents sin velocidad medida, sin repetir.
    pub fn unmeasured(&self) -> Vec<InfoHash> {
        let mut hashes: Vec<InfoHash> = self
            .entries
            .values()
            .filter(|e| !e.speed_measured())
            .map(|e| e.info_hash)
            .collect();
        hashes.dedup();
        hashes
    }
}

/// La identidad de una fila: el torrent + el video que pidió el catálogo (si vino de ahí).
pub fn entry_key(e: &LibraryEntry) -> VideoKey {
    let origin = e.origin.as_ref();
    VideoKey::new(
        e.info_hash,
        origin.and_then(|o| o.season.zip(o.episode)),
        origin.and_then(|o| o.file_idx),
    )
}

/// Solo para `serde`: `Library::load` la reemplaza enseguida por [`entry_key`].
fn unset_key() -> VideoKey {
    VideoKey::whole(InfoHash::from_bytes([0; 20]))
}

/// Idiomas de audio: de las pistas reales si ya se leyeron, si no adivinados por el nombre.
fn languages_of(e: &LibraryEntry) -> Vec<AudioLang> {
    let name = format!(
        "{} {} {}",
        e.name,
        e.torrent_name.as_deref().unwrap_or(""),
        e.live.as_ref().map_or("", |l| l.file_name.as_str())
    );
    crate::audio::languages(e.live.as_ref().and_then(|l| l.audio.as_deref()), &name)
}

fn release_of(e: &LibraryEntry) -> ReleaseInfo {
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
    release
}

/// Bytes en disco de ESTE video: el archivo medido en las carpetas `<hash>-*` (análisis FR-06d
/// y descargas pausadas de ese archivo), solo si el archivo medido es el de esta fila. Otro
/// episodio del mismo pack no hereda lo bajado del medido: `None` (su descarga pausada, si la
/// hay, la cuenta la fila de reproducción: `PlaybackRow.progress`). Sin medir: `None`.
fn downloaded_bytes(e: &LibraryEntry, downloads: &Path) -> Option<u64> {
    let live = e.live.as_ref()?;
    let measured_is_this_video = match e.key.part {
        // El torrent entero: su video es el que se midió (el analizador elige con esta fila).
        None => true,
        Some(VideoPart::File(i)) => live.file_index == i,
        Some(VideoPart::Episode { season, episode }) => {
            crate::engine::names_episode(&live.file_name, season, episode)
                || e.origin.as_ref().and_then(|o| o.file_idx) == Some(live.file_index)
        }
    };
    measured_is_this_video.then(|| {
        crate::fsutil::downloaded_in_dirs(
            downloads,
            &format!("{}-", e.info_hash.to_hex()),
            &live.file_name,
        )
    })
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

/// Título, año y SxxExx de [`crate::release`]; resolución, HDR/DV, Atmos y fuente de
/// [`crate::catalog::normalize::release_tags`] (la misma regla que el catálogo). `file_name`: el
/// archivo elegido, que en un pack de temporada trae el episodio que el nombre del torrent no
/// tiene.
pub fn release_info(name: &str, file_name: Option<&str>) -> ReleaseInfo {
    let id = crate::release::parse_release_name(name);
    let file = file_name.map(crate::release::parse_release_name);
    let (season, episode) = match &file {
        Some(f) if id.episode.is_none() && f.episode.is_some() => (f.season, f.episode),
        _ => (id.season, id.episode),
    };
    let text = format!("{name}\n{}", file_name.unwrap_or(""));
    let tags = crate::catalog::normalize::release_tags(&text, &id);
    let mut quality = Vec::new();
    if let Some(r) = tags.resolution {
        quality.push(if r == "2160p" { "4K".into() } else { r });
    }
    if tags.hdr.iter().any(|h| h == "DV") {
        quality.push("Dolby Vision".into());
    }
    if tags.hdr.iter().any(|h| h == "HDR") {
        quality.push("HDR".into());
    }
    if tags.audio_format.iter().any(|a| a == "Atmos") {
        quality.push("Atmos".into());
    }
    quality.extend(tags.source);
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
            std::env::temp_dir().join(format!("streamonte-test-lib-{name}-{}", std::process::id()));
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
            subs: None,
            fps: None,
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

        // Antes, lo que el catálogo descarta (solo japonés) se quedaba sin insignias.
        let r = release_info("Show.1080p.BluRay 🇯🇵", None);
        assert_eq!(r.quality, ["1080p", "BluRay"]);
    }

    #[test]
    fn alta_duplicado_y_movimiento_entre_grupos() {
        let path = temp_path("groups");
        let mut lib = Library::load(path.clone()).unwrap();
        let a = magnet(1, "A");
        assert_eq!(lib.add_or_touch(&a, "magnet:a"), AddOutcome::Added);
        assert_eq!(lib.add_or_touch(&a, "magnet:a"), AddOutcome::AlreadyPresent);
        assert_eq!(lib.len(), 1);
        lib.take_dirty_snapshot().unwrap().write().unwrap();
        assert!(lib.take_dirty_snapshot().is_none());

        let mut lib = Library::load(path.clone()).unwrap();
        assert_eq!(lib.list(Group::Previous).len(), 1);
        assert_eq!(lib.list(Group::PastedNow).len(), 0);
        assert_eq!(
            lib.add_or_touch(&a, "magnet:a"),
            AddOutcome::MovedToPastedNow
        );
        assert_eq!(lib.list(Group::PastedNow).len(), 1);
        assert_eq!(lib.any_of(&a.info_hash).unwrap().magnet, "magnet:a");
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
        lib.update_torrent(&h(1), |e| e.live = Some(measured(500_000.0, 1_000_000_000)));
        lib.update_torrent(&h(2), |e| {
            e.live = Some(measured(3_000_000.0, 1_000_000_000));
            e.status = EntryStatus::Measuring;
        });
        let names: Vec<String> = lib
            .list(Group::PastedNow)
            .iter()
            .map(|r| r.entry.name.clone())
            .collect();
        assert_eq!(names, ["rapido", "lento", "sin medir"]);
        let rapido = lib.view(lib.any_of(&h(2)).unwrap()).score;
        assert_eq!(rapido.light, crate::ranking::Light::Green);

        lib.save().unwrap();
        let lib = Library::load(path.clone()).unwrap();
        assert_eq!(lib.any_of(&h(2)).unwrap().status, EntryStatus::Measured);
        assert!(
            lib.view(lib.any_of(&h(2)).unwrap()).score.margin.is_some(),
            "puntaje recalculado al cargar"
        );
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    fn origin(season: u32, episode: u32, file_idx: Option<usize>) -> CatalogOrigin {
        CatalogOrigin {
            video_id: format!("tt1:{season}:{episode}"),
            imdb_id: "tt1".into(),
            title: "The Bear".into(),
            year: None,
            season: Some(season),
            episode: Some(episode),
            file_idx,
            addons: vec!["torrentio".into()],
        }
    }

    /// El bug del pack: S3E1 y S3E2 del mismo torrent son dos filas; ninguna pisa a la otra. El
    /// análisis (por torrent) llega a las dos; pegar el magnet suelto es otra fila más.
    #[test]
    fn dos_episodios_del_mismo_pack_son_dos_filas() {
        let path = temp_path("pack");
        let mut lib = Library::load(path.clone()).unwrap();
        let pack = magnet(4, "The.Bear.S03.1080p");
        let hash = pack.info_hash;
        let e1 = lib.add_from_catalog(&pack, "m", origin(3, 1, Some(0)), Some(10));
        let e2 = lib.add_from_catalog(&pack, "m", origin(3, 2, Some(1)), Some(20));
        assert_ne!(e1, e2);
        assert_eq!(lib.len(), 2);
        assert_eq!(
            lib.get(&e1).unwrap().origin.as_ref().unwrap().episode,
            Some(1)
        );
        assert_eq!(
            lib.get(&e2).unwrap().origin.as_ref().unwrap().episode,
            Some(2)
        );
        assert_eq!(lib.view(lib.get(&e1).unwrap()).release.episode, Some(1));
        // El mismo episodio otra vez (otro addon, otro fileIdx): no se duplica.
        lib.add_from_catalog(&pack, "m", origin(3, 2, Some(7)), None);
        assert_eq!(lib.len(), 2);

        let updated = lib.update_torrent(&hash, |e| e.live = Some(measured(3e6, 1_000_000_000)));
        assert_eq!(
            updated.len(),
            2,
            "lo medido vale para cada episodio del pack"
        );
        assert_eq!(lib.hashes(), [hash]);
        assert!(lib.unmeasured().is_empty());

        // Pegar el magnet: fila del torrent entero; las de episodios quedan como estaban.
        assert_eq!(lib.add_or_touch(&pack, "magnet:pack"), AddOutcome::Added);
        assert_eq!(lib.len(), 3);
        assert_eq!(lib.any_of(&hash).unwrap().key, VideoKey::whole(hash));
        assert!(
            lib.get(&VideoKey::whole(hash)).unwrap().live.is_some(),
            "la fila nueva hereda lo medido del torrent"
        );
        assert_eq!(
            lib.get(&e1).unwrap().origin.as_ref().unwrap().episode,
            Some(1)
        );

        lib.save().unwrap();
        let mut lib = Library::load(path.clone()).unwrap();
        assert_eq!(lib.len(), 3);
        assert_eq!(
            lib.get(&e2).unwrap().key,
            e2,
            "la clave se recalcula al cargar"
        );
        assert!(lib.remove(&e1));
        assert!(lib.has_torrent(&hash), "quedan otros episodios del torrent");
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    /// `library.json` de antes (una fila por hash, sin `key`; o con los campos calculados que
    /// se escribían: `score`, `languages`, `release`, `key`): carga igual y no los vuelve a
    /// escribir; la fila del catálogo toma la clave de su episodio y la pegada, la del torrent
    /// entero.
    #[test]
    fn library_json_viejo_carga() {
        let path = temp_path("old");
        let (a, b) = ("0a".repeat(20), "0b".repeat(20));
        let old = format!(
            r#"[
              {{"info_hash":"{a}","magnet":"magnet:?xt=urn:btih:{a}","name":"Pegado",
                "group":"pasted-now","status":{{"kind":"new"}},"scrape":null,"live":null,
                "score":{{"duration":null,"needed_bps":null,"margin":null,"light":"unknown"}},
                "languages":[{{"code":"en","short":"EN","label":"Inglés","confirmed":false,"detail":"","aids":[]}}],
                "release":{{"title":"Pegado","year":null,"season":null,"episode":null,"quality":[]}},
                "key":"{a}",
                "added_at":"2026-11-01T10:00:00Z","last_copied_at":"2026-11-01T10:00:00Z"}},
              {{"info_hash":"{b}","magnet":"magnet:?xt=urn:btih:{b}","name":"Torrentio",
                "group":"previous","status":{{"kind":"new"}},"scrape":null,"live":null,
                "added_at":"2026-11-01T10:00:00Z","last_copied_at":"2026-11-01T10:00:00Z",
                "origin":{{"video_id":"tt1:3:2","imdb_id":"tt1","title":"The Bear","year":null,
                  "season":3,"episode":2,"file_idx":5,"addons":["torrentio"]}}}}
            ]"#
        );
        std::fs::write(&path, old).unwrap();
        let lib = Library::load(path.clone()).unwrap();
        assert_eq!(lib.len(), 2);
        let ha = InfoHash::parse(&a).unwrap();
        let hb = InfoHash::parse(&b).unwrap();
        assert_eq!(lib.get(&VideoKey::whole(ha)).unwrap().name, "Pegado");
        let ep = lib.get(&VideoKey::new(hb, Some((3, 2)), None)).unwrap();
        assert_eq!(ep.origin.as_ref().unwrap().file_idx, Some(5));
        assert_eq!(lib.view(ep).release.title, "The Bear");
        lib.save().unwrap();
        let saved = std::fs::read_to_string(&path).unwrap();
        for derived in [
            "\"score\"",
            "\"languages\"",
            "\"release\"",
            "\"key\"",
            "downloaded_bytes",
        ] {
            assert!(!saved.contains(derived), "{derived} no se persiste");
        }
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    /// La vista de cada fila: bytes en disco de SU video (el episodio medido sí, otro episodio
    /// del mismo pack no hereda ese número) y la clave de orden del núcleo.
    #[test]
    fn vista_de_fila_bytes_por_video_y_clave_de_orden() {
        let path = temp_path("view");
        let downloads = path.parent().unwrap().join("downloads");
        let mut lib = Library::load(path.clone()).unwrap();
        lib.set_downloads_dir(downloads.clone());
        let pack = magnet(6, "The.Bear.S03.1080p");
        let hash = pack.info_hash;
        let e1 = lib.add_from_catalog(&pack, "m", origin(3, 1, Some(0)), Some(10));
        let e2 = lib.add_from_catalog(&pack, "m", origin(3, 2, Some(1)), Some(20));
        let solo = magnet(7, "Otra");
        lib.add_or_touch(&solo, "m");
        assert_eq!(
            lib.view(lib.get(&e1).unwrap()).downloaded_bytes,
            None,
            "sin medir"
        );

        // Se midió E1 (el analizador elige con la primera fila del torrent).
        lib.update_torrent(&hash, |e| {
            e.live = Some(LiveMeasurement {
                file_index: 0,
                file_name: "The.Bear.S03E01.mkv".into(),
                ..measured(3e6, 1_000_000_000)
            })
        });
        let dir = downloads.join(format!("{}-analisis", hash.to_hex()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("The.Bear.S03E01.mkv"), vec![1u8; 200_000]).unwrap();
        let v1 = lib.view(lib.get(&e1).unwrap());
        assert!(
            v1.downloaded_bytes.is_some_and(|b| b > 0),
            "{:?}",
            v1.downloaded_bytes
        );
        let v2 = lib.view(lib.get(&e2).unwrap());
        assert_eq!(v2.downloaded_bytes, None, "E2 no es el medido");

        // Orden: medidos (por margen) antes que sin medir; el evento trae la misma clave.
        let rows = lib.list(Group::PastedNow);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[2].key, VideoKey::whole(solo.info_hash));
        assert_eq!(
            crate::ranking::cmp_sort_keys(&rows[0].sort_key, &rows[2].sort_key),
            std::cmp::Ordering::Less
        );
        let json = serde_json::to_value(&v1).unwrap();
        for field in [
            "key",
            "info_hash",
            "score",
            "languages",
            "audio_options",
            "release",
            "downloaded_bytes",
            "sort_key",
        ] {
            assert!(json.get(field).is_some(), "falta {field} en la vista");
        }
        assert_eq!(json["key"], e1.to_string());

        // Margen provisorio mientras se mide: la misma regla que el puntaje final.
        let live = lib.live_scorer(&hash);
        assert!(live.score(0.0).is_empty(), "sin velocidad todavía");
        let prov = live.score(3e6);
        assert_eq!(prov.len(), 2, "una por fila del torrent");
        assert_eq!(prov[0].score, v1.score);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
