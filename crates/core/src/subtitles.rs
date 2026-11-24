//! `subtitles` — proveedores, detección del video, ranking, fusión ASS, sincronización, memoria
//! (FR-21–28, ADR-10/11/12). Interfaces definidas en F0; implementadas en F5/F6 (pedido del
//! usuario 2026-11-13: subtítulos antes que el resto de la UI).
//!
//! Submódulos:
//! - [`merge`]: lectura de SRT/ASS y fusión de hasta 5 en un único ASS (modo comparación, FR-25).
//! - [`providers`]: del torrent, Wyzie Subs, Subdivx (experimental), Gestdown, Subtitulamos y
//!   OpenSubtitles (FR-22, FR-24).
//! - [`secrets`]: API keys en el almacén seguro del sistema (NFR-16), nunca en `config.json`.
//! - [`session`]: lo que pasa mientras mpv está abierto: buscar, bajar, cargar, teclas, memoria.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::config::SubtitleLanguage;
use crate::engine::{FileInfo, Metadata};
use crate::magnet::InfoHash;
use crate::video_key::VideoKey;
use crate::Result;

mod fetch;
#[cfg(test)]
mod golden;
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
    /// Duración real (análisis): para [`fit_by_timing`].
    pub duration_secs: Option<f64>,
    /// Cuadros por segundo reales (análisis): para [`fit_by_timing`].
    pub fps: Option<f64>,
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

impl From<crate::release::ReleaseName> for VideoIdentity {
    fn from(r: crate::release::ReleaseName) -> Self {
        VideoIdentity {
            file_name: r.file_name,
            title: r.title,
            year: r.year,
            season: r.season,
            episode: r.episode,
            source: r.source,
            release_group: r.release_group,
            ..Default::default()
        }
    }
}

impl VideoIdentity {
    /// Identidad del video que se reproduce o mide: título/año del nombre del archivo y, si el
    /// archivo tiene nombre pobre ("video.mkv"), del nombre del torrent.
    pub fn for_file(file_name: &str, torrent_name: &str, info_hash: InfoHash, size: u64) -> Self {
        let mut video = Self::from(crate::release::parse_release_name(file_name));
        let from_torrent = crate::release::parse_release_name(torrent_name);
        if video.year.is_none() && from_torrent.year.is_some() {
            video.title = from_torrent.title;
            video.year = from_torrent.year;
        }
        video.info_hash = Some(info_hash);
        video.file_size = size;
        video
    }

    /// Toma el IMDb id del catálogo (FR-49) de la fila que es ESTE archivo (`file_index` dentro
    /// del torrent): mismo episodio, o película con el mismo archivo. Otra fila del mismo pack
    /// (otro episodio) no aplica.
    pub fn apply_catalog<'a>(
        &mut self,
        origins: impl IntoIterator<Item = &'a crate::library::CatalogOrigin>,
        file_index: usize,
    ) {
        let parsed = self
            .season
            .zip(self.episode)
            .map(|(s, e)| (u32::from(s), u32::from(e)));
        let found = origins.into_iter().find(|o| match o.season.zip(o.episode) {
            Some(ep) => Some(ep) == parsed,
            None => parsed.is_none() && o.file_idx.map_or(true, |i| i == file_index),
        });
        if let Some(o) = found {
            self.imdb_id = Some(o.imdb_id.clone());
        }
    }

    /// Qué película o episodio es, sin importar el torrent: dos torrents del mismo video
    /// comparten la carpeta de caché de subtítulos y se bajan una sola vez (2026-11-15).
    /// IMDb id (del catálogo) + SxxEyy; si no, título + año (película) o título + SxxEyy
    /// (episodio). Una película sin año es ambigua (remakes): por info hash, como antes.
    /// Va como nombre de carpeta.
    pub fn video_id(&self) -> String {
        let episode = self
            .season
            .zip(self.episode)
            .map(|(s, e)| format!("s{s:02}e{e:02}"));
        let title = self.title.as_deref().map(providers::normalized_title);
        let parts: Vec<String> = match (&self.imdb_id, title, self.year, episode) {
            (Some(imdb), _, _, ep) => [Some(imdb.to_lowercase()), ep]
                .into_iter()
                .flatten()
                .collect(),
            (None, Some(t), year, Some(ep)) if !t.is_empty() => {
                [Some(t), year.map(|y| y.to_string()), Some(ep)]
                    .into_iter()
                    .flatten()
                    .collect()
            }
            (None, Some(t), Some(y), None) if !t.is_empty() => vec![t, y.to_string()],
            _ => vec![self.info_hash.map_or_else(String::new, |h| h.to_hex())],
        };
        // Solo letras y números: el IMDb id viene del addon del catálogo y va a una ruta.
        let id: String = parts
            .join("-")
            .chars()
            .map(|c| if c.is_alphanumeric() { c } else { '-' })
            .take(100)
            .collect();
        if id.is_empty() {
            "desconocido".into()
        } else {
            id
        }
    }
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
        .filter(|f| crate::engine::is_video(&f.name))
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

/// Subtítulo que trae el video (grupo "Vienen con el video", 2026-11-18): pista embebida que leyó
/// mpv al analizar (`sid`) o archivo suelto dentro del torrent (`file`). Todos los idiomas.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NativeSub {
    /// Número de pista de subtítulo en mpv (`--sid`); `None` = archivo suelto.
    pub sid: Option<i64>,
    /// Ruta dentro del torrent, si es un archivo suelto.
    pub file: Option<String>,
    pub lang: Option<String>,
    pub title: Option<String>,
    pub codec: Option<String>,
    #[serde(default)]
    pub forced: bool,
}

/// Un nativo en español, como lo muestra la UI.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NativeSpanish {
    /// Para elegirlo: `embedded:<sid>` o la clave del archivo del torrent (`torrent:…`).
    pub key: String,
    pub variant: SpanishVariant,
    /// "SRT", "ASS", "PGS"… o "forzados".
    pub kind: String,
    /// "pista 3" o el nombre del archivo.
    pub place: String,
}

/// Proveedor de las claves de pistas embebidas (`embedded:<sid>`): se eligen en mpv con `sid`.
pub const EMBEDDED: &str = "embedded";

/// Los nativos en español de un torrent, en su orden (los forzados al final).
pub fn spanish_natives(subs: &[NativeSub], info_hash: InfoHash) -> Vec<NativeSpanish> {
    let mut out: Vec<(bool, NativeSpanish)> = subs
        .iter()
        .filter_map(|n| {
            let (variant, key, place, format) = match (&n.file, n.sid) {
                (Some(file), _) => {
                    let (lang, variant) = providers::lang_from_name(file)?;
                    let ext = Path::new(file).extension()?.to_str()?.to_uppercase();
                    (lang == SubtitleLanguage::Es).then_some(())?;
                    let name = file.rsplit(['/', '\\']).next().unwrap_or(file).to_string();
                    (variant, providers::torrent_key(info_hash, file), name, ext)
                }
                (None, Some(sid)) => {
                    let variant =
                        crate::audio::spanish_track(n.lang.as_deref(), n.title.as_deref())?;
                    let codec = match n.codec.as_deref().unwrap_or("") {
                        "subrip" | "srt" => "SRT".to_string(),
                        "hdmv_pgs_subtitle" | "pgs" => "PGS".to_string(),
                        "dvd_subtitle" => "VobSub".to_string(),
                        "mov_text" => "texto".to_string(),
                        other => other.to_uppercase(),
                    };
                    (
                        variant,
                        format!("{EMBEDDED}:{sid}"),
                        format!("pista {sid}"),
                        codec,
                    )
                }
                (None, None) => return None,
            };
            let kind = if n.forced {
                "forzados".to_string()
            } else {
                format
            };
            Some((
                n.forced,
                NativeSpanish {
                    key,
                    variant,
                    kind,
                    place,
                },
            ))
        })
        .collect();
    out.sort_by_key(|(forced, _)| *forced);
    out.into_iter().map(|(_, n)| n).collect()
}

// ---------- Proveedores (FR-24, R-02) ----------

/// Cuánto calza un subtítulo con el video (dropdown "Encontrados para vos", 2026-11-18), de mejor
/// a peor. Es la única regla: la deciden [`providers::release_match`] y [`fit_by_timing`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MatchKind {
    /// Hecho para este mismo archivo: hash de OpenSubtitles, mismo nombre o viene en el torrent.
    Exact,
    /// Mismo release: mismo grupo y la misma fuente (si se sabe).
    Release,
    /// Mismos fps y duración que el video.
    Fps,
    #[default]
    None,
}

pub use crate::audio::SpanishVariant;

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
    /// Cuadros por segundo del video para el que se hizo, si el proveedor lo dice.
    pub fps: Option<f64>,
    /// Segundo del último diálogo, si el proveedor lo dice (para comparar con la duración).
    pub last_secs: Option<f64>,
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
    /// Cuándo vuelve la cuota, si el servidor lo dijo.
    pub resets_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Sube a [`MatchKind::Fps`] los que no calzan por nombre pero se hicieron para los mismos fps y
/// terminan dentro del video (último diálogo entre el 80 % y el final + 5 s). Si el proveedor no
/// dice el último diálogo, alcanza con los fps. Sin fps del video (no se analizó), no cambia nada.
pub fn fit_by_timing(video: &VideoIdentity, all: &mut [SubtitleCandidate]) {
    let Some(fps) = video.fps else { return };
    for c in all.iter_mut().filter(|c| c.match_kind == MatchKind::None) {
        let same_fps = c.fps.is_some_and(|f| (f - fps).abs() < 0.05);
        let ends_inside = match (c.last_secs, video.duration_secs) {
            (Some(last), Some(d)) => last >= d * 0.8 && last <= d + 5.0,
            _ => true,
        };
        if same_fps && ends_inside {
            c.match_kind = MatchKind::Fps;
        }
    }
}

/// El orden de los subtítulos (2026-11-18; uno solo para "Encontrados", Premium y mpv):
/// 1. los del torrent primero (FR-22, ADR-12: vienen con el video),
/// 2. cuánto calza: exacto > mismo release > mismos fps y duración > nada,
/// 3. variante: latino > España > sin variante (Q-03),
/// 4. OpenSubtitles.com antes que el resto (la de mejor calidad),
/// 5. popularidad (descargas).
pub fn rank_order(a: &SubtitleCandidate, b: &SubtitleCandidate) -> std::cmp::Ordering {
    (a.provider != providers::TORRENT_PROVIDER)
        .cmp(&(b.provider != providers::TORRENT_PROVIDER))
        .then(a.match_kind.cmp(&b.match_kind))
        .then(a.variant.cmp(&b.variant))
        .then(
            (a.provider != providers::OPENSUBTITLES).cmp(&(b.provider != providers::OPENSUBTITLES)),
        )
        .then(b.downloads.cmp(&a.downloads))
}

/// Ordena con [`rank_order`] y deja los mejores `n` (5 por FR-24).
pub fn top_candidates(mut all: Vec<SubtitleCandidate>, n: usize) -> Vec<SubtitleCandidate> {
    all.sort_by(rank_order);
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
    /// Idioma de la sesión en que se eligió: una elección en español no aplica a una sesión en
    /// inglés. Los datos viejos no lo traen → español (el default, el único que había).
    #[serde(default)]
    pub language: SubtitleLanguage,
    /// Los que eligió para este video y después cambió por otro (no sincronizaron). Los cuenta
    /// el dropdown ("Probaste N").
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tried: Vec<String>,
}

/// `subtitles-memory.json`: por video ([`VideoKey`] como texto: cada episodio de un pack tiene
/// la suya), el subtítulo elegido y el desfase (FR-28). Los datos viejos están por info hash,
/// que es la misma clave que un magnet pegado (el torrent entero).
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

    pub fn get(&self, key: &VideoKey) -> Result<Option<SubtitleChoice>> {
        Ok(self.load().remove(&key.to_string()))
    }

    pub fn set(&self, key: &VideoKey, choice: SubtitleChoice) -> Result<()> {
        let mut map = self.load();
        map.insert(key.to_string(), choice);
        crate::fsutil::write_json_atomic(&self.path, &map)
    }

    /// Elige `subtitle` para ese video (dropdown del catálogo o teclas en mpv): el elegido antes
    /// pasa a probado (no sincronizó) y el desfase vuelve a 0 si es otro. Comparar todos
    /// ([`CHOICE_ALL`]) no cuenta como probar.
    pub fn choose(
        &self,
        key: &VideoKey,
        subtitle: &str,
        language: SubtitleLanguage,
    ) -> Result<SubtitleChoice> {
        let mut map = self.load();
        let mut c = map.remove(&key.to_string()).unwrap_or(SubtitleChoice {
            subtitle: String::new(),
            delay_secs: 0.0,
            label: None,
            language,
            tried: Vec::new(),
        });
        if c.subtitle != subtitle {
            let before = std::mem::replace(&mut c.subtitle, subtitle.to_string());
            if !before.is_empty()
                && before != CHOICE_ALL
                && subtitle != CHOICE_ALL
                && !c.tried.contains(&before)
            {
                c.tried.push(before);
            }
            c.delay_secs = 0.0;
            c.label = None;
        }
        c.tried.retain(|t| t != subtitle);
        c.language = language;
        map.insert(key.to_string(), c.clone());
        crate::fsutil::write_json_atomic(&self.path, &map)?;
        Ok(c)
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
            fps: None,
            last_secs: None,
        }
    }

    #[test]
    fn ranking_latino_espana_sin_variante_dentro_del_mismo_nivel() {
        use SpanishVariant::*;
        let all = vec![
            cand("wyzie", Unknown, MatchKind::None, 900),
            cand("wyzie", Spain, MatchKind::None, 900),
            cand("subdivx", Latino, MatchKind::None, 1),
            cand("wyzie", Unknown, MatchKind::Release, 0),
        ];
        let top = top_candidates(all, 5);
        let order: Vec<_> = top.iter().map(|c| (c.match_kind, c.variant)).collect();
        assert_eq!(
            order,
            vec![
                (MatchKind::Release, Unknown),
                (MatchKind::None, Latino),
                (MatchKind::None, Spain),
                (MatchKind::None, Unknown),
            ]
        );
    }

    #[test]
    fn mismos_fps_y_duracion_suben_de_nivel() {
        let video = VideoIdentity {
            fps: Some(23.976),
            duration_secs: Some(3000.0),
            ..Default::default()
        };
        let mut c = vec![
            cand("x", SpanishVariant::Unknown, MatchKind::None, 0),
            cand("x", SpanishVariant::Unknown, MatchKind::None, 1),
            cand("x", SpanishVariant::Unknown, MatchKind::None, 2),
            cand("x", SpanishVariant::Unknown, MatchKind::Release, 3),
        ];
        c[0].fps = Some(23.976);
        c[0].last_secs = Some(2900.0);
        c[1].fps = Some(25.0);
        c[2].fps = Some(23.976);
        c[2].last_secs = Some(1200.0); // termina mucho antes: es de otro corte
        c[3].fps = Some(23.976);
        fit_by_timing(&video, &mut c);
        let kinds: Vec<_> = c.iter().map(|c| c.match_kind).collect();
        assert_eq!(
            kinds,
            vec![
                MatchKind::Fps,
                MatchKind::None,
                MatchKind::None,
                MatchKind::Release
            ]
        );
    }

    #[test]
    fn ranking_hash_release_duracion_popularidad() {
        use SpanishVariant::Latino;
        let all = vec![
            cand("wyzie", Latino, MatchKind::None, 10_000),
            cand("wyzie", Latino, MatchKind::Fps, 5),
            cand("wyzie", Latino, MatchKind::Release, 1),
            cand("wyzie", Latino, MatchKind::Exact, 0),
            cand("wyzie", Latino, MatchKind::Release, 50),
        ];
        let top = top_candidates(all, 5);
        let order: Vec<_> = top.iter().map(|c| (c.match_kind, c.downloads)).collect();
        assert_eq!(
            order,
            vec![
                (MatchKind::Exact, 0),
                (MatchKind::Release, 50),
                (MatchKind::Release, 1),
                (MatchKind::Fps, 5),
                (MatchKind::None, 10_000),
            ]
        );
    }

    #[test]
    fn ranking_torrent_primero_y_corta_en_n() {
        let mut all: Vec<_> = (0..8)
            .map(|i| cand("wyzie", SpanishVariant::Latino, MatchKind::Exact, i))
            .collect();
        all.push(cand(
            providers::TORRENT_PROVIDER,
            SpanishVariant::Unknown,
            MatchKind::Exact,
            0,
        ));
        let top = top_candidates(all, MAX_SUBTITLES);
        assert_eq!(top.len(), 5);
        assert_eq!(top[0].provider, providers::TORRENT_PROVIDER);
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
    fn confianza_por_el_nombre() {
        let id = |name| VideoIdentity::from(crate::release::parse_release_name(name));
        let v = id("The.Martian.2015.1080p.WEB-DL.x264-NTb.mkv");
        assert_eq!(v.confidence(), Confidence::High);
        assert_eq!(id("Sintel/Sintel.mp4").confidence(), Confidence::Medium);
        let v = id("Show.Name.S01E02.720p.HDTV.x264-GRP.mkv");
        assert_eq!(v.confidence(), Confidence::High);
        // Archivo con nombre pobre: título y año salen del nombre del torrent.
        let h = InfoHash::from_bytes([1; 20]);
        let v = VideoIdentity::for_file("video.mkv", "The.Martian.2015.1080p", h, 9);
        assert_eq!((v.year, v.file_size, v.info_hash), (Some(2015), 9, Some(h)));
    }

    #[test]
    fn mismo_video_en_distintos_torrents_misma_identidad() {
        let (a, b) = (InfoHash::from_bytes([1; 20]), InfoHash::from_bytes([2; 20]));
        let ep = |name: &str, h| VideoIdentity::for_file(name, name, h, 1);
        // Sin catálogo: título + SxxEyy (o + año en películas), sin importar release ni torrent.
        let x = ep("Game.of.Thrones.S03E02.720p.HDTV.x264-IMMERSE.mkv", a);
        let y = ep("Game Of Thrones S03E02 1080p BluRay-DEMAND.mkv", b);
        assert_eq!(x.video_id(), "game-of-thrones-s03e02");
        assert_eq!(x.video_id(), y.video_id());
        assert_eq!(
            ep("Dune.Part.Two.2024.2160p.WEB-DL.mkv", a).video_id(),
            ep("Dune Part Two (2024) 1080p.mkv", b).video_id()
        );
        // Película sin año: ambigua (remakes) → por torrent, como antes.
        assert_eq!(ep("Dune.1080p.mkv", a).video_id(), a.to_hex());
        // Con catálogo: IMDb id + episodio, solo si la fila es este archivo.
        let origin = |s: Option<u32>, e: Option<u32>, file_idx| crate::library::CatalogOrigin {
            video_id: String::new(),
            imdb_id: "tt0944947".into(),
            title: "Game of Thrones".into(),
            year: None,
            season: s,
            episode: e,
            file_idx,
            addons: Vec::new(),
        };
        let mut x = x;
        x.apply_catalog(&[origin(Some(3), Some(1), None)], 0);
        assert_eq!(x.imdb_id, None, "otro episodio del pack: no aplica");
        x.apply_catalog(
            &[
                origin(Some(3), Some(1), None),
                origin(Some(3), Some(2), None),
            ],
            0,
        );
        assert_eq!(x.video_id(), "tt0944947-s03e02");
        let mut movie = ep("Dune.Part.Two.2024.mkv", a);
        movie.apply_catalog(&[origin(None, None, Some(4))], 3);
        assert_eq!(movie.imdb_id, None, "otro archivo del torrent");
        movie.apply_catalog(&[origin(None, None, Some(4))], 4);
        assert_eq!(movie.video_id(), "tt0944947");
    }

    fn torrent_meta(files: &[(&str, u64)]) -> Metadata {
        Metadata {
            info_hash: InfoHash::from_bytes([0; 20]),
            name: "Sintel".into(),
            files: files
                .iter()
                .enumerate()
                .map(|(index, (name, size))| FileInfo {
                    index,
                    name: (*name).into(),
                    size: *size,
                    offset: 0,
                })
                .collect(),
            piece_length: 1,
            piece_count: 1,
            torrent_bytes: None,
        }
    }

    fn names(files: Vec<FileInfo>) -> Vec<String> {
        files.into_iter().map(|f| f.name).collect()
    }

    #[test]
    fn archivos_de_subtitulo_del_torrent() {
        let meta = torrent_meta(&[
            ("Sintel/Sintel.de.srt", 1000),
            ("Sintel/Sintel.es.srt", 1000),
            ("Sintel/Sintel.mp4", 129_000_000),
            ("Sintel/poster.jpg", 1000),
            ("Sintel/Sintel.en.SRT", 1000), // extensión en mayúsculas
            ("Sintel/Sintel.fr.srt", 3 * 1024 * 1024), // > 2 MB: no es un subtítulo de texto
        ]);
        let subs = subtitle_files_for(&meta, &meta.files[2]);
        // Sin filtrar idioma (eso lo hace quien lo muestra), en el orden del torrent.
        assert_eq!(
            names(subs),
            [
                "Sintel/Sintel.de.srt",
                "Sintel/Sintel.es.srt",
                "Sintel/Sintel.en.SRT"
            ]
        );
    }

    #[test]
    fn subtitulos_de_un_pack_solo_los_del_video_elegido() {
        let meta = torrent_meta(&[
            ("Serie.S01E01.mkv", 500_000_000),
            ("Serie.S01E02.mkv", 500_000_000),
            ("Subs/Serie.S01E01.es.srt", 1000),
            ("Subs/Serie.S01E02.es.srt", 1000),
            ("Subs/Serie.S01E01.en.ass", 1000),
            ("Subs/otro.srt", 1000), // no lleva el nombre de ningún video
        ]);
        assert_eq!(
            names(subtitle_files_for(&meta, &meta.files[0])),
            ["Subs/Serie.S01E01.es.srt", "Subs/Serie.S01E01.en.ass"]
        );
        assert_eq!(
            names(subtitle_files_for(&meta, &meta.files[1])),
            ["Subs/Serie.S01E02.es.srt"]
        );
    }

    #[test]
    fn nativos_en_espanol() {
        let hash = InfoHash::from_bytes([1; 20]);
        let sub =
            |sid, file: Option<&str>, lang: Option<&str>, codec: Option<&str>, forced| NativeSub {
                sid,
                file: file.map(String::from),
                lang: lang.map(String::from),
                title: None,
                codec: codec.map(String::from),
                forced,
            };
        let subs = [
            sub(Some(1), None, Some("spa"), Some("subrip"), true), // forzados: al final
            sub(None, Some("Sintel/Sintel.es.srt"), None, None, false),
            sub(Some(2), None, Some("spa"), Some("subrip"), false),
            sub(Some(3), None, Some("es"), Some("hdmv_pgs_subtitle"), false),
            sub(Some(4), None, Some("eng"), Some("subrip"), false), // inglés: se descarta
            sub(None, Some("Sintel/Sintel.en.srt"), None, None, false),
            sub(None, Some("Sintel/Sintel.de.srt"), None, None, false),
            sub(None, None, Some("spa"), None, false), // ni pista ni archivo
        ];
        let got = spanish_natives(&subs, hash);
        let summary: Vec<(&str, &str, &str)> = got
            .iter()
            .map(|n| (n.key.as_str(), n.kind.as_str(), n.place.as_str()))
            .collect();
        let file_key = providers::torrent_key(hash, "Sintel/Sintel.es.srt");
        assert_eq!(
            summary,
            [
                (file_key.as_str(), "SRT", "Sintel.es.srt"),
                ("embedded:2", "SRT", "pista 2"),
                ("embedded:3", "PGS", "pista 3"),
                ("embedded:1", "forzados", "pista 1"),
            ]
        );
    }

    #[test]
    fn memoria_por_pelicula_ida_y_vuelta() {
        let dir = crate::fsutil::test_dir("submem");
        let mem = SubtitleMemory::new(dir.join("subtitles-memory.json"));
        let h = VideoKey::whole(InfoHash::from_bytes([7; 20]));
        assert_eq!(mem.get(&h).unwrap(), None);
        let choice = SubtitleChoice {
            subtitle: "wyzie:123".into(),
            delay_secs: -0.3,
            label: Some("2 · Wyzie/rel".into()),
            language: SubtitleLanguage::En,
            tried: Vec::new(),
        };
        mem.set(&h, choice.clone()).unwrap();
        mem.set(
            &VideoKey::whole(InfoHash::from_bytes([8; 20])),
            choice.clone(),
        )
        .unwrap();
        assert_eq!(mem.get(&h).unwrap(), Some(choice.clone()));
        // Otro episodio del mismo pack no hereda la elección.
        let e2 = VideoKey::new(InfoHash::from_bytes([7; 20]), Some((3, 2)), None);
        assert_eq!(mem.get(&e2).unwrap(), None);
        // Dato viejo (por info hash): es la clave del torrent entero.
        std::fs::write(
            dir.join("subtitles-memory.json"),
            format!(
                r#"{{"{}":{{"subtitle":"wyzie:9","delay_secs":1.0}}}}"#,
                "09".repeat(20)
            ),
        )
        .unwrap();
        let old = VideoKey::whole(InfoHash::from_bytes([9; 20]));
        assert_eq!(mem.get(&old).unwrap().unwrap().subtitle, "wyzie:9");
        // Datos de antes del campo `language`: se leen como español.
        let old: SubtitleChoice =
            serde_json::from_str(r#"{"subtitle":"wyzie:1","delay_secs":0.0}"#).unwrap();
        assert_eq!(old.language, SubtitleLanguage::Es);
    }

    #[test]
    fn elegir_otro_cuenta_el_anterior_como_probado() {
        let dir = crate::fsutil::test_dir("probados");
        let mem = SubtitleMemory::new(dir.join("subtitles-memory.json"));
        let es = SubtitleLanguage::Es;
        let k = VideoKey::whole(InfoHash::from_bytes([3; 20]));
        mem.choose(&k, "wyzie:1", es).unwrap();
        mem.choose(&k, CHOICE_ALL, es).unwrap(); // comparar no es probar
        mem.choose(&k, "wyzie:2", es).unwrap();
        let c = mem.choose(&k, "wyzie:3", es).unwrap();
        assert_eq!(c.subtitle, "wyzie:3");
        assert_eq!(c.tried, vec!["wyzie:2".to_string()]);
        // Volver a uno probado lo saca de probados.
        let c = mem.choose(&k, "wyzie:2", es).unwrap();
        assert_eq!(c.tried, vec!["wyzie:3".to_string()]);
        let otro = VideoKey::whole(InfoHash::from_bytes([4; 20]));
        assert_eq!(mem.get(&otro).unwrap(), None, "es por opción");
    }
}
