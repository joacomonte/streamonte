//! `player` — lanzar mpv/VLC, control de mpv por JSON IPC, salida del proceso, perfil de la app
//! (FR-09, FR-34, FR-35, ADR-05).
//!
//! - Lanzamiento DIRECTO (sin shell) como hijo de la app → detectamos su salida (lección 6).
//! - mpv: `--input-ipc-server` = named pipe `\\.\pipe\streamonte-<id>` (Windows) / socket unix en temp (macOS).
//! - Perfil propio (`--config-dir`, FR-34) todavía no: por ahora se respeta la config personal del usuario.
//! - VLC: sin IPC; solo lanzamiento y salida (subtítulos/sync son solo mpv).

use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{json, Value};
use tokio::sync::broadcast;

use crate::config::{PlayerConfig, PlayerKind};
use crate::paths::{find_executable, AppPaths, Executable};
use crate::{CoreError, Result};

const IPC_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Cuánto se espera a que mpv cierre solo con `quit` antes de matarlo.
const QUIT_TIMEOUT: Duration = Duration::from_secs(2);
static NEXT_IPC: AtomicU64 = AtomicU64::new(1);

/// Script de mpv con las teclas del ecualizador en vivo.
const EQ_SCRIPT: &str = include_str!("player_eq.lua");
/// En cuántas reproducciones (las primeras) mpv avisa las teclas del ecualizador.
const EQ_TIP_PLAYS: u32 = 3;

/// Opciones (`streamonte-eq-<clave>`) que el script lee con `mp.get_opt`: bandas de cada preset
/// (`freq/Q/dB;…`, a 100 %), headroom y el estado inicial (el de Ajustes). El script no sabe nada
/// de presets: todo sale de [`crate::config::Equalizer::bands`].
fn eq_script_opts(cfg: &PlayerConfig) -> Vec<(&'static str, String)> {
    use crate::config::{eq_num, Equalizer, EQ_HEADROOM_DB, EQ_MAX_INTENSITY};
    let bands = |eq: Equalizer| {
        eq.bands()
            .iter()
            .map(|b| {
                format!(
                    "{}/{}/{}",
                    eq_num(b.freq_hz),
                    eq_num(b.width_q),
                    eq_num(b.gain_db)
                )
            })
            .collect::<Vec<_>>()
            .join(";")
    };
    let start = match cfg.equalizer {
        Equalizer::Cine => "cine",
        Equalizer::Voices => "voices",
        Equalizer::Flat => "flat",
    };
    vec![
        ("cine", bands(Equalizer::Cine)),
        ("voices", bands(Equalizer::Voices)),
        ("headroom", eq_num(EQ_HEADROOM_DB)),
        ("start", start.to_string()),
        (
            "intensity",
            cfg.equalizer_intensity.min(EQ_MAX_INTENSITY).to_string(),
        ),
    ]
}

/// El reproductor que se usa: el que el usuario eligió en ESTE ▶ (se pregunta en cada uno,
/// 2026-11-20). Sin elección (hay uno solo, o de fondo sin reproductor): mpv; y si es mpv y no hay
/// ninguno (ni el incluido ni uno instalado, p. ej. macOS < 15 sin mpv), VLC si está instalado.
pub fn resolve_player(wanted: Option<PlayerKind>, cfg: &PlayerConfig) -> PlayerKind {
    let wanted = wanted.unwrap_or(PlayerKind::Mpv);
    let no_mpv = || find_executable(Executable::Mpv, cfg.mpv_path.as_deref()).is_none();
    let has_vlc = || find_executable(Executable::Vlc, cfg.vlc_path.as_deref()).is_some();
    if wanted == PlayerKind::Mpv && no_mpv() && has_vlc() {
        PlayerKind::Vlc
    } else {
        wanted
    }
}

/// Qué reproductores hay en este equipo (Ajustes → Reproductor).
#[derive(Debug, Clone, serde::Serialize)]
pub struct PlayersStatus {
    /// De dónde sale el mpv que se usaría; `None` = no hay.
    pub mpv: Option<crate::paths::Source>,
    pub vlc: bool,
    /// macOS con Homebrew: "Instalar mpv" lo instala solo; si no, abre la guía.
    pub can_install_mpv: bool,
}

pub fn players_status(cfg: &PlayerConfig) -> PlayersStatus {
    PlayersStatus {
        mpv: crate::paths::locate(Executable::Mpv, cfg.mpv_path.as_deref()).map(|(_, s)| s),
        vlc: find_executable(Executable::Vlc, cfg.vlc_path.as_deref()).is_some(),
        can_install_mpv: homebrew().is_some(),
    }
}

/// Homebrew (solo macOS): el de Apple Silicon primero (el de `/usr/local` puede ser de Intel).
fn homebrew() -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]
        .into_iter()
        .map(PathBuf::from)
        .find(|p| p.is_file())
}

/// "Instalar mpv" (Ajustes): con Homebrew lo instala (`brew install mpv`, unos minutos); si no,
/// abre la guía de instalación. `true` = quedó instalado.
pub async fn install_mpv() -> crate::Result<bool> {
    let Some(brew) = homebrew() else {
        crate::external::open_external("https://mpv.io/installation/").map_err(|source| {
            crate::CoreError::Io {
                path: "https://mpv.io/installation/".into(),
                source,
            }
        })?;
        return Ok(false);
    };
    let out = tokio::process::Command::new(&brew)
        .args(["install", "mpv"])
        .env("HOMEBREW_NO_AUTO_UPDATE", "1")
        .output()
        .await
        .map_err(|source| crate::CoreError::Io {
            path: brew.clone(),
            source,
        })?;
    if !out.status.success() {
        tracing::warn!(
            "brew install mpv falló: {}",
            String::from_utf8_lossy(&out.stderr)
                .lines()
                .last()
                .unwrap_or("")
        );
    }
    Ok(out.status.success())
}

/// En Windows, `mpv.com` (el que suele quedar en PATH) es un envoltorio de consola que abre una
/// ventana negra extra; si al lado está `mpv.exe`, usamos ese.
fn prefer_gui_binary(path: PathBuf) -> PathBuf {
    let is_com = path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("com"));
    let exe = path.with_extension("exe");
    if is_com && exe.is_file() {
        exe
    } else {
        path
    }
}

/// Ruta de un IPC de mpv nuevo y único en el proceso: `<prefix>-<pid>-<n>`.
fn new_ipc_path(prefix: &str) -> String {
    let name = format!(
        "{prefix}-{}-{}",
        std::process::id(),
        NEXT_IPC.fetch_add(1, Ordering::Relaxed)
    );
    crate::mpv_ipc::ipc_path(&name)
}

/// Lanza el reproductor directo, sin shell y sin stdio (lecciones 6 y 8): sabemos cuándo se
/// cierra y el URL no se corta. `background` (medición): muere si se suelta el `Child` y, en
/// Windows, sin ventana de consola (mpv.com) ni parpadeos.
fn spawn_player(exe: &Path, args: &[String], background: bool) -> Result<tokio::process::Child> {
    let mut cmd = tokio::process::Command::new(exe);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(background);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        if background {
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
    }
    cmd.spawn()
        .map_err(|e| CoreError::Player(format!("{}: {e}", exe.display())))
}

/// Muerto de golpe, mpv no borra su socket unix (en Windows el named pipe se va solo).
fn remove_ipc_socket(ipc_path: &str) {
    if cfg!(not(windows)) {
        let _ = std::fs::remove_file(ipc_path);
    }
}

#[derive(Debug, Clone)]
pub struct LaunchRequest {
    pub kind: PlayerKind,
    /// URL del motor (127.0.0.1).
    pub url: String,
    /// Título de la ventana (nombre del archivo).
    pub title: String,
    /// Subtítulos a cargar al abrir (FR-22).
    pub subtitle_files: Vec<PathBuf>,
    /// Log de mpv a archivo (solo con diagnóstico activo, Q-06).
    pub log_file: Option<PathBuf>,
    /// Argumentos extra para el reproductor (p. ej. `--mute=yes` en el benchmark).
    pub extra_args: Vec<String>,
}

/// Eventos de mpv relevantes para la app.
#[derive(Debug, Clone)]
pub enum MpvEvent {
    FileLoaded,
    /// Primera imagen de VIDEO en pantalla → métrica "tiempo a primera imagen" (O1, 06-D). Solo
    /// si hay video: con solo audio nunca llega.
    FirstFrame,
    /// La reproducción (re)arrancó: tras abrir y tras cada salto.
    PlaybackRestart,
    PropertyChanged {
        name: String,
        value: Value,
    },
    /// Tecla vinculada por la app (`script-message streamonte <acción>`): 1–5, 0, S, Z, X, R, A (FR-25–27).
    KeyAction(String),
    Shutdown,
}

/// Canal JSON IPC con una instancia de mpv.
#[async_trait]
pub trait MpvControl: Send + Sync {
    async fn command(&self, args: &[Value]) -> Result<Value>;
    async fn get_property(&self, name: &str) -> Result<Value>;
    async fn set_property(&self, name: &str, value: Value) -> Result<()>;
    async fn show_text(&self, text: &str, duration: Duration) -> Result<()>;
    fn events(&self) -> broadcast::Receiver<MpvEvent>;
}

/// Vivo menos que esto sin mostrar video = no pudo abrirlo (2026-11-20: VLC con un mp3 se cerró a
/// los 30 ms y la app lo tomó como "lo cerró el usuario").
const EARLY_EXIT: Duration = Duration::from_secs(2);

/// Cómo terminó el reproductor. Una sola regla para mpv y VLC: si salió sin haber mostrado video,
/// enseguida ([`EARLY_EXIT`]) o con código ≠ 0, no pudo abrir el video; si no, lo cerró el usuario.
#[derive(Debug, Clone, Copy)]
pub struct PlayerExit {
    /// `None` = terminó por una señal.
    pub code: Option<i32>,
    pub after: Duration,
    pub failed_to_open: bool,
}

impl PlayerExit {
    /// `showed_video`: mpv avisó la primera imagen ([`MpvEvent::FirstFrame`]); VLC no avisa nada.
    pub fn new(success: bool, code: Option<i32>, after: Duration, showed_video: bool) -> Self {
        Self {
            code,
            after,
            failed_to_open: !showed_video && (after < EARLY_EXIT || !success),
        }
    }
}

impl std::fmt::Display for PlayerExit {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.code {
            Some(c) => write!(f, "código {c}")?,
            None => write!(f, "sin código (señal)")?,
        }
        write!(f, ", a los {:.1} s", self.after.as_secs_f32())
    }
}

/// Un reproductor abierto. Soltarlo NO lo mata; `playback` decide (FR-17).
pub struct PlayerSession {
    pub kind: PlayerKind,
    pub pid: u32,
    launched: std::time::Instant,
    /// Solo mpv.
    pub mpv: Option<std::sync::Arc<dyn MpvControl>>,
    child: tokio::process::Child,
    /// IPC de mpv: en macOS/Linux su socket queda en la carpeta temporal si mpv muere de golpe.
    ipc_path: Option<String>,
}

impl PlayerSession {
    /// Espera a que el reproductor se cierre (FR-12) y dice cómo ([`PlayerExit`]).
    /// `showed_video` se consulta al salir: si mpv llegó a mostrar imagen.
    pub async fn wait_exit(&mut self, showed_video: impl FnOnce() -> bool) -> Result<PlayerExit> {
        let status = self
            .child
            .wait()
            .await
            .map_err(|e| crate::CoreError::Player(e.to_string()));
        self.remove_socket_file();
        let status: ExitStatus = status?;
        Ok(PlayerExit::new(
            status.success(),
            status.code(),
            self.launched.elapsed(),
            showed_video(),
        ))
    }

    /// Pide `quit` por IPC (mpv cierra limpio); si no cierra en [`QUIT_TIMEOUT`], lo mata.
    pub async fn kill(&mut self) -> Result<()> {
        let mut exited = false;
        if let Some(mpv) = &self.mpv {
            let _ = tokio::time::timeout(QUIT_TIMEOUT, mpv.command(&[json!("quit")])).await;
            exited = tokio::time::timeout(QUIT_TIMEOUT, self.child.wait())
                .await
                .is_ok();
        }
        let result = if exited {
            Ok(())
        } else {
            self.child
                .kill()
                .await
                .map_err(|e| crate::CoreError::Player(e.to_string()))
        };
        self.remove_socket_file();
        result
    }

    fn remove_socket_file(&self) {
        if let Some(path) = &self.ipc_path {
            remove_ipc_socket(path);
        }
    }
}

pub struct PlayerLauncher {
    paths: AppPaths,
    config: PlayerConfig,
}

impl PlayerLauncher {
    pub fn new(paths: AppPaths, config: PlayerConfig) -> Self {
        Self { paths, config }
    }

    pub async fn launch(&self, req: LaunchRequest) -> Result<PlayerSession> {
        let (exe, args, ipc) = match req.kind {
            PlayerKind::Mpv => {
                let exe = prefer_gui_binary(
                    find_executable(Executable::Mpv, self.config.mpv_path.as_deref())
                        .ok_or(CoreError::ExecutableNotFound { name: "mpv" })?,
                );
                let ipc = new_ipc_path("streamonte-mpv");
                (exe, self.mpv_args(&req, &ipc), Some(ipc))
            }
            PlayerKind::Vlc => {
                let exe = find_executable(Executable::Vlc, self.config.vlc_path.as_deref())
                    .ok_or(CoreError::ExecutableNotFound { name: "VLC" })?;
                let mut args = vec![
                    "--network-caching=15000".into(),
                    "--play-and-exit".into(),
                    format!("--meta-title={}", req.title),
                ];
                args.extend(req.extra_args.iter().cloned());
                args.push(req.url.clone());
                (exe, args, None)
            }
        };

        tracing::info!(?exe, player = ?req.kind, "lanzando reproductor");
        let launched = std::time::Instant::now();
        let child = spawn_player(&exe, &args, false)?;
        let pid = child.id().unwrap_or_default();

        let mpv: Option<Arc<dyn MpvControl>> = match &ipc {
            Some(path) => match crate::mpv_ipc::MpvIpc::connect(path, IPC_CONNECT_TIMEOUT).await {
                Ok(ipc) => Some(ipc),
                Err(e) => {
                    // Sin IPC igual se puede ver; se pierden subtítulos/sync/métrica de primera imagen.
                    tracing::warn!("mpv sin IPC: {e}");
                    None
                }
            },
            None => None,
        };
        Ok(PlayerSession {
            kind: req.kind,
            pid,
            launched,
            mpv,
            child,
            ipc_path: ipc,
        })
    }

    /// Deja el script Lua del ecualizador (embebido en el binario) en la carpeta de datos. Se
    /// reescribe solo si cambió: dos mpv arrancando a la vez no lo pisan a mitad de lectura.
    fn write_eq_script(&self) -> std::io::Result<PathBuf> {
        let dir = self.paths.data_dir.join("mpv-scripts");
        std::fs::create_dir_all(&dir)?;
        let path = dir.join("streamonte-eq.lua");
        if std::fs::read_to_string(&path).ok().as_deref() != Some(EQ_SCRIPT) {
            std::fs::write(&path, EQ_SCRIPT)?;
        }
        Ok(path)
    }

    /// ¿Esta reproducción avisa las teclas del ecualizador? Sí en las primeras [`EQ_TIP_PLAYS`]:
    /// cuenta en `mpv-scripts/eq-tips` (si no se puede escribir, no avisa).
    fn eq_tip_due(&self) -> bool {
        let path = self.paths.data_dir.join("mpv-scripts").join("eq-tips");
        let shown: u32 = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0);
        shown < EQ_TIP_PLAYS && std::fs::write(&path, (shown + 1).to_string()).is_ok()
    }

    /// Argumentos de mpv para streaming (FR-34 completo — perfil propio, HDR, teclas — llega en F5).
    /// Por ahora respeta la config personal del usuario y agrega solo lo necesario para streaming.
    pub fn mpv_args(&self, req: &LaunchRequest, ipc_path: &str) -> Vec<String> {
        let mut args = vec![
            format!("--input-ipc-server={ipc_path}"),
            format!("--force-media-title={}", req.title),
            // Caché generosa: el torrent entrega a ráfagas.
            "--cache=yes".into(),
            "--demuxer-max-bytes=1GiB".into(),
            "--demuxer-readahead-secs=120".into(),
            // Si se vacía la caché, esperar 5 s de margen antes de seguir (default 1 s: con la
            // velocidad justa cortaba, seguía y volvía a cortar). También al arrancar.
            "--cache-pause-wait=5".into(),
            "--cache-pause-initial=yes".into(),
            // El motor puede tardar en conseguir una pieza: no abortar la lectura HTTP.
            "--network-timeout=120".into(),
            "--keep-open=no".into(),
            // Ventana siempre, ya al abrir (2026-11-20: con un mp3 sonaba sin ventana y no había
            // dónde cerrarlo).
            "--force-window=immediate".into(),
        ];
        // Ecualizador elegido en Ajustes (2026-11-17; antes fijo en "cine"). `af-append` suma al
        // final: no pisa los filtros del mpv.conf del usuario. Con label `@eq` para que el script
        // de teclas (más abajo) lo cambie en vivo.
        if let Some(af) = self.config.equalizer.lavfi(self.config.equalizer_intensity) {
            args.push(format!("--af-append=@eq:lavfi=[{af}]"));
        }
        // Teclas del ecualizador en vivo (Alt+←→ tipo, Alt+↑↓ intensidad). Sin el script (disco),
        // el ecualizador de Ajustes rige igual, solo que sin teclas.
        match self.write_eq_script() {
            Ok(script) => {
                args.push(format!("--script={}", script.display()));
                for (key, value) in eq_script_opts(&self.config) {
                    args.push(format!("--script-opts-append=streamonte-eq-{key}={value}"));
                }
                if self.eq_tip_due() {
                    args.push("--script-opts-append=streamonte-eq-tip=yes".into());
                }
            }
            Err(e) => tracing::warn!("no se pudo escribir el script del ecualizador: {e}"),
        }
        for sub in &req.subtitle_files {
            args.push(format!("--sub-file={}", sub.display()));
        }
        // Log propio de mpv solo con diagnóstico activo (Q-06); al lado de los demás logs.
        let log_file = req.log_file.clone().or_else(|| {
            crate::logger::diagnostics_enabled()
                .then(|| self.paths.log_dir.join("diag-mpv-player.log"))
        });
        if let Some(log) = log_file {
            args.push(format!("--log-file={}", log.display()));
        }
        args.extend(req.extra_args.iter().cloned());
        args.push(req.url.clone());
        args
    }
}

/// Lo que se lee del video sin ventana: duración, pistas de audio (idioma, 2026-11-14) y, de la
/// misma lectura, subtítulos embebidos y fps (dropdown de subtítulos, 2026-11-18).
#[derive(Debug, Clone)]
pub struct MediaProbe {
    pub duration_secs: f64,
    pub audio: Vec<crate::audio::AudioTrack>,
    pub subs: Vec<crate::subtitles::NativeSub>,
    pub fps: Option<f64>,
}

/// Pistas de subtítulo embebidas del `track-list` de mpv (las externas no: no hay ninguna al
/// leer sin ventana). `id` es el `sid` con que se eligen.
fn sub_tracks(list: &serde_json::Value) -> Vec<crate::subtitles::NativeSub> {
    let str_of =
        |t: &serde_json::Value, k: &str| t.get(k).and_then(|v| v.as_str()).map(str::to_string);
    list.as_array()
        .into_iter()
        .flatten()
        .filter(|t| t.get("type").and_then(|v| v.as_str()) == Some("sub"))
        .filter_map(|t| {
            Some(crate::subtitles::NativeSub {
                sid: Some(t.get("id")?.as_i64()?),
                file: None,
                lang: str_of(t, "lang"),
                title: str_of(t, "title"),
                codec: str_of(t, "codec"),
                forced: t.get("forced").and_then(|v| v.as_bool()).unwrap_or(false),
                sdh: t
                    .get("hearing-impaired")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
                default: t.get("default").and_then(|v| v.as_bool()).unwrap_or(false),
            })
        })
        .collect()
}

/// Cuadros por segundo de la primera pista de video (`demux-fps`).
fn video_fps(list: &serde_json::Value) -> Option<f64> {
    list.as_array()?
        .iter()
        .find(|t| t.get("type").and_then(|v| v.as_str()) == Some("video"))?
        .get("demux-fps")?
        .as_f64()
        .filter(|f| *f > 0.0)
}

/// Pistas de audio del `track-list` de mpv.
fn audio_tracks(list: &serde_json::Value) -> Vec<crate::audio::AudioTrack> {
    let str_of =
        |t: &serde_json::Value, k: &str| t.get(k).and_then(|v| v.as_str()).map(str::to_string);
    list.as_array()
        .into_iter()
        .flatten()
        .filter(|t| t.get("type").and_then(|v| v.as_str()) == Some("audio"))
        .map(|t| crate::audio::AudioTrack {
            lang: str_of(t, "lang"),
            title: str_of(t, "title"),
            codec: str_of(t, "codec"),
            channels: t
                .get("demux-channel-count")
                .and_then(|v| v.as_u64())
                .and_then(|n| u32::try_from(n).ok()),
            default: t.get("default").and_then(|v| v.as_bool()).unwrap_or(false),
        })
        .collect()
}

/// Duración REAL y pistas de audio leyendo solo lo necesario, sin ventana (FR-06, lección 9):
/// `mpv --no-config --vo=null --ao=null --idle=no` + IPC `get_property duration`/`track-list`.
///
/// `--pause` evita que reproduzca (lee solo cabecera/índice, que el analizador ya precargó).
/// mpv se mata siempre al terminar, haya o no respuesta.
pub async fn probe_media(
    mpv: &std::path::Path,
    url: &str,
    timeout: Duration,
) -> Result<MediaProbe> {
    let exe = prefer_gui_binary(mpv.to_path_buf());
    let ipc_path = new_ipc_path("streamonte-probe");
    let args: Vec<String> = [
        "--no-config",
        "--vo=null",
        "--ao=null",
        "--idle=no",
        "--pause",
        "--no-terminal",
        "--network-timeout=60",
        &format!("--input-ipc-server={ipc_path}"),
        url,
    ]
    .map(String::from)
    .into();
    // Medición de fondo: sin ventana y muere si se suelta.
    let mut child = spawn_player(&exe, &args, true)?;

    let result = tokio::time::timeout(timeout, async {
        let ipc = crate::mpv_ipc::MpvIpc::connect(&ipc_path, timeout).await?;
        loop {
            // `duration` da error ("property unavailable") hasta que mpv abre el archivo.
            if let Ok(value) = ipc.get_property("duration").await {
                if let Some(secs) = value.as_f64().filter(|s| *s > 0.0) {
                    // Las pistas ya están: se leen de la misma cabecera que la duración.
                    let list = ipc.get_property("track-list").await.unwrap_or_default();
                    return Ok(MediaProbe {
                        duration_secs: secs,
                        audio: audio_tracks(&list),
                        subs: sub_tracks(&list),
                        fps: video_fps(&list),
                    });
                }
            }
            if let Ok(Some(status)) = child.try_wait() {
                return Err(CoreError::Player(format!(
                    "mpv terminó sin leer la duración ({status})"
                )));
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    })
    .await
    .unwrap_or(Err(CoreError::Timeout {
        what: "duración del video",
        secs: timeout.as_secs(),
    }));
    let _ = child.kill().await;
    remove_ipc_socket(&ipc_path);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 2026-11-20: VLC con un mp3 se cerró a los 30 ms con código 0 → no pudo abrir, no "lo cerró
    /// el usuario". Igual para mpv; con video ya mostrado, cerrar es del usuario.
    #[test]
    fn salida_temprana_o_con_error_sin_video_es_que_no_pudo_abrir() {
        let ms = Duration::from_millis;
        assert!(PlayerExit::new(true, Some(0), ms(30), false).failed_to_open);
        assert!(PlayerExit::new(false, Some(2), ms(9_000), false).failed_to_open);
        assert!(!PlayerExit::new(true, Some(0), ms(9_000), false).failed_to_open);
        assert!(!PlayerExit::new(false, Some(1), ms(500), true).failed_to_open);
        assert_eq!(
            PlayerExit::new(true, Some(0), ms(30), false).to_string(),
            "código 0, a los 0.0 s"
        );
    }
}
