//! Buscar, rankear y bajar subtítulos, sin mpv (FR-22, FR-24, FR-28). Lo usa la sesión al
//! reproducir ([`super::session`]) y el analizador al analizar (vía `subtitles::session::fetch`).
//!
//! En segundo plano: hash del video, IMDb id, búsqueda en torrent, Wyzie, Subdivx, Gestdown,
//! Subtitulamos y OpenSubtitles.org (en paralelo, en el idioma elegido y en el otro), ranking y
//! descarga de hasta 5. OpenSubtitles.com (cuota diaria) no entra acá: es el Premium del dropdown,
//! de a uno y a pedido ([`add_saved`]).
//!
//! Idiomas (2026-11-15): primero el elegido (español: latino, después España/sin variante) y,
//! si no llegan a 5, se completa con el otro (inglés). Una sola tanda, un solo trabajo.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use super::providers::{
    self, GestdownProvider, OpenSubtitlesOrgProvider, SubdivxProvider, SubtitleProvider,
    SubtitulamosProvider, TorrentProvider, TorrentSubtitleFile, WyzieProvider,
};
use super::{
    fit_by_timing, rank_order, top_candidates, MatchKind, SpanishVariant, SubtitleCandidate,
    SubtitleChoice, VideoIdentity, CHOICE_ALL, MAX_SUBTITLES,
};
use crate::config::SubtitleLanguage;

const SEARCH_TIMEOUT: Duration = Duration::from_secs(20);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(40);
const HASH_TIMEOUT: Duration = Duration::from_secs(10);

pub type LogFn = Arc<dyn Fn(String) + Send + Sync>;

/// Qué buscar y dónde dejarlo, sin mpv: lo usa la sesión al reproducir y el analizador al
/// analizar (2026-11-14: "buscar y descargar 5 subtítulos en español al analizar").
pub struct Fetch {
    pub video: VideoIdentity,
    /// URL del video en el motor para el hash; `None` si ya viene en `video.movie_hash`.
    pub video_url: Option<String>,
    pub torrent_files: Vec<TorrentSubtitleFile>,
    /// El idioma elegido: va primero; el otro completa hasta 5.
    pub language: SubtitleLanguage,
    /// Carpeta de subtítulos de ESTE video ([`VideoIdentity::video_id`]), con su `subs.json`.
    pub cache_dir: PathBuf,
    pub remembered: Option<SubtitleChoice>,
    pub log: LogFn,
}

/// Busca en todas las fuentes y baja hasta [`MAX_SUBTITLES`] (a `cache_dir`, que funciona de
/// caché: lo ya bajado no se vuelve a pedir). Nunca falla: lo que no anda va al log.
pub async fn fetch(req: Fetch) -> Vec<(SubtitleCandidate, PathBuf)> {
    let log = req.log.clone();
    let lang = req.language;
    let remembered = req.remembered.clone();
    if lang == SubtitleLanguage::None {
        return Vec::new();
    }
    // 2026-11-15: "si ya está guardado, que lea los ya guardados, que no haya el searching".
    if let Some(mut saved) = load_saved(&req.cache_dir, lang) {
        log(format!(
            "subtítulos: {} guardado(s) con el video, sin buscar",
            saved.len()
        ));
        refit(&req.video, &mut saved);
        if let Some(i) = remembered
            .as_ref()
            .and_then(|choice| saved.iter().position(|(c, _)| c.key() == choice.subtitle))
        {
            let c = saved.remove(i);
            saved.insert(0, c);
        }
        return saved;
    }
    let languages = languages(lang);
    // 1. Identidad: hash del video (inicio/fin) e IMDb id (si el catálogo no lo dio), en paralelo.
    let mut video = req.video.clone();
    let (hash, imdb) = tokio::join!(
        tokio::time::timeout(HASH_TIMEOUT, async {
            match &req.video_url {
                Some(url) => video_hash(url, video.file_size).await,
                None => None,
            }
        }),
        async {
            match &video.imdb_id {
                Some(id) => Some(id.clone()),
                None => providers::resolve_imdb(&video).await,
            }
        },
    );
    // Sin URL (al analizar) puede venir ya calculado desde el archivo en disco.
    video.movie_hash = hash.ok().flatten().or(video.movie_hash);
    video.imdb_id = imdb;
    log(format!(
        "subtítulos: buscando en {} (y {}) · {} · hash {} · IMDb {}",
        languages[0].name_es(),
        languages[1].name_es(),
        video.title.as_deref().unwrap_or("(sin título)"),
        video
            .movie_hash
            .map_or("—".to_string(), |h| format!("{h:016x}")),
        video.imdb_id.as_deref().unwrap_or("—"),
    ));

    // 2. Fuentes gratis en paralelo: torrent, Wyzie, Subdivx, Gestdown, Subtitulamos y
    //    OpenSubtitles.org anónimo (sin key, como la app Subs; Q-01..Q-04).
    let free: Vec<Arc<dyn SubtitleProvider>> = vec![
        Arc::new(TorrentProvider {
            files: req.torrent_files.clone(),
        }),
        Arc::new(WyzieProvider::from_store()),
        Arc::new(SubdivxProvider),
        Arc::new(GestdownProvider),
        Arc::new(SubtitulamosProvider),
        Arc::new(OpenSubtitlesOrgProvider::default()),
    ];
    let mut all = Vec::new();
    for (provider, result) in search_all(&free, &video, &languages).await {
        match result {
            Ok(found) => {
                log(format!(
                    "subtítulos: {} → {} candidato(s)",
                    providers::display_name(provider),
                    found.len()
                ));
                all.extend(found);
            }
            Err(e) => log(format!(
                "subtítulos: {} omitido: {e}",
                providers::display_name(provider)
            )),
        }
    }
    fit_by_timing(&video, &mut all);
    let mut ranked = top_candidates(all, usize::MAX);
    // El idioma elegido entero antes que el otro (estable: conserva el ranking adentro).
    ranked.sort_by_key(|c| c.language != lang);
    if let Some(choice) = &remembered {
        // FR-28: el elegido la otra vez va primero (si sigue apareciendo).
        if let Some(i) = ranked.iter().position(|c| c.key() == choice.subtitle) {
            let c = ranked.remove(i);
            ranked.insert(0, c);
        }
    }
    let mut loaded = download_best(ranked, MAX_SUBTITLES, &free, &req.cache_dir, &log).await;

    // 3. El recordado, aunque hoy no haya salido entre los 5: desde la caché (FR-28).
    if let Some(choice) = &remembered {
        let present = loaded.iter().any(|(c, _)| c.key() == choice.subtitle);
        if choice.subtitle != CHOICE_ALL && !present {
            if let Some(path) = providers::cached_by_key(&req.cache_dir, &choice.subtitle) {
                let label = choice
                    .label
                    .clone()
                    .unwrap_or_else(|| choice.subtitle.clone());
                loaded.insert(
                    0,
                    (
                        remembered_candidate(&choice.subtitle, &label, choice.language),
                        path,
                    ),
                );
                loaded.truncate(MAX_SUBTITLES);
            }
        }
    }
    dedup_by_content(&mut loaded, &log);
    save(&req.cache_dir, lang, &loaded);
    loaded
}

/// Índice de lo bajado para un video (`subs.json` en su carpeta de subtítulos): qué es cada
/// archivo, para reusarlo sin volver a buscar.
const SAVED_FILE: &str = "subs.json";
/// 2: guarda fps y último diálogo de cada uno, para volver a ver cuánto calza (el video puede
/// analizarse después de buscar).
const SAVED_VERSION: u32 = 2;

#[derive(serde::Serialize, serde::Deserialize)]
struct Saved {
    /// [`SAVED_VERSION`]: uno viejo (sin fps ni último diálogo, 2026-11-18) se busca de nuevo.
    #[serde(default)]
    version: u32,
    /// El idioma elegido cuando se bajaron: con otro idioma se busca de nuevo.
    language: SubtitleLanguage,
    subs: Vec<SavedSub>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct SavedSub {
    key: String,
    release_name: String,
    language: SubtitleLanguage,
    downloads: u32,
    #[serde(default)]
    match_kind: MatchKind,
    #[serde(default)]
    variant: SpanishVariant,
    #[serde(default)]
    fps: Option<f64>,
    #[serde(default)]
    last_secs: Option<f64>,
    /// Nombre del archivo dentro de la misma carpeta.
    file: String,
}

/// Lo guardado con el video, si es del mismo idioma y siguen todos sus archivos.
fn load_saved(dir: &Path, lang: SubtitleLanguage) -> Option<Vec<(SubtitleCandidate, PathBuf)>> {
    let saved: Saved = crate::fsutil::read_json(&dir.join(SAVED_FILE)).ok()??;
    if saved.version < SAVED_VERSION || saved.language != lang || saved.subs.is_empty() {
        return None;
    }
    saved
        .subs
        .into_iter()
        .map(|s| {
            let path = dir.join(&s.file);
            path.is_file().then(|| {
                let mut c = remembered_candidate(&s.key, &s.release_name, s.language);
                c.release_name = s.release_name;
                c.downloads = s.downloads;
                c.match_kind = s.match_kind;
                c.variant = s.variant;
                c.fps = s.fps;
                c.last_secs = s.last_secs;
                (c, path)
            })
        })
        .collect()
}

/// Escribe el índice; los archivos ya tienen que estar en `dir`. Sin resultados no escribe nada
/// (la próxima vez se vuelve a buscar).
fn save(dir: &Path, lang: SubtitleLanguage, loaded: &[(SubtitleCandidate, PathBuf)]) {
    let subs: Vec<SavedSub> = loaded
        .iter()
        .filter(|(_, path)| path.parent() == Some(dir))
        .filter_map(|(c, path)| {
            Some(SavedSub {
                key: c.key(),
                release_name: c.release_name.clone(),
                language: c.language,
                downloads: c.downloads,
                match_kind: c.match_kind,
                variant: c.variant,
                fps: c.fps,
                last_secs: c.last_secs,
                file: path.file_name()?.to_str()?.to_string(),
            })
        })
        .collect();
    if subs.is_empty() {
        return;
    }
    let saved = Saved {
        version: SAVED_VERSION,
        language: lang,
        subs,
    };
    if let Err(e) = crate::fsutil::write_json_atomic(&dir.join(SAVED_FILE), &saved) {
        tracing::warn!("no se pudo guardar {SAVED_FILE}: {e}");
    }
}

/// Copia lo bajado para un video a la carpeta de otro torrent del mismo video (análisis de
/// varios torrents: se busca una vez) y escribe su índice. No pisa lo que ya está.
pub fn save_copy(dir: &Path, lang: SubtitleLanguage, got: &[(SubtitleCandidate, PathBuf)]) {
    if got.is_empty() || std::fs::create_dir_all(dir).is_err() {
        return;
    }
    let copied: Vec<(SubtitleCandidate, PathBuf)> = got
        .iter()
        .filter_map(|(c, src)| {
            let dest = dir.join(src.file_name()?);
            (dest.is_file() || std::fs::copy(src, &dest).is_ok()).then(|| (c.clone(), dest))
        })
        .collect();
    save(dir, lang, &copied);
}

/// Cuánto calza lo guardado con lo que hoy se sabe del video (la opción pudo analizarse después
/// de buscar: fps y duración) y en el orden de siempre. Lo exacto de antes (por hash) se mantiene.
fn refit(video: &VideoIdentity, saved: &mut [(SubtitleCandidate, PathBuf)]) {
    for (c, _) in saved.iter_mut() {
        c.match_kind = c
            .match_kind
            .min(providers::release_match(video, &c.release_name));
    }
    let mut cands: Vec<SubtitleCandidate> = saved.iter().map(|(c, _)| c.clone()).collect();
    fit_by_timing(video, &mut cands);
    for ((c, _), fresh) in saved.iter_mut().zip(cands) {
        c.match_kind = fresh.match_kind;
    }
    saved.sort_by(|(a, _), (b, _)| rank_order(a, b));
}

/// Suma uno bajado aparte (Premium, 2026-11-18) a lo guardado con el video: el reproductor lo
/// carga con los demás. Va primero (lo eligió el usuario); el archivo ya tiene que estar en `dir`.
pub fn add_saved(dir: &Path, lang: SubtitleLanguage, cand: SubtitleCandidate, path: PathBuf) {
    let mut all = load_saved(dir, lang).unwrap_or_default();
    all.retain(|(c, _)| c.key() != cand.key());
    all.insert(0, (cand, path));
    save(dir, lang, &all);
}

/// Junta lo bajado desde el catálogo (`from`, sin dueño) con lo ya guardado del video en `into`
/// (2026-11-18: un Premium elegido después de la primera reproducción tiene que llegar a mpv).
/// Lo de `from` va primero; no pisa archivos que ya están.
pub fn merge_saved(from: &Path, into: &Path, lang: SubtitleLanguage) {
    let Some(fresh) = load_saved(from, lang) else {
        return;
    };
    let mut all = load_saved(into, lang).unwrap_or_default();
    for (c, src) in fresh.into_iter().rev() {
        let Some(dest) = src.file_name().map(|n| into.join(n)) else {
            continue;
        };
        if !dest.is_file() && std::fs::copy(&src, &dest).is_err() {
            continue;
        }
        all.retain(|(old, _)| old.key() != c.key());
        all.insert(0, (c, dest));
    }
    save(into, lang, &all);
}

/// El elegido primero; el otro completa (2026-11-15: "en español o inglés").
fn languages(chosen: SubtitleLanguage) -> [SubtitleLanguage; 2] {
    match chosen {
        SubtitleLanguage::En => [SubtitleLanguage::En, SubtitleLanguage::Es],
        _ => [SubtitleLanguage::Es, SubtitleLanguage::En],
    }
}

/// Cada proveedor en cada idioma, todo en paralelo.
async fn search_all(
    providers: &[Arc<dyn SubtitleProvider>],
    video: &VideoIdentity,
    languages: &[SubtitleLanguage],
) -> Vec<(&'static str, crate::Result<Vec<SubtitleCandidate>>)> {
    let mut set = tokio::task::JoinSet::new();
    let pairs = providers
        .iter()
        .flat_map(|p| languages.iter().map(move |l| (p, *l)));
    for (i, (p, lang)) in pairs.enumerate() {
        let p = p.clone();
        let video = video.clone();
        set.spawn(async move {
            let r = match tokio::time::timeout(SEARCH_TIMEOUT, p.search(&video, lang)).await {
                Ok(r) => r,
                Err(_) => Err(crate::CoreError::Timeout {
                    what: "búsqueda de subtítulos",
                    secs: SEARCH_TIMEOUT.as_secs(),
                }),
            };
            (i, p.id(), r)
        });
    }
    let mut out = Vec::new();
    // Una tarea con panic (Err) no corta las demás.
    while let Some(joined) = set.join_next().await {
        out.extend(joined.ok());
    }
    out.sort_by_key(|(i, _, _)| *i);
    out.into_iter().map(|(_, id, r)| (id, r)).collect()
}

/// Baja en orden de ranking hasta tener `needed` (en paralelo por tandas; si uno falla,
/// entra el siguiente de la lista).
async fn download_best(
    candidates: Vec<SubtitleCandidate>,
    needed: usize,
    providers: &[Arc<dyn SubtitleProvider>],
    cache_dir: &std::path::Path,
    log: &LogFn,
) -> Vec<(SubtitleCandidate, PathBuf)> {
    let mut out = Vec::new();
    let mut rest = candidates.into_iter();
    while out.len() < needed {
        let batch: Vec<SubtitleCandidate> = rest.by_ref().take(needed - out.len()).collect();
        if batch.is_empty() {
            break;
        }
        log(format!("subtítulos: bajando {}", batch.len()));
        let mut set = tokio::task::JoinSet::new();
        for (i, cand) in batch.into_iter().enumerate() {
            let Some(p) = providers.iter().find(|p| p.id() == cand.provider).cloned() else {
                continue;
            };
            let dir = cache_dir.to_path_buf();
            set.spawn(async move {
                let r = tokio::time::timeout(DOWNLOAD_TIMEOUT, p.download(&cand, &dir)).await;
                (i, cand, r)
            });
        }
        let mut results = Vec::new();
        while let Some(joined) = set.join_next().await {
            results.extend(joined.ok());
        }
        results.sort_by_key(|(i, _, _)| *i);
        for (_, cand, r) in results {
            match r {
                Ok(Ok(path)) => {
                    log(format!("subtítulos: bajado {}", cand.key()));
                    out.push((cand, path));
                }
                Ok(Err(e)) => log(format!("subtítulos: no se pudo bajar {}: {e}", cand.key())),
                Err(_) => log(format!("subtítulos: {} tardó demasiado", cand.key())),
            }
        }
    }
    out
}

/// El mismo archivo puede venir de dos proveedores: se deja el primero (mejor rankeado).
fn dedup_by_content(loaded: &mut Vec<(SubtitleCandidate, PathBuf)>, log: &LogFn) {
    use std::hash::{Hash, Hasher};
    let mut seen = std::collections::HashSet::new();
    loaded.retain(|(cand, path)| {
        let Ok(bytes) = std::fs::read(path) else {
            return false;
        };
        let mut h = std::collections::hash_map::DefaultHasher::new();
        bytes.hash(&mut h);
        let fresh = seen.insert(h.finish());
        if !fresh {
            log(format!("subtítulos: {} repetido, se omite", cand.key()));
        }
        fresh
    });
}

pub(super) fn remembered_candidate(
    key: &str,
    label: &str,
    language: SubtitleLanguage,
) -> SubtitleCandidate {
    let (provider, id) = key.split_once(':').unwrap_or(("?", key));
    let provider = providers::ALL
        .into_iter()
        .find(|p| *p == provider)
        .unwrap_or("?");
    // La etiqueta guardada ya trae "N · fuente/release": se usa el release.
    let release = label.split_once('/').map_or(label, |(_, r)| r).to_string();
    SubtitleCandidate {
        provider,
        provider_id: id.to_string(),
        release_name: release,
        language,
        match_kind: super::MatchKind::None,
        downloads: 0,
        variant: super::SpanishVariant::Unknown,
        url: String::new(),
        fps: None,
        last_secs: None,
    }
}

/// Hash OpenSubtitles leyendo 64 KiB del principio y del final por el motor (el principio ya
/// está precargado; el final lo pide el stream).
async fn video_hash(url: &str, size: u64) -> Option<u64> {
    if url.is_empty() || size == 0 {
        return None;
    }
    let chunk = 65_536u64.min(size);
    let head = providers::http::fetch_range(url, 0, chunk).await.ok()?;
    let tail = providers::http::fetch_range(url, size - chunk, chunk)
        .await
        .ok()?;
    Some(super::movie_hash(size, &head, &tail))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lo_guardado_se_reusa_solo_con_el_mismo_idioma_y_sus_archivos() {
        let dir =
            std::env::temp_dir().join(format!("streamonte-test-saved-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("wyzie_1.srt");
        std::fs::write(&file, b"1\n00:00:01,000 --> 00:00:02,000\nHola\n").unwrap();
        let mut cand = remembered_candidate("wyzie:1", "Peli.2024.1080p", SubtitleLanguage::Es);
        cand.downloads = 42;
        save(&dir, SubtitleLanguage::Es, &[(cand, file.clone())]);

        let got = load_saved(&dir, SubtitleLanguage::Es).expect("guardado");
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].0.key(), "wyzie:1");
        assert_eq!(got[0].0.release_name, "Peli.2024.1080p");
        assert_eq!(got[0].0.downloads, 42);
        assert_eq!(got[0].1, file);
        // Otro idioma elegido: se busca de nuevo.
        assert!(load_saved(&dir, SubtitleLanguage::En).is_none());
        // Falta un archivo: se busca de nuevo.
        std::fs::remove_file(&file).unwrap();
        assert!(load_saved(&dir, SubtitleLanguage::Es).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
