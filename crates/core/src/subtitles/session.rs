//! Subtítulos mientras mpv está abierto (spec 04, flujo 3; FR-22, 24–26, 28).
//!
//! 1. Registra las teclas de la app en mpv con `define-section` + `enable-section` (IPC):
//!    son una capa encima de la config del usuario, que no se toca (FR-34). Se eligió esto y no
//!    `--input-conf` porque `--input-conf` REEMPLAZA el `input.conf` personal del usuario.
//! 2. En segundo plano (NFR-10: la película ya está andando): hash del video, IMDb id, búsqueda
//!    en torrent → Wyzie → Subdivx (en paralelo), ranking, descarga de hasta 5; si faltan,
//!    OpenSubtitles (cuota de 20/día, va último).
//! 3. Carga en mpv cada uno como pista propia + el ASS fusionado "comparar" (FR-25, ADR-11).
//! 4. Teclas: 1–5 elige uno · 0 todos · S on/off · Z/X ±0,1 s · Shift+Z/X ±1 s · R reset.
//!    Cada elección y cada ajuste se recuerdan por info hash (FR-28).

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::broadcast::error::RecvError;

use super::providers::{
    self, OpenSubtitlesProvider, SubdivxProvider, TorrentProvider, TorrentSubtitleFile,
    WyzieProvider,
};
use super::{
    apply_sync_key, merge_ass, sync_message, top_candidates, LabeledSubtitle, SubtitleCandidate,
    SubtitleChoice, SubtitleMemory, SubtitleProvider, SyncKey, VideoIdentity, CHOICE_ALL,
    MAX_SUBTITLES,
};
use crate::config::SubtitleLanguage;
use crate::magnet::InfoHash;
use crate::player::{MpvControl, MpvEvent};

/// Teclas de la app (FR-25, FR-26). `Z`/`X` en mayúscula = Shift.
const KEY_SECTION: &str = "tstream-subtitulos";
const KEY_BINDINGS: &str = "\
1 script-message tstream sub-1
2 script-message tstream sub-2
3 script-message tstream sub-3
4 script-message tstream sub-4
5 script-message tstream sub-5
0 script-message tstream sub-all
s script-message tstream sub-toggle
S script-message tstream sub-toggle
z script-message tstream sync-earlier
Z script-message tstream sync-earlier-big
x script-message tstream sync-later
X script-message tstream sync-later-big
r script-message tstream sync-reset
R script-message tstream sync-reset
";

const SEARCH_TIMEOUT: Duration = Duration::from_secs(20);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(40);
const HASH_TIMEOUT: Duration = Duration::from_secs(10);
const OSD: Duration = Duration::from_secs(4);
const SYNC_HELP: &str = "Z: la voz llega antes · X: la voz llega después · Shift = 1 s · R: reset";

pub type LogFn = Arc<dyn Fn(String) + Send + Sync>;

pub struct SessionRequest {
    pub mpv: Arc<dyn MpvControl>,
    pub info_hash: InfoHash,
    /// Ya parseado del nombre (sin hash ni IMDb: los calcula la sesión).
    pub video: VideoIdentity,
    /// URL del video en el motor (para leer los 64 KiB del principio y del final → hash).
    pub video_url: String,
    pub torrent_files: Vec<TorrentSubtitleFile>,
    pub language: SubtitleLanguage,
    /// Audio ya en español (eligió Latino): se cargan igual pero arrancan ocultos (S los muestra).
    pub start_hidden: bool,
    /// Carpeta de caché de ESTE video (`subtitle_cache_dir()/<hash>`).
    pub cache_dir: PathBuf,
    pub memory_file: PathBuf,
    pub log: LogFn,
}

struct Track {
    key: String,
    label: String,
    sid: Option<i64>,
}

#[derive(Default)]
struct State {
    /// `true` cuando terminó la búsqueda (con o sin resultados).
    ready: bool,
    tracks: Vec<Track>,
    merged_sid: Option<i64>,
    /// Clave elegida ahora (para la memoria): `proveedor:id` o [`CHOICE_ALL`].
    current: Option<String>,
}

/// Corre hasta que mpv se cierra. Nunca falla: lo que no anda se anota en el log y se sigue.
pub async fn run(req: SessionRequest) {
    if req.language == SubtitleLanguage::None {
        return;
    }
    let log = req.log.clone();
    let mpv = req.mpv.clone();
    // Suscribirse ANTES de todo para no perder teclas apretadas mientras se busca.
    let events = mpv.events();
    if let Err(e) = bind_keys(mpv.as_ref()).await {
        log(format!(
            "subtítulos: no se pudieron registrar las teclas en mpv: {e}"
        ));
    }
    let memory = Arc::new(SubtitleMemory::new(req.memory_file.clone()));
    let remembered = memory.get(&req.info_hash).ok().flatten();
    let state = Arc::new(Mutex::new(State::default()));
    let info_hash = req.info_hash;

    let search = tokio::spawn(find_and_load(req, state.clone(), remembered));
    key_loop(events, mpv, state, memory, info_hash, log).await;
    search.abort();
}

async fn bind_keys(mpv: &dyn MpvControl) -> crate::Result<()> {
    mpv.command(&[
        json!("define-section"),
        json!(KEY_SECTION),
        json!(KEY_BINDINGS),
        json!("force"),
    ])
    .await?;
    mpv.command(&[json!("enable-section"), json!(KEY_SECTION)])
        .await
        .map(drop)
}

// ---------- búsqueda, descarga y carga ----------

/// Qué buscar y dónde dejarlo, sin mpv: lo usa la sesión al reproducir y el analizador al
/// analizar (2026-11-14: "buscar y descargar 5 subtítulos en español al analizar").
pub struct Fetch {
    pub video: VideoIdentity,
    /// URL del video en el motor para el hash; `None` si ya viene en `video.movie_hash`.
    pub video_url: Option<String>,
    pub torrent_files: Vec<TorrentSubtitleFile>,
    pub language: SubtitleLanguage,
    pub cache_dir: PathBuf,
    pub remembered: Option<SubtitleChoice>,
    /// Completar con OpenSubtitles (cuota de 20/día): sí al reproducir, no al analizar.
    pub opensubtitles: bool,
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
    // 1. Identidad: hash del video (inicio/fin) e IMDb id, en paralelo.
    let mut video = req.video.clone();
    let (hash, imdb) = tokio::join!(
        tokio::time::timeout(HASH_TIMEOUT, async {
            match &req.video_url {
                Some(url) => video_hash(url, video.file_size).await,
                None => None,
            }
        }),
        providers::resolve_imdb(&video),
    );
    // Sin URL (al analizar) puede venir ya calculado desde el archivo en disco.
    video.movie_hash = hash.ok().flatten().or(video.movie_hash);
    video.imdb_id = imdb;
    log(format!(
        "subtítulos: buscando en {} · {} · hash {} · IMDb {}",
        if lang == SubtitleLanguage::Es {
            "español"
        } else {
            "inglés"
        },
        video.title.as_deref().unwrap_or("(sin título)"),
        video
            .movie_hash
            .map_or("—".to_string(), |h| format!("{h:016x}")),
        video.imdb_id.as_deref().unwrap_or("—"),
    ));

    // 2. Fuentes gratis en paralelo: torrent, Wyzie, Subdivx (Q-01..Q-04).
    let free: Vec<Arc<dyn SubtitleProvider>> = vec![
        Arc::new(TorrentProvider {
            files: req.torrent_files.clone(),
        }),
        Arc::new(WyzieProvider::from_store()),
        Arc::new(SubdivxProvider),
    ];
    let mut all = Vec::new();
    for (provider, result) in search_all(&free, &video, lang).await {
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
    let mut ranked = top_candidates(all, usize::MAX);
    if let Some(choice) = &remembered {
        // FR-28: el elegido la otra vez va primero (si sigue apareciendo).
        if let Some(i) = ranked.iter().position(|c| c.key() == choice.subtitle) {
            let c = ranked.remove(i);
            ranked.insert(0, c);
        }
    }
    let mut loaded = download_best(ranked, MAX_SUBTITLES, &free, &req.cache_dir, &log).await;

    // 3. OpenSubtitles solo si faltan para llegar a 5 (cuota 20/día, Q-01).
    if loaded.len() < MAX_SUBTITLES && req.opensubtitles {
        let os = OpenSubtitlesProvider::from_store();
        if os.has_key() {
            let os: Arc<dyn SubtitleProvider> = Arc::new(os);
            match tokio::time::timeout(SEARCH_TIMEOUT, os.search(&video, lang)).await {
                Ok(Ok(found)) => {
                    log(format!(
                        "subtítulos: OpenSubs → {} candidato(s)",
                        found.len()
                    ));
                    let missing = MAX_SUBTITLES - loaded.len();
                    let found = top_candidates(found, usize::MAX);
                    let more = download_best(
                        found,
                        missing,
                        std::slice::from_ref(&os),
                        &req.cache_dir,
                        &log,
                    )
                    .await;
                    loaded.extend(more);
                    if let Ok(Some(q)) = os.quota().await {
                        log(format!(
                            "subtítulos: cuota OpenSubtitles: quedan {} de {} hoy",
                            q.remaining, q.per_day
                        ));
                    }
                }
                Ok(Err(e)) => log(format!("subtítulos: OpenSubs omitido: {e}")),
                Err(_) => log("subtítulos: OpenSubs omitido: tardó demasiado".into()),
            }
        } else {
            log("subtítulos: OpenSubs omitido: sin API key configurada".into());
        }
    }

    // 4. El recordado, aunque hoy no haya salido entre los 5: desde la caché (FR-28).
    if let Some(choice) = &remembered {
        let present = loaded.iter().any(|(c, _)| c.key() == choice.subtitle);
        if choice.subtitle != CHOICE_ALL && !present {
            if let Some(path) = providers::cached_by_key(&req.cache_dir, &choice.subtitle) {
                let label = choice
                    .label
                    .clone()
                    .unwrap_or_else(|| choice.subtitle.clone());
                loaded.insert(0, (remembered_candidate(&choice.subtitle, &label), path));
                loaded.truncate(MAX_SUBTITLES);
            }
        }
    }
    dedup_by_content(&mut loaded, &log);
    loaded
}

async fn find_and_load(
    req: SessionRequest,
    state: Arc<Mutex<State>>,
    remembered: Option<SubtitleChoice>,
) {
    let log = req.log.clone();
    let mpv = req.mpv.clone();
    let lang = req.language;
    let start_hidden = req.start_hidden;
    let t0 = std::time::Instant::now();

    let loaded = fetch(Fetch {
        video: req.video.clone(),
        video_url: Some(req.video_url.clone()),
        torrent_files: req.torrent_files.clone(),
        language: lang,
        cache_dir: req.cache_dir.clone(),
        remembered: remembered.clone(),
        opensubtitles: true,
        log: log.clone(),
    })
    .await;

    if loaded.is_empty() {
        log("subtítulos: no encontré ninguno".into());
        let _ = mpv
            .show_text(
                &format!(
                    "No encontré subtítulos en {}",
                    if lang == SubtitleLanguage::Es {
                        "español"
                    } else {
                        "inglés"
                    }
                ),
                OSD,
            )
            .await;
        state.lock().expect("state").ready = true;
        return;
    }

    // 5. Cargar en mpv: una pista por subtítulo + la fusionada (modo comparación).
    let mut tracks = Vec::new();
    let mut labeled = Vec::new();
    let lang_code = if lang == SubtitleLanguage::Es {
        "spa"
    } else {
        "eng"
    };
    for (i, (cand, path)) in loaded.iter().enumerate() {
        let label = label_for(i + 1, cand);
        let title = format!("{label} [tstream]");
        let added = mpv
            .command(&[
                json!("sub-add"),
                json!(path.to_string_lossy()),
                json!("auto"),
                json!(title),
                json!(lang_code),
            ])
            .await;
        if let Err(e) = added {
            log(format!(
                "subtítulos: mpv no pudo cargar {}: {e}",
                path.display()
            ));
            continue;
        }
        log(format!(
            "subtítulos: {label} · {:?} · {:?} · {} descargas",
            cand.variant, cand.match_kind, cand.downloads
        ));
        tracks.push(Track {
            key: cand.key(),
            label: label.clone(),
            sid: sid_by_title(mpv.as_ref(), &title).await,
        });
        labeled.push(LabeledSubtitle {
            path: path.clone(),
            label,
        });
    }
    let merged_sid = if labeled.len() >= 2 {
        load_merged(mpv.as_ref(), &labeled, &req.cache_dir, &log).await
    } else {
        None
    };

    // 6. Elección inicial: la recordada (FR-28) o, con 2+, todos a la vez para comparar.
    let remembered_index = remembered.as_ref().and_then(|c| {
        tracks
            .iter()
            .position(|t| t.key == c.subtitle)
            .map(Some)
            .or_else(|| (c.subtitle == CHOICE_ALL && merged_sid.is_some()).then_some(None))
    });
    let delay = remembered.as_ref().map_or(0.0, |c| c.delay_secs);
    if delay != 0.0 {
        let _ = mpv.set_property("sub-delay", json!(delay)).await;
    }
    let n = tracks.len();
    {
        let mut st = state.lock().expect("state");
        st.tracks = tracks;
        st.merged_sid = merged_sid;
        st.ready = true;
    }
    let initial = match remembered_index {
        Some(Some(i)) => Some(i),
        Some(None) => None,
        None if merged_sid.is_some() => None,
        None => Some(0),
    };
    let mut headline = select(mpv.as_ref(), &state, initial).await;
    if start_hidden {
        let _ = mpv.set_property("sub-visibility", json!(false)).await;
        headline = "ocultos porque el audio ya está en español · S para verlos".into();
    }
    let mut text = format!(
        "{n} subtítulo(s) cargado(s) en {:.0} s · {headline}",
        t0.elapsed().as_secs_f32()
    );
    if remembered_index.is_some() {
        text.push_str(&format!(
            "\n(recordado de la otra vez · {})",
            sync_message(delay)
        ));
    }
    text.push_str(&format!(
        "\n1–{n} elegir · 0 ver todos · S ocultar/mostrar\n{SYNC_HELP}"
    ));
    log(format!(
        "subtítulos: listos en {:.1} s",
        t0.elapsed().as_secs_f32()
    ));
    let _ = mpv.show_text(&text, Duration::from_secs(7)).await;
}

async fn search_all(
    providers: &[Arc<dyn SubtitleProvider>],
    video: &VideoIdentity,
    lang: SubtitleLanguage,
) -> Vec<(&'static str, crate::Result<Vec<SubtitleCandidate>>)> {
    let mut set = tokio::task::JoinSet::new();
    for (i, p) in providers.iter().enumerate() {
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
    while let Some(Ok(r)) = set.join_next().await {
        out.push(r);
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
        while let Some(Ok(r)) = set.join_next().await {
            results.push(r);
        }
        results.sort_by_key(|(i, _, _)| *i);
        for (_, cand, r) in results {
            match r {
                Ok(Ok(path)) => out.push((cand, path)),
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

fn remembered_candidate(key: &str, label: &str) -> SubtitleCandidate {
    let (provider, id) = key.split_once(':').unwrap_or(("?", key));
    let provider = [
        super::TORRENT_PROVIDER,
        providers::WYZIE,
        providers::SUBDIVX,
        providers::OPENSUBTITLES,
    ]
    .into_iter()
    .find(|p| *p == provider)
    .unwrap_or("?");
    // La etiqueta guardada ya trae "N · fuente/release": se usa el release.
    let release = label.split_once('/').map_or(label, |(_, r)| r).to_string();
    SubtitleCandidate {
        provider,
        provider_id: id.to_string(),
        release_name: release,
        language: SubtitleLanguage::Es,
        match_kind: super::MatchKind::None,
        downloads: 0,
        variant: super::SpanishVariant::Unknown,
        url: String::new(),
    }
}

/// "1 · torrent/Sintel.es", "2 · Wyzie/Sintel.2010.1080p.WEB…".
fn label_for(n: usize, cand: &SubtitleCandidate) -> String {
    let release = cand
        .release_name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(&cand.release_name);
    let release = release
        .rsplit_once('.')
        .filter(|(_, ext)| super::SUBTITLE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .map_or(release, |(stem, _)| stem);
    let short: String = release.chars().take(24).collect();
    let ellipsis = if release.chars().count() > 24 {
        "…"
    } else {
        ""
    };
    format!(
        "{n} · {}/{short}{ellipsis}",
        providers::display_name(cand.provider)
    )
}

async fn load_merged(
    mpv: &dyn MpvControl,
    subs: &[LabeledSubtitle],
    cache_dir: &std::path::Path,
    log: &LogFn,
) -> Option<i64> {
    let ass = match merge_ass(subs) {
        Ok(a) => a,
        Err(e) => {
            log(format!("subtítulos: no se pudieron fusionar: {e}"));
            return None;
        }
    };
    let path = cache_dir.join(format!("comparar-{}.ass", subs.len()));
    if let Err(e) = std::fs::write(&path, ass) {
        log(format!(
            "subtítulos: no se pudo escribir {}: {e}",
            path.display()
        ));
        return None;
    }
    let title = format!("Comparar: los {} a la vez [tstream]", subs.len());
    mpv.command(&[
        json!("sub-add"),
        json!(path.to_string_lossy()),
        json!("auto"),
        json!(title),
    ])
    .await
    .ok()?;
    sid_by_title(mpv, &title).await
}

async fn sid_by_title(mpv: &dyn MpvControl, title: &str) -> Option<i64> {
    let list = mpv.get_property("track-list").await.ok()?;
    list.as_array()?
        .iter()
        .rev()
        .find(|t| t["type"] == "sub" && t["title"].as_str() == Some(title))
        .and_then(|t| t["id"].as_i64())
}

// ---------- teclas ----------

/// Selecciona uno (`Some(i)`) o todos (`None`) y devuelve el texto para la pantalla.
async fn select(mpv: &dyn MpvControl, state: &Mutex<State>, which: Option<usize>) -> String {
    let (sid, key, text) = {
        let st = state.lock().expect("state");
        match which {
            Some(i) => match st.tracks.get(i) {
                Some(t) => (t.sid, t.key.clone(), format!("Subtítulo {}", t.label)),
                None => {
                    return format!("No hay subtítulo {} (hay {})", i + 1, st.tracks.len());
                }
            },
            None => match st.merged_sid {
                Some(sid) => (
                    Some(sid),
                    CHOICE_ALL.to_string(),
                    format!(
                        "Comparando los {} a la vez · apretá 1–{} para quedarte con uno",
                        st.tracks.len(),
                        st.tracks.len()
                    ),
                ),
                None => return "Hay un solo subtítulo: no hay nada que comparar".into(),
            },
        }
    };
    if let Some(sid) = sid {
        let _ = mpv.set_property("sid", json!(sid)).await;
        let _ = mpv.set_property("sub-visibility", json!(true)).await;
    }
    state.lock().expect("state").current = Some(key);
    text
}

async fn key_loop(
    mut events: tokio::sync::broadcast::Receiver<MpvEvent>,
    mpv: Arc<dyn MpvControl>,
    state: Arc<Mutex<State>>,
    memory: Arc<SubtitleMemory>,
    info_hash: InfoHash,
    log: LogFn,
) {
    loop {
        let action = match events.recv().await {
            Ok(MpvEvent::KeyAction(a)) => a,
            Ok(MpvEvent::Shutdown) | Err(RecvError::Closed) => return,
            _ => continue,
        };
        let ready = state.lock().expect("state").ready;
        let text = match action.as_str() {
            a if a.starts_with("sub-") && !ready => "Buscando subtítulos… (un momento)".to_string(),
            "sub-all" => {
                let t = select(mpv.as_ref(), &state, None).await;
                remember(&mpv, &state, &memory, &info_hash).await;
                t
            }
            "sub-toggle" => {
                let visible = mpv
                    .get_property("sub-visibility")
                    .await
                    .ok()
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                let _ = mpv.set_property("sub-visibility", json!(!visible)).await;
                if visible {
                    "Subtítulos ocultos (S para mostrarlos)".into()
                } else {
                    "Subtítulos visibles".into()
                }
            }
            a if a.starts_with("sub-") => {
                let n: usize = a.trim_start_matches("sub-").parse().unwrap_or(0);
                let t = select(mpv.as_ref(), &state, n.checked_sub(1)).await;
                remember(&mpv, &state, &memory, &info_hash).await;
                t
            }
            a if a.starts_with("sync-") => {
                let key = match a {
                    "sync-earlier" => SyncKey::VoiceEarlier { big: false },
                    "sync-earlier-big" => SyncKey::VoiceEarlier { big: true },
                    "sync-later" => SyncKey::VoiceLater { big: false },
                    "sync-later-big" => SyncKey::VoiceLater { big: true },
                    _ => SyncKey::Reset,
                };
                let current = current_delay(mpv.as_ref()).await;
                let next = apply_sync_key(current, key);
                let _ = mpv.set_property("sub-delay", json!(next)).await;
                remember(&mpv, &state, &memory, &info_hash).await;
                format!("{}\n{SYNC_HELP}", sync_message(next))
            }
            other => {
                tracing::debug!("tecla de la app sin uso en subtítulos: {other}");
                continue;
            }
        };
        log(format!(
            "subtítulos: tecla {action} → {}",
            text.lines().next().unwrap_or("")
        ));
        let _ = mpv.show_text(&text, OSD).await;
    }
}

async fn current_delay(mpv: &dyn MpvControl) -> f64 {
    mpv.get_property("sub-delay")
        .await
        .ok()
        .and_then(|v: Value| v.as_f64())
        .unwrap_or(0.0)
}

/// Guarda elección + desfase para la próxima vez (FR-28). Best effort.
async fn remember(
    mpv: &Arc<dyn MpvControl>,
    state: &Mutex<State>,
    memory: &SubtitleMemory,
    info_hash: &InfoHash,
) {
    let (key, label) = {
        let st = state.lock().expect("state");
        let Some(key) = st.current.clone() else {
            return;
        };
        let label = st
            .tracks
            .iter()
            .find(|t| t.key == key)
            .map(|t| t.label.clone());
        (key, label)
    };
    let delay = current_delay(mpv.as_ref()).await;
    let choice = SubtitleChoice {
        subtitle: key,
        delay_secs: delay,
        label,
    };
    if let Err(e) = memory.set(info_hash, choice) {
        tracing::warn!("no se pudo guardar subtitles-memory.json: {e}");
    }
}

/// Hash OpenSubtitles leyendo 64 KiB del principio y del final por el motor (el principio ya
/// está precargado; el final lo pide el stream).
async fn video_hash(url: &str, size: u64) -> Option<u64> {
    if url.is_empty() || size == 0 {
        return None;
    }
    let chunk = 65_536u64.min(size);
    let head = providers::fetch_range(url, 0, chunk).await.ok()?;
    let tail = providers::fetch_range(url, size - chunk, chunk)
        .await
        .ok()?;
    Some(super::movie_hash(size, &head, &tail))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::subtitles::{MatchKind, SpanishVariant};

    #[test]
    fn etiquetas_cortas() {
        let c = SubtitleCandidate {
            provider: crate::subtitles::TORRENT_PROVIDER,
            provider_id: "Sintel/Sintel.es.srt".into(),
            release_name: "Sintel.es.srt".into(),
            language: SubtitleLanguage::Es,
            match_kind: MatchKind::Hash,
            downloads: 0,
            variant: SpanishVariant::Unknown,
            url: String::new(),
        };
        assert_eq!(label_for(1, &c), "1 · torrent/Sintel.es");
        let mut w = c.clone();
        w.provider = providers::WYZIE;
        w.release_name = "Sintel.2010.1080p.WEB-DL.x264-GRUPO".into();
        assert_eq!(label_for(2, &w), "2 · Wyzie/Sintel.2010.1080p.WEB-DL…");
    }

    #[test]
    fn candidato_recordado_desde_la_memoria() {
        let c = remembered_candidate("opensubtitles:7001", "3 · OpenSubs/Sintel.2010.Web");
        assert_eq!(c.provider, providers::OPENSUBTITLES);
        assert_eq!(c.provider_id, "7001");
        assert_eq!(c.key(), "opensubtitles:7001");
        assert_eq!(label_for(1, &c), "1 · OpenSubs/Sintel.2010.Web");
    }

    #[test]
    fn teclas_registradas() {
        for k in [
            "1 ", "5 ", "0 ", "s ", "S ", "z ", "Z ", "x ", "X ", "r ", "R ",
        ] {
            assert!(
                KEY_BINDINGS.lines().any(|l| l.starts_with(k)),
                "falta la tecla {k}"
            );
        }
        assert!(KEY_BINDINGS
            .lines()
            .all(|l| l.contains("script-message tstream ")));
    }
}
