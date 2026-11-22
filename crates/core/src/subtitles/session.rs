//! Subtítulos mientras mpv está abierto (spec 04, flujo 3; FR-22, 24–26, 28).
//!
//! 1. Registra las teclas de la app en mpv con `define-section` + `enable-section` (IPC):
//!    son una capa encima de la config del usuario, que no se toca (FR-34). Se eligió esto y no
//!    `--input-conf` porque `--input-conf` REEMPLAZA el `input.conf` personal del usuario.
//! 2. La búsqueda y descarga de hasta 5 ([`super::fetch`]) ya viene lanzada desde antes de abrir
//!    mpv ([`prefetch`], en paralelo con la precarga): acá solo se espera su resultado.
//! 3. Carga en mpv cada uno como pista propia + el ASS fusionado "comparar" (FR-25, ADR-11).
//! 4. Teclas: 1–5 elige uno · 0 todos · S on/off · Z/X ±0,1 s · Shift+Z/X ±1 s · R reset.
//!    Cada elección y cada ajuste se recuerdan por info hash (FR-28).

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::broadcast::error::RecvError;
use tokio::task::JoinHandle;

use super::providers;
use super::{
    apply_sync_key, merge_ass, sync_message, LabeledSubtitle, SubtitleCandidate, SubtitleChoice,
    SubtitleMemory, SyncKey, CHOICE_ALL,
};
use crate::config::SubtitleLanguage;
use crate::player::{MpvControl, MpvEvent};
use crate::video_key::VideoKey;

// La búsqueda vive en `fetch`; se re-exporta acá porque el analizador la llama por este camino.
pub use super::fetch::{add_saved, fetch, merge_saved, save_copy, Fetch, LogFn};

/// Teclas de la app (FR-25, FR-26). `Z`/`X` en mayúscula = Shift.
const KEY_SECTION: &str = "streamonte-subtitulos";
const KEY_BINDINGS: &str = "\
1 script-message streamonte sub-1
2 script-message streamonte sub-2
3 script-message streamonte sub-3
4 script-message streamonte sub-4
5 script-message streamonte sub-5
0 script-message streamonte sub-all
s script-message streamonte sub-toggle
S script-message streamonte sub-toggle
z script-message streamonte sync-earlier
Z script-message streamonte sync-earlier-big
x script-message streamonte sync-later
X script-message streamonte sync-later-big
r script-message streamonte sync-reset
R script-message streamonte sync-reset
";

const OSD: Duration = Duration::from_secs(4);
const SYNC_HELP: &str = "Z: la voz llega antes · X: la voz llega después · Shift = 1 s · R: reset";

/// Búsqueda y descarga lanzadas antes de abrir mpv ([`prefetch`]). Se aborta al soltarse: si la
/// reproducción termina antes de abrir mpv, no sigue buscando ni escribiendo en la carpeta.
pub struct Prefetch {
    task: AbortOnDrop<Vec<(SubtitleCandidate, PathBuf)>>,
    /// Subtítulos de ESTE video, en la carpeta de su descarga
    /// ([`crate::paths::AppPaths::video_subtitles_dir`]); ahí va también el ASS "comparar".
    cache_dir: PathBuf,
}

/// Tarea que se aborta al soltarse: si quien la lanzó se corta (el flujo hace `abort()` de la
/// sesión), no queda buscando ni escribiendo en una carpeta borrada o un mpv cerrado.
struct AbortOnDrop<T>(JoinHandle<T>);

impl<T> Drop for AbortOnDrop<T> {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Arranca la búsqueda y descarga ya (sin mpv), con la elección recordada de `key` (FR-28).
pub fn prefetch(mut req: Fetch, key: &VideoKey, memory_file: &Path) -> Prefetch {
    let memory = SubtitleMemory::new(memory_file.to_path_buf());
    req.remembered = remembered_choice(&memory, key, req.language);
    let cache_dir = req.cache_dir.clone();
    Prefetch {
        task: AbortOnDrop(tokio::spawn(fetch(req))),
        cache_dir,
    }
}

/// FR-28: lo elegido para este video (en el dropdown del catálogo o con las teclas). Una elección
/// de otro idioma no aplica a esta sesión.
fn remembered_choice(
    memory: &SubtitleMemory,
    key: &VideoKey,
    language: SubtitleLanguage,
) -> Option<SubtitleChoice> {
    memory
        .get(key)
        .ok()
        .flatten()
        .filter(|c| c.language == language && !c.subtitle.is_empty())
}

pub struct SessionRequest {
    pub mpv: Arc<dyn MpvControl>,
    /// El video que se ve: la elección recordada (FR-28) es de ESTE episodio, no del pack.
    pub key: VideoKey,
    /// La búsqueda ya lanzada para este mismo video ([`prefetch`]).
    pub found: Prefetch,
    pub language: SubtitleLanguage,
    /// Audio ya en español (eligió Latino): se cargan igual pero arrancan ocultos (S los muestra).
    pub start_hidden: bool,
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
    /// El usuario ya tocó Z/X/R: el desfase recordado no debe pisar su ajuste.
    delay_adjusted: bool,
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
    let language = req.language;
    let remembered = remembered_choice(&memory, &req.key, language);
    let state = Arc::new(Mutex::new(State::default()));
    let key = req.key;

    let _search = AbortOnDrop(tokio::spawn(find_and_load(req, state.clone(), remembered)));
    key_loop(events, mpv, state, memory, key, language, log).await;
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

// ---------- carga en mpv ----------

async fn find_and_load(
    mut req: SessionRequest,
    state: Arc<Mutex<State>>,
    remembered: Option<SubtitleChoice>,
) {
    let log = req.log.clone();
    let mpv = req.mpv.clone();
    let lang = req.language;
    let start_hidden = req.start_hidden;
    let t0 = std::time::Instant::now();

    // Suele estar listo: arrancó junto con la precarga. Si la tarea murió, como sin resultados.
    let loaded = (&mut req.found.task.0).await.unwrap_or_default();

    // Elegido en el dropdown un subtítulo que viene dentro del video: es una pista de mpv.
    let embedded = remembered.as_ref().and_then(|c| {
        let sid = c
            .subtitle
            .strip_prefix(super::EMBEDDED)?
            .strip_prefix(':')?;
        Some((sid.parse::<i64>().ok()?, c.subtitle.clone()))
    });
    if let Some((sid, key)) = &embedded {
        let _ = mpv.set_property("sid", json!(sid)).await;
        let _ = mpv.set_property("sub-visibility", json!(true)).await;
        state.lock().expect("state").current = Some(key.clone());
    }

    if loaded.is_empty() {
        log("subtítulos: no encontré ninguno".into());
        let _ = mpv
            .show_text(
                &format!("No encontré subtítulos en {}", lang.name_es()),
                OSD,
            )
            .await;
        state.lock().expect("state").ready = true;
        return;
    }

    // 5. Cargar en mpv: una pista por subtítulo + la fusionada (modo comparación).
    let mut tracks = Vec::new();
    let mut labeled = Vec::new();
    for (i, (cand, path)) in loaded.iter().enumerate() {
        let label = label_for(i + 1, cand);
        let title = format!("{label} [Streamonte]");
        let added = mpv
            .command(&[
                json!("sub-add"),
                json!(path.to_string_lossy()),
                json!("auto"),
                json!(title),
                json!(cand.language.iso2().unwrap_or_default()),
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
        load_merged(mpv.as_ref(), &labeled, &req.found.cache_dir, &log).await
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
    let adjusted = state.lock().expect("state").delay_adjusted;
    let delay = if adjusted {
        current_delay(mpv.as_ref()).await
    } else {
        remembered.as_ref().map_or(0.0, |c| c.delay_secs)
    };
    if delay != 0.0 && !adjusted {
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
    let mut headline = match &embedded {
        Some((sid, _)) => format!("Subtítulo del video (pista {sid})"),
        None => select(mpv.as_ref(), &state, initial).await,
    };
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
    if let Err(e) = providers::cache::write_atomic(&path, ass.as_bytes()) {
        log(format!(
            "subtítulos: no se pudo escribir {}: {e}",
            path.display()
        ));
        return None;
    }
    let title = format!("Comparar: los {} a la vez [Streamonte]", subs.len());
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
    video: VideoKey,
    language: SubtitleLanguage,
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
                remember(&mpv, &state, &memory, &video, language).await;
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
                remember(&mpv, &state, &memory, &video, language).await;
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
                state.lock().expect("state").delay_adjusted = true;
                let current = current_delay(mpv.as_ref()).await;
                let next = apply_sync_key(current, key);
                let _ = mpv.set_property("sub-delay", json!(next)).await;
                remember(&mpv, &state, &memory, &video, language).await;
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
    video_key: &VideoKey,
    language: SubtitleLanguage,
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
    // El anterior cuenta como probado (el dropdown lo muestra tachado).
    let saved = memory.choose(video_key, &key, language).and_then(|mut c| {
        c.delay_secs = delay;
        c.label = label;
        memory.set(video_key, c)
    });
    if let Err(e) = saved {
        tracing::warn!("no se pudo guardar subtitles-memory.json: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::subtitles::fetch::remembered_candidate;
    use crate::subtitles::{MatchKind, SpanishVariant};

    #[test]
    fn etiquetas_cortas() {
        let c = SubtitleCandidate {
            provider: crate::subtitles::providers::TORRENT_PROVIDER,
            provider_id: "Sintel/Sintel.es.srt".into(),
            release_name: "Sintel.es.srt".into(),
            language: SubtitleLanguage::Es,
            match_kind: MatchKind::Exact,
            downloads: 0,
            variant: SpanishVariant::Unknown,
            url: String::new(),
            fps: None,
            last_secs: None,
        };
        assert_eq!(label_for(1, &c), "1 · torrent/Sintel.es");
        let mut w = c.clone();
        w.provider = providers::WYZIE;
        w.release_name = "Sintel.2010.1080p.WEB-DL.x264-GRUPO".into();
        assert_eq!(label_for(2, &w), "2 · Wyzie/Sintel.2010.1080p.WEB-DL…");
    }

    #[test]
    fn candidato_recordado_desde_la_memoria() {
        let c = remembered_candidate(
            "opensubtitles:7001",
            "3 · OpenSubs/Sintel.2010.Web",
            SubtitleLanguage::En,
        );
        assert_eq!(c.language, SubtitleLanguage::En);
        assert_eq!(c.provider, providers::OPENSUBTITLES);
        assert_eq!(c.provider_id, "7001");
        assert_eq!(c.key(), "opensubtitles:7001");
        assert_eq!(label_for(1, &c), "1 · OpenSubtitles.com/Sintel.2010.Web");
    }
}
