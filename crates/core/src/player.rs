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

/// En Windows, `mpv.com` (el que suele quedar en PATH) es un envoltorio de consola que abre una
/// ventana negra extra; si al lado está `mpv.exe`, usamos ese.
/// El reproductor que se usa (2026-11-17): el elegido; si es mpv y no hay ninguno (ni el incluido
/// ni uno instalado, p. ej. macOS < 15 sin mpv), VLC si está instalado.
pub fn resolve_player(wanted: PlayerKind, cfg: &PlayerConfig) -> PlayerKind {
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
    /// El elegido en Ajustes y el que de verdad se usa (VLC si se eligió mpv y no hay).
    pub chosen: PlayerKind,
    pub effective: PlayerKind,
    /// macOS con Homebrew: "Instalar mpv" lo instala solo; si no, abre la guía.
    pub can_install_mpv: bool,
}

pub fn players_status(cfg: &PlayerConfig) -> PlayersStatus {
    PlayersStatus {
        mpv: crate::paths::locate(Executable::Mpv, cfg.mpv_path.as_deref()).map(|(_, s)| s),
        vlc: find_executable(Executable::Vlc, cfg.vlc_path.as_deref()).is_some(),
        chosen: cfg.default_player,
        effective: resolve_player(cfg.default_player, cfg),
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
    /// Primera imagen en pantalla → métrica "tiempo a primera imagen" (O1, 06-D).
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

/// Un reproductor abierto. Soltarlo NO lo mata; `playback` decide (FR-17).
pub struct PlayerSession {
    pub kind: PlayerKind,
    pub pid: u32,
    /// Solo mpv.
    pub mpv: Option<std::sync::Arc<dyn MpvControl>>,
    child: tokio::process::Child,
    /// IPC de mpv: en macOS/Linux su socket queda en la carpeta temporal si mpv muere de golpe.
    ipc_path: Option<String>,
}

impl PlayerSession {
    /// Espera a que el usuario cierre el reproductor (FR-12).
    pub async fn wait_exit(&mut self) -> Result<ExitStatus> {
        let status = self
            .child
            .wait()
            .await
            .map_err(|e| crate::CoreError::Player(e.to_string()));
        self.remove_socket_file();
        status
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
            mpv,
            child,
            ipc_path: ipc,
        })
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
        ];
        // Ecualizador elegido en Ajustes (2026-11-17; antes fijo en "cine"). `af-append` suma al
        // final: no pisa los filtros del mpv.conf del usuario.
        if let Some(af) = self.config.equalizer.lavfi() {
            args.push(format!("--af-append=lavfi=[{af}]"));
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

/// Lo que se lee del video sin ventana: duración y pistas de audio (idioma, 2026-11-14).
#[derive(Debug, Clone)]
pub struct MediaProbe {
    pub duration_secs: f64,
    pub audio: Vec<crate::audio::AudioTrack>,
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
                    let audio = match ipc.get_property("track-list").await {
                        Ok(list) => audio_tracks(&list),
                        Err(_) => Vec::new(),
                    };
                    return Ok(MediaProbe {
                        duration_secs: secs,
                        audio,
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
