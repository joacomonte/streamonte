//! `subtitles` — proveedores, detección del video, ranking, fusión ASS, sincronización, memoria
//! (FR-21–28, ADR-10/11/12). Interfaces definidas en F0; implementadas en F5/F6 (pedido del
//! usuario 2026-11-13: subtítulos antes que el resto de la UI).
//!
//! Submódulos:
//! - [`merge`]: lectura de SRT/ASS y fusión de hasta 5 en un único ASS (modo comparación, FR-25).
//! - [`providers`]: del torrent, Wyzie Subs, Subdivx (experimental) y OpenSubtitles (FR-22, FR-24).
//! - [`secrets`]: API keys en el almacén seguro del sistema (NFR-16), nunca en `config.json`.
//! - [`session`]: lo que pasa mientras mpv está abierto: buscar, bajar, cargar, teclas, memoria.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::config::SubtitleLanguage;
use crate::engine::{FileInfo, Metadata, VIDEO_EXTENSIONS};
use crate::magnet::InfoHash;
use crate::Result;

mod merge;
pub mod providers;
pub mod secrets;
pub mod session;

pub use merge::merge_ass;

/// Cuántos subtítulos se cargan a la vez (FR-24/25: "al menos 5, o los que encuentre hasta 5").
pub const MAX_SUBTITLES: usize = 5;

/// Extensiones de subtítulo de texto que sabemos leer y fusionar.
pub const SUBTITLE_EXTENSIONS: &[&str] = &["srt", "ass", "ssa", "vtt"];

// ---------- Detección del video (FR-23) ----------

/// Lo que sabemos del video para buscar subtítulos.
#[derive(Debug, Clone, Default, Serialize)]
pub struct VideoIdentity {
    pub info_hash: Option<InfoHash>,
    pub file_name: String,
    pub file_size: u64,
    /// Hash OpenSubtitles (tamaño + primeros/últimos 64 KiB, YA precargados por `preload`).
    pub movie_hash: Option<u64>,
    pub title: Option<String>,
    pub year: Option<u16>,
    pub season: Option<u16>,
    pub episode: Option<u16>,
    pub source: Option<String>,
    pub release_group: Option<String>,
    pub duration_secs: Option<f64>,
    /// IMDb id (`tt…`) si se pudo resolver (Wyzie lo exige). Agregado en F6 (aditivo).
    pub imdb_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Confidence {
    High,
    Medium,
    /// La UI pregunta "¿Es X?" con corrección (FR-23).
    Low,
}

impl VideoIdentity {
    /// Confianza de la identificación (FR-23): hash o título+año = alta; solo título = media.
    pub fn confidence(&self) -> Confidence {
        match (&self.title, self.year, self.movie_hash) {
            (_, _, Some(_)) | (Some(_), Some(_), _) => Confidence::High,
            (Some(_), None, _) if self.season.is_some() => Confidence::High,
            (Some(_), None, _) => Confidence::Medium,
            _ => Confidence::Low,
        }
    }
}

/// Parsea el nombre del release (título, año, SxxExx, fuente, grupo).
/// ADR-10 actualizado: parser propio en Rust (antes parse-torrent-title en JS), ver ADR-13.
/// Campos desconocidos = `None`, nunca error (R-10).
pub fn parse_release_name(name: &str) -> VideoIdentity {
    let file = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let stem = strip_extension(file);

    // Grupo: lo que sigue al último '-' ("…x264-GRUPO"), si parece un grupo y no un marcador.
    let release_group = stem
        .rsplit_once('-')
        .map(|(_, g)| g.trim())
        .filter(|g| {
            !g.is_empty()
                && g.len() <= 20
                && g.chars().all(|c| c.is_ascii_alphanumeric())
                && !is_marker(g)
                && !g.chars().all(|c| c.is_ascii_digit())
        })
        .map(String::from);

    let tokens: Vec<&str> = stem
        .split(['.', '_', ' ', '[', ']', '(', ')', '{', '}'])
        .filter(|t| !t.is_empty())
        .collect();

    let mut out = VideoIdentity {
        file_name: file.to_string(),
        release_group,
        ..Default::default()
    };
    let mut title_end: Option<usize> = None;
    for (i, token) in tokens.iter().enumerate() {
        let lower = token.to_ascii_lowercase();
        // "2001 A Space Odyssey": un año en la primera posición es parte del título.
        if i > 0 && out.year.is_none() {
            if let Some(y) = parse_year(&lower) {
                out.year = Some(y);
                title_end.get_or_insert(i);
                continue;
            }
        }
        if let Some((s, e)) = parse_season_episode(&lower) {
            if out.season.is_none() {
                out.season = Some(s);
                out.episode = e;
            }
            title_end.get_or_insert(i);
            continue;
        }
        if let Some(src) = source_of(&lower) {
            out.source.get_or_insert_with(|| src.to_string());
        }
        if i > 0 && is_marker(&lower) {
            title_end.get_or_insert(i);
        }
    }
    let end = title_end.unwrap_or(tokens.len());
    let title = tokens[..end]
        .join(" ")
        .trim_matches(|c: char| c == '-' || c.is_whitespace())
        .to_string();
    if !title.is_empty() {
        out.title = Some(title);
    }
    out
}

fn strip_extension(file: &str) -> &str {
    match file.rsplit_once('.') {
        Some((stem, ext))
            if ext.len() <= 4
                && (VIDEO_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str())
                    || SUBTITLE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str())) =>
        {
            stem
        }
        _ => file,
    }
}

fn parse_year(token: &str) -> Option<u16> {
    (token.len() == 4 && token.bytes().all(|b| b.is_ascii_digit()))
        .then(|| token.parse::<u16>().ok())
        .flatten()
        .filter(|y| (1900..=2099).contains(y))
}

/// `s01e02`, `s01` (pack de temporada), `1x02`.
fn parse_season_episode(token: &str) -> Option<(u16, Option<u16>)> {
    let digits = |s: &str| -> Option<u16> {
        (!s.is_empty() && s.len() <= 3 && s.bytes().all(|b| b.is_ascii_digit()))
            .then(|| s.parse().ok())
            .flatten()
    };
    if let Some(rest) = token.strip_prefix('s') {
        let (season, episode) = match rest.split_once('e') {
            Some((s, e)) => (s, Some(e)),
            None => (rest, None),
        };
        let season = digits(season).filter(|_| season.len() <= 2)?;
        return match episode {
            Some(e) => Some((season, Some(digits(e)?))),
            None => Some((season, None)),
        };
    }
    let (s, e) = token.split_once('x')?;
    Some((digits(s).filter(|_| s.len() <= 2)?, Some(digits(e)?)))
}

fn source_of(token: &str) -> Option<&'static str> {
    Some(match token {
        "web-dl" | "webdl" => "WEB-DL",
        "webrip" | "web-rip" => "WEBRip",
        "web" => "WEB",
        "bluray" | "blu-ray" | "bdrip" | "brrip" | "bdremux" => "BluRay",
        "hdtv" => "HDTV",
        "dvdrip" | "dvd" => "DVDRip",
        "hdrip" => "HDRip",
        "cam" | "hdcam" | "ts" | "telesync" => "CAM",
        _ => return None,
    })
}

fn is_marker(token: &str) -> bool {
    let t = token.to_ascii_lowercase();
    let t = t.split('-').next().unwrap_or(&t);
    if source_of(t).is_some() {
        return true;
    }
    let resolution =
        t.len() >= 4 && t.ends_with('p') && t[..t.len() - 1].bytes().all(|b| b.is_ascii_digit());
    resolution
        || matches!(
            t,
            "4k" | "uhd"
                | "x264"
                | "x265"
                | "h264"
                | "h265"
                | "hevc"
                | "avc"
                | "xvid"
                | "10bit"
                | "hdr"
                | "hdr10"
                | "dv"
                | "remux"
                | "proper"
                | "repack"
                | "extended"
                | "unrated"
                | "multi"
                | "dual"
                | "latino"
                | "castellano"
                | "aac"
                | "ac3"
                | "dts"
                | "ddp5"
                | "dd5"
                | "atmos"
                | "complete"
        )
}

/// Hash de OpenSubtitles: `size + Σ u64 LE de los primeros 64 KiB + Σ de los últimos 64 KiB`
/// (sumas con desborde, como el algoritmo de referencia). Si un trozo no es múltiplo de 8 bytes,
/// el resto se ignora (igual que la referencia, que lee de a 8).
pub fn movie_hash(size: u64, head_64k: &[u8], tail_64k: &[u8]) -> u64 {
    let sum = |bytes: &[u8]| {
        bytes.chunks_exact(8).fold(0u64, |acc, c| {
            acc.wrapping_add(u64::from_le_bytes(c.try_into().expect("8 bytes")))
        })
    };
    size.wrapping_add(sum(head_64k)).wrapping_add(sum(tail_64k))
}

/// Archivos de subtítulo del torrent que acompañan al video elegido (FR-22).
/// Con varios videos (pack de serie) solo los que llevan el nombre del video.
pub fn subtitle_files_for(metadata: &Metadata, video: &FileInfo) -> Vec<FileInfo> {
    let is_sub = |f: &&FileInfo| {
        Path::new(&f.name)
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| SUBTITLE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
            // Más de 2 MB no es un subtítulo de texto.
            && f.size < 2 * 1024 * 1024
    };
    let videos = metadata
        .files
        .iter()
        .filter(|f| {
            Path::new(&f.name)
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| VIDEO_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        })
        .count();
    let video_stem = Path::new(&video.name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_lowercase();
    metadata
        .files
        .iter()
        .filter(is_sub)
        .filter(|f| videos <= 1 || f.name.to_lowercase().contains(&video_stem))
        .cloned()
        .collect()
}

// ---------- Proveedores (FR-24, R-02) ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum MatchKind {
    // Orden de mejor a peor (FR-24): hash > release > duración > nada.
    Hash,
    Release,
    Duration,
    None,
}

/// Variante del español (Q-03: latino primero, después España, después sin variante).
/// Para otros idiomas siempre `Unknown`. Agregado en F6 (aditivo).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SpanishVariant {
    Latino,
    Spain,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
pub struct SubtitleCandidate {
    pub provider: &'static str,
    pub provider_id: String,
    pub release_name: String,
    pub language: SubtitleLanguage,
    pub match_kind: MatchKind,
    pub downloads: u32,
    /// Agregado en F6 (aditivo): variante del español (ranking Q-03).
    pub variant: SpanishVariant,
    /// Agregado en F6 (aditivo): de dónde se baja (URL del proveedor o del motor, 127.0.0.1).
    #[serde(skip)]
    pub url: String,
}

impl SubtitleCandidate {
    /// Clave estable para la memoria por película (FR-28) y el nombre en caché.
    pub fn key(&self) -> String {
        format!("{}:{}", self.provider, self.provider_id)
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Quota {
    pub remaining: u32,
    pub per_day: u32,
}

#[async_trait]
pub trait SubtitleProvider: Send + Sync {
    fn id(&self) -> &'static str;
    /// `None` = sin límite conocido. Se respeta antes de descargar (ADR-12, Q-01).
    async fn quota(&self) -> Result<Option<Quota>>;
    async fn search(
        &self,
        video: &VideoIdentity,
        lang: SubtitleLanguage,
    ) -> Result<Vec<SubtitleCandidate>>;
    /// Descarga a la caché de subtítulos y devuelve la ruta (SRT/ASS, UTF-8).
    async fn download(&self, candidate: &SubtitleCandidate, cache_dir: &Path) -> Result<PathBuf>;
}

/// Id del proveedor "subtítulos que vienen dentro del torrent" (FR-22).
pub const TORRENT_PROVIDER: &str = "torrent";

/// Ordena y deja los mejores `n` (5 por FR-24). Orden (F6, anotado en spec 04):
/// 1. los del torrent primero (FR-22, ADR-12: son del mismo archivo),
/// 2. variante: latino > España > sin variante (Q-03),
/// 3. coincidencia: hash > release > duración > nada (FR-24),
/// 4. popularidad (descargas).
pub fn top_candidates(mut all: Vec<SubtitleCandidate>, n: usize) -> Vec<SubtitleCandidate> {
    all.sort_by(|a, b| {
        (a.provider != TORRENT_PROVIDER)
            .cmp(&(b.provider != TORRENT_PROVIDER))
            .then(a.variant.cmp(&b.variant))
            .then(a.match_kind.cmp(&b.match_kind))
            .then(b.downloads.cmp(&a.downloads))
    });
    all.truncate(n);
    all
}

// ---------- Comparación (FR-25, ADR-11) ----------

pub struct LabeledSubtitle {
    pub path: PathBuf,
    /// Lo que se muestra en pantalla delante de cada línea, p. ej. "1 · torrent/Sintel.es".
    pub label: String,
}

// ---------- Sincronización (FR-26, FR-27) ----------

/// Teclas de sync manual: Z −0,1 s · X +0,1 s · Shift ×10 · R reset (FR-26).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncKey {
    VoiceEarlier { big: bool },
    VoiceLater { big: bool },
    Reset,
}

/// Aplica una tecla al desfase actual (segundos, mismo signo que `sub-delay` de mpv).
/// "La voz llega antes" = el subtítulo viene tarde → hay que adelantarlo (desfase más negativo).
/// Se redondea a décimas para que 30 toques no acumulen error de punto flotante.
pub fn apply_sync_key(current_delay: f64, key: SyncKey) -> f64 {
    let step = |big: bool| if big { 1.0 } else { 0.1 };
    let next = match key {
        SyncKey::VoiceEarlier { big } => current_delay - step(big),
        SyncKey::VoiceLater { big } => current_delay + step(big),
        SyncKey::Reset => 0.0,
    };
    let rounded = (next * 10.0).round() / 10.0;
    // Evitar "-0,0".
    if rounded == 0.0 {
        0.0
    } else {
        rounded
    }
}

/// Mensaje en lenguaje claro para la pantalla, p. ej. "Subtítulos 0,3 s más tarde" (FR-26).
pub fn sync_message(delay: f64) -> String {
    let secs = (delay.abs() * 10.0).round() / 10.0;
    if secs == 0.0 {
        return "Subtítulos sin desfase (sincronización original)".into();
    }
    let amount = format!("{secs:.1}").replace('.', ",");
    if delay > 0.0 {
        format!("Subtítulos {amount} s más tarde")
    } else {
        format!("Subtítulos {amount} s antes")
    }
}

/// Sincronización automática contra el audio o un subtítulo de referencia (FR-27, F7).
#[async_trait]
pub trait AutoSync: Send + Sync {
    /// Devuelve el desfase a aplicar (segundos).
    async fn compute_offset(&self, subtitle: &Path, reference: SyncReference) -> Result<f64>;
}

pub enum SyncReference {
    /// URL del motor (audio del video).
    Audio(String),
    Subtitle(PathBuf),
}

// ---------- Memoria por película (FR-28) ----------

/// Valor especial de [`SubtitleChoice::subtitle`]: modo comparación (todos a la vez).
pub const CHOICE_ALL: &str = "all";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SubtitleChoice {
    /// Clave del candidato (`proveedor:id`, ver [`SubtitleCandidate::key`]) o [`CHOICE_ALL`].
    pub subtitle: String,
    pub delay_secs: f64,
    /// Agregado en F6 (aditivo): etiqueta para volver a cargarlo desde la caché aunque el
    /// proveedor ya no lo devuelva entre los 5 mejores.
    #[serde(default)]
    pub label: Option<String>,
}

/// `subtitles-memory.json`: por info hash, el subtítulo elegido y el desfase (FR-28).
pub struct SubtitleMemory {
    path: PathBuf,
}

impl SubtitleMemory {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn load(&self) -> HashMap<String, SubtitleChoice> {
        match crate::fsutil::read_json(&self.path) {
            Ok(Some(map)) => map,
            Ok(None) => HashMap::new(),
            Err(e) => {
                // Corrupto: se aparta y se empieza de cero; nunca rompe la reproducción (NFR-12).
                tracing::warn!("subtitles-memory.json inválido: {e}");
                let _ = crate::fsutil::quarantine(&self.path);
                HashMap::new()
            }
        }
    }

    pub fn get(&self, hash: &InfoHash) -> Result<Option<SubtitleChoice>> {
        Ok(self.load().remove(&hash.to_hex()))
    }

    pub fn set(&self, hash: &InfoHash, choice: SubtitleChoice) -> Result<()> {
        let mut map = self.load();
        map.insert(hash.to_hex(), choice);
        crate::fsutil::write_json_atomic(&self.path, &map)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cand(
        provider: &'static str,
        variant: SpanishVariant,
        m: MatchKind,
        dl: u32,
    ) -> SubtitleCandidate {
        SubtitleCandidate {
            provider,
            provider_id: format!("{provider}-{variant:?}-{m:?}-{dl}"),
            release_name: String::new(),
            language: SubtitleLanguage::Es,
            match_kind: m,
            downloads: dl,
            variant,
            url: String::new(),
        }
    }

    #[test]
    fn ranking_latino_espana_sin_variante() {
        use SpanishVariant::*;
        let all = vec![
            cand("wyzie", Unknown, MatchKind::Hash, 900),
            cand("wyzie", Spain, MatchKind::Hash, 900),
            cand("subdivx", Latino, MatchKind::None, 1),
        ];
        let top = top_candidates(all, 5);
        let order: Vec<_> = top.iter().map(|c| c.variant).collect();
        assert_eq!(order, vec![Latino, Spain, Unknown]);
    }

    #[test]
    fn ranking_hash_release_duracion_popularidad() {
        use SpanishVariant::Latino;
        let all = vec![
            cand("wyzie", Latino, MatchKind::None, 10_000),
            cand("wyzie", Latino, MatchKind::Duration, 5),
            cand("wyzie", Latino, MatchKind::Release, 1),
            cand("wyzie", Latino, MatchKind::Hash, 0),
            cand("wyzie", Latino, MatchKind::Release, 50),
        ];
        let top = top_candidates(all, 5);
        let order: Vec<_> = top.iter().map(|c| (c.match_kind, c.downloads)).collect();
        assert_eq!(
            order,
            vec![
                (MatchKind::Hash, 0),
                (MatchKind::Release, 50),
                (MatchKind::Release, 1),
                (MatchKind::Duration, 5),
                (MatchKind::None, 10_000),
            ]
        );
    }

    #[test]
    fn ranking_torrent_primero_y_corta_en_n() {
        let mut all: Vec<_> = (0..8)
            .map(|i| cand("wyzie", SpanishVariant::Latino, MatchKind::Hash, i))
            .collect();
        all.push(cand(
            TORRENT_PROVIDER,
            SpanishVariant::Unknown,
            MatchKind::Hash,
            0,
        ));
        let top = top_candidates(all, MAX_SUBTITLES);
        assert_eq!(top.len(), 5);
        assert_eq!(top[0].provider, TORRENT_PROVIDER);
    }

    #[test]
    fn sync_teclas() {
        let d = apply_sync_key(0.0, SyncKey::VoiceEarlier { big: false });
        assert_eq!(d, -0.1);
        let d = apply_sync_key(d, SyncKey::VoiceEarlier { big: true });
        assert_eq!(d, -1.1);
        let d = apply_sync_key(d, SyncKey::VoiceLater { big: true });
        assert_eq!(d, -0.1);
        let d = apply_sync_key(d, SyncKey::VoiceLater { big: false });
        assert_eq!(d, 0.0);
        assert!(d.is_sign_positive(), "sin -0,0");
        assert_eq!(apply_sync_key(3.7, SyncKey::Reset), 0.0);
        // 30 toques de 0,1 s = 3,0 s exactos (sin error acumulado).
        let mut d = 0.0;
        for _ in 0..30 {
            d = apply_sync_key(d, SyncKey::VoiceLater { big: false });
        }
        assert_eq!(d, 3.0);
    }

    #[test]
    fn sync_mensajes_claros() {
        assert_eq!(sync_message(0.3), "Subtítulos 0,3 s más tarde");
        assert_eq!(sync_message(-1.5), "Subtítulos 1,5 s antes");
        assert_eq!(
            sync_message(0.0),
            "Subtítulos sin desfase (sincronización original)"
        );
        assert_eq!(
            sync_message(0.30000000000000004),
            "Subtítulos 0,3 s más tarde"
        );
    }

    /// Vector calculado con el algoritmo de referencia de OpenSubtitles (Python, struct.unpack
    /// "<q" de a 8 bytes con máscara de 64 bits) sobre datos sintéticos.
    #[test]
    fn movie_hash_vector_conocido() {
        let size: u64 = 1_000_000;
        let head: Vec<u8> = (0..65_536u32).map(|i| (i % 251) as u8).collect();
        let tail: Vec<u8> = (0..65_536u32).map(|i| (i * 7 % 256) as u8).collect();
        assert_eq!(
            format!("{:016x}", movie_hash(size, &head, &tail)),
            MOVIE_HASH_EXPECTED
        );
        // Desborde: no hace panic y envuelve.
        let ff = vec![0xFFu8; 65_536];
        let _ = movie_hash(u64::MAX, &ff, &ff);
    }
    const MOVIE_HASH_EXPECTED: &str = include_str!("../tests/fixtures/subtitles/movie-hash.txt");

    #[test]
    fn release_pelicula() {
        let v = parse_release_name("The.Martian.2015.1080p.WEB-DL.x264-NTb.mkv");
        assert_eq!(v.title.as_deref(), Some("The Martian"));
        assert_eq!(v.year, Some(2015));
        assert_eq!(v.source.as_deref(), Some("WEB-DL"));
        assert_eq!(v.release_group.as_deref(), Some("NTb"));
        assert_eq!(v.season, None);
        assert_eq!(v.confidence(), Confidence::High);
    }

    #[test]
    fn release_serie_y_casos_raros() {
        let v = parse_release_name("Show.Name.S01E02.720p.HDTV.x264-GRP.mkv");
        assert_eq!(v.title.as_deref(), Some("Show Name"));
        assert_eq!((v.season, v.episode), (Some(1), Some(2)));
        assert_eq!(v.source.as_deref(), Some("HDTV"));

        let v = parse_release_name("Sintel/Sintel.mp4");
        assert_eq!(v.title.as_deref(), Some("Sintel"));
        assert_eq!(v.year, None);
        assert_eq!(v.confidence(), Confidence::Medium);

        let v = parse_release_name("2001 A Space Odyssey (1968) [1080p].mkv");
        assert_eq!(v.title.as_deref(), Some("2001 A Space Odyssey"));
        assert_eq!(v.year, Some(1968));

        let v = parse_release_name("Spider-Man.No.Way.Home.2021.2160p.BluRay.mkv");
        assert_eq!(v.title.as_deref(), Some("Spider-Man No Way Home"));
        assert_eq!(v.release_group, None);
    }

    #[test]
    fn archivos_de_subtitulo_del_torrent() {
        let f = |index, name: &str, size| FileInfo {
            index,
            name: name.into(),
            size,
            offset: 0,
        };
        let meta = Metadata {
            info_hash: InfoHash::from_bytes([0; 20]),
            name: "Sintel".into(),
            files: vec![
                f(0, "Sintel/Sintel.de.srt", 1000),
                f(1, "Sintel/Sintel.es.srt", 1000),
                f(2, "Sintel/Sintel.mp4", 129_000_000),
                f(3, "Sintel/poster.jpg", 1000),
            ],
            piece_length: 1,
            piece_count: 1,
            torrent_bytes: None,
        };
        let subs = subtitle_files_for(&meta, &meta.files[2]);
        assert_eq!(subs.len(), 2);
    }

    #[test]
    fn memoria_por_pelicula_ida_y_vuelta() {
        let dir = std::env::temp_dir().join(format!("tstream-test-submem-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mem = SubtitleMemory::new(dir.join("subtitles-memory.json"));
        let h = InfoHash::from_bytes([7; 20]);
        assert_eq!(mem.get(&h).unwrap(), None);
        let choice = SubtitleChoice {
            subtitle: "wyzie:123".into(),
            delay_secs: -0.3,
            label: Some("2 · Wyzie/rel".into()),
        };
        mem.set(&h, choice.clone()).unwrap();
        mem.set(&InfoHash::from_bytes([8; 20]), choice.clone())
            .unwrap();
        assert_eq!(mem.get(&h).unwrap(), Some(choice));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
