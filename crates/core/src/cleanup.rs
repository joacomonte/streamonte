//! `cleanup` — detección de huérfanos, limpieza segura, tamaños, abrir carpeta (FR-16, FR-18–20, NFR-11).
//!
//! Cómo se reconoce un huérfano (T-05: matar la app a la fuerza → limpiar al reabrir):
//! cada carpeta `downloads/<hash>-<pid>-<id>/` tiene `.tstream-owner.json` con `{ app_pid, engine_pid,
//! player_pid, started_at }`. Es huérfana si ni la app ni el motor que la crearon siguen vivos
//! (un mpv que sigue abierto no la retiene: sin motor esos datos no sirven). Un PID cuenta como
//! "vivo" solo si el proceso empezó ANTES de `started_at`: así un PID reciclado no engaña.
//! Carpetas sin registro de dueño: huérfanas si tienen más de 2 min (no pisar una recién creada).
//!
//! Regla de oro (FR-19): nunca toca carpetas en uso (registro interno `IN_USE` + las que pase el
//! llamador) ni nada fuera de la carpeta de descargas (el historial vive en la carpeta de datos).

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

use crate::paths::AppPaths;
use crate::{CoreError, Result};

pub const OWNER_FILE: &str = ".tstream-owner.json";
/// Descarga pausada que el usuario conserva (FR-12 cambiado, 2026-11-13): nunca es huérfana;
/// se borra solo a pedido ("Borrar" / "Borrar todo"). La escribe `playback`.
pub const KEPT_FILE: &str = ".tstream-kept.json";
/// Una carpeta sin registro de dueño más nueva que esto puede estar recién creándose.
const UNCLAIMED_GRACE: Duration = Duration::from_secs(120);
/// Tolerancia entre la hora de inicio que informa el SO y `started_at`.
const START_TIME_SLACK_SECS: u64 = 5;
/// Marca de los procesos sidecar nuestros (para matarlos si quedaron sin app).
const SIDECAR_MARK: &str = "webtorrent-sidecar";

/// Carpetas que este proceso está usando ahora (reproducciones y mediciones). Compartido por
/// todas las instancias de `Cleanup`: `claim` agrega, `release`/`remove_dir` sacan.
fn in_use() -> &'static Mutex<HashSet<PathBuf>> {
    static IN_USE: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    IN_USE.get_or_init(Mutex::default)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OwnerRecord {
    pub app_pid: u32,
    pub engine_pid: Option<u32>,
    pub player_pid: Option<u32>,
    pub started_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Leftover {
    /// Carpeta de descarga sin dueño vivo.
    DownloadDir { path: PathBuf, size_bytes: u64 },
    /// Proceso del motor nuestro que quedó vivo sin app (se mata).
    Process { pid: u32, name: String },
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct CleanupReport {
    pub dirs_removed: u32,
    pub bytes_freed: u64,
    pub processes_killed: u32,
    /// Lo que no se pudo borrar (archivo en uso, permisos) — se reintenta en el próximo inicio.
    pub failures: Vec<String>,
}

impl CleanupReport {
    pub fn is_empty(&self) -> bool {
        self.dirs_removed == 0 && self.processes_killed == 0 && self.failures.is_empty()
    }
}

pub struct Cleanup {
    paths: AppPaths,
}

impl Cleanup {
    pub fn new(paths: AppPaths) -> Self {
        Self { paths }
    }

    /// Escribe el registro de dueño al crear una carpeta de descarga y la marca en uso.
    pub fn claim(&self, download_dir: &Path, owner: &OwnerRecord) -> Result<()> {
        in_use()
            .lock()
            .expect("in_use")
            .insert(download_dir.to_path_buf());
        crate::fsutil::write_json_atomic(&download_dir.join(OWNER_FILE), owner)
    }

    /// Marca la carpeta en uso solo si nadie la tenía (atómico). FR-06d: una carpeta de análisis
    /// la usa una sola fase a la vez, y la reproducción no la adopta mientras se esté midiendo.
    pub fn try_reserve(&self, dir: &Path) -> bool {
        in_use().lock().expect("in_use").insert(dir.to_path_buf())
    }

    /// La carpeta deja de estar en uso (p. ej. "Detener" sin borrar): la próxima limpieza la toma.
    pub fn release(&self, download_dir: &Path) {
        in_use().lock().expect("in_use").remove(download_dir);
    }

    /// Restos sin proceso (FR-20, T-05). `active` = carpetas en uso que conoce el llamador.
    pub fn scan(&self, active: &HashSet<PathBuf>) -> Result<Vec<Leftover>> {
        let procs = ProcessTable::load();
        let mut out = Vec::new();
        for dir in self.candidate_dirs(active)? {
            if self.is_orphan(&dir, &procs) {
                out.push(Leftover::DownloadDir {
                    size_bytes: dir_size(&dir),
                    path: dir,
                });
            }
        }
        for (pid, name) in procs.orphan_sidecars() {
            out.push(Leftover::Process { pid, name });
        }
        Ok(out)
    }

    /// Tamaño total de temporales que borraría "Limpiar temporales" (confirmación de FR-19).
    pub fn temp_size(&self, active: &HashSet<PathBuf>) -> Result<u64> {
        Ok(self
            .candidate_dirs(active)?
            .iter()
            .map(|d| dir_size(d))
            .sum())
    }

    /// "Limpiar temporales" (FR-19): borra TODAS las carpetas que no están en uso (huérfanas o
    /// detenidas sin borrar) y mata sidecars sin app. Nunca toca las activas ni el historial.
    pub fn clean(&self, active: &HashSet<PathBuf>) -> Result<CleanupReport> {
        let mut report = CleanupReport::default();
        for dir in self.candidate_dirs(active)? {
            remove_dir_sync(&dir, &mut report);
        }
        kill_orphan_sidecars(&ProcessTable::load(), &mut report);
        Ok(report)
    }

    /// Limpieza automática al abrir/cerrar (FR-20): solo restos SIN dueño vivo.
    pub fn clean_orphans(&self, active: &HashSet<PathBuf>) -> Result<CleanupReport> {
        let procs = ProcessTable::load();
        let mut report = CleanupReport::default();
        for dir in self.candidate_dirs(active)? {
            if self.is_orphan(&dir, &procs) {
                remove_dir_sync(&dir, &mut report);
            }
        }
        kill_orphan_sidecars(&procs, &mut report);
        Ok(report)
    }

    /// Borra una carpeta concreta (Detener y borrar, FR-15). Reintenta ~5 s si hay archivos en uso.
    /// Devuelve los bytes liberados. Nunca borra fuera de la carpeta de descargas de la app.
    pub async fn remove_dir(&self, dir: &Path) -> Result<u64> {
        self.check_inside_downloads(dir)?;
        self.release(dir);
        if !dir.exists() {
            return Ok(0);
        }
        let size = dir_size(dir);
        // Windows: un archivo puede seguir abierto unos instantes tras cerrar el motor.
        let mut last_err = None;
        for _ in 0..20 {
            match tokio::fs::remove_dir_all(dir).await {
                Ok(()) => return Ok(size),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(size),
                Err(e) => {
                    last_err = Some(e);
                    tokio::time::sleep(Duration::from_millis(250)).await;
                }
            }
        }
        Err(CoreError::Io {
            path: dir.to_path_buf(),
            source: last_err.expect("al menos un intento"),
        })
    }

    // ---------- internos ----------

    fn check_inside_downloads(&self, dir: &Path) -> Result<()> {
        let downloads = self.paths.downloads_dir();
        if !dir.starts_with(&downloads) || dir == downloads {
            return Err(CoreError::Unsupported(
                "borrar fuera de la carpeta de descargas",
            ));
        }
        Ok(())
    }

    /// Subcarpetas de `downloads/` que no están en uso.
    fn candidate_dirs(&self, active: &HashSet<PathBuf>) -> Result<Vec<PathBuf>> {
        let downloads = self.paths.downloads_dir();
        let entries = match std::fs::read_dir(&downloads) {
            Ok(e) => e,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(source) => {
                return Err(CoreError::Io {
                    path: downloads,
                    source,
                })
            }
        };
        let busy = in_use().lock().expect("in_use").clone();
        Ok(entries
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
            .map(|e| e.path())
            .filter(|p| !active.contains(p) && !busy.contains(p))
            .collect())
    }

    fn is_orphan(&self, dir: &Path, procs: &ProcessTable) -> bool {
        if dir.join(KEPT_FILE).is_file() {
            return false; // pausada y conservada por el usuario
        }
        match crate::fsutil::read_json::<OwnerRecord>(&dir.join(OWNER_FILE)) {
            Ok(Some(owner)) => {
                let since = owner.started_at.timestamp().max(0) as u64;
                let owner_alive = procs.alive_since(owner.app_pid, since)
                    || owner
                        .engine_pid
                        .is_some_and(|p| procs.alive_since(p, since));
                !owner_alive
            }
            // Sin registro (o ilegible): huérfana si ya pasó el margen de creación.
            _ => modified_ago(dir).is_some_and(|age| age > UNCLAIMED_GRACE),
        }
    }
}

/// Foto de los procesos del sistema.
struct ProcessTable {
    sys: Option<System>,
}

impl ProcessTable {
    fn load() -> Self {
        let sys = System::new().ok().map(|mut s| {
            s.refresh_processes_specifics(
                ProcessesToUpdate::All,
                true,
                ProcessRefreshKind::nothing().with_cmd(UpdateKind::OnlyIfNotSet),
            );
            s
        });
        if sys.is_none() {
            tracing::warn!(
                "no se pudo leer la lista de procesos: se asume que todos los dueños viven"
            );
        }
        Self { sys }
    }

    /// ¿Vive `pid` y empezó antes de `since` (segundos Unix)? Sin tabla de procesos: se asume vivo
    /// (ante la duda, no se borra nada).
    fn alive_since(&self, pid: u32, since: u64) -> bool {
        let Some(sys) = &self.sys else { return true };
        sys.process(Pid::from_u32(pid))
            .is_some_and(|p| p.start_time() <= since + START_TIME_SLACK_SECS)
    }

    /// Sidecars `node … webtorrent-sidecar …` cuyo proceso padre ya no existe.
    fn orphan_sidecars(&self) -> Vec<(u32, String)> {
        let Some(sys) = &self.sys else {
            return Vec::new();
        };
        sys.processes()
            .values()
            .filter(|p| {
                p.cmd()
                    .iter()
                    .any(|a| a.to_string_lossy().contains(SIDECAR_MARK))
            })
            .filter(|p| {
                p.parent()
                    .map_or(true, |parent| sys.process(parent).is_none())
            })
            .map(|p| (p.pid().as_u32(), p.name().to_string_lossy().into_owned()))
            .collect()
    }
}

fn kill_orphan_sidecars(procs: &ProcessTable, report: &mut CleanupReport) {
    let Some(sys) = &procs.sys else { return };
    for (pid, name) in procs.orphan_sidecars() {
        if sys.process(Pid::from_u32(pid)).is_some_and(|p| p.kill()) {
            tracing::info!(pid, name, "sidecar huérfano terminado");
            report.processes_killed += 1;
        }
    }
}

fn remove_dir_sync(dir: &Path, report: &mut CleanupReport) {
    let size = dir_size(dir);
    let mut last_err = None;
    for _ in 0..8 {
        match std::fs::remove_dir_all(dir) {
            Ok(()) => {
                report.dirs_removed += 1;
                report.bytes_freed += size;
                tracing::info!(?dir, size, "carpeta temporal borrada");
                return;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
            Err(e) => {
                last_err = Some(e);
                std::thread::sleep(Duration::from_millis(250));
            }
        }
    }
    if let Some(e) = last_err {
        report.failures.push(format!("{}: {e}", dir.display()));
    }
}

fn modified_ago(path: &Path) -> Option<Duration> {
    let modified = std::fs::metadata(path).and_then(|m| m.modified()).ok()?;
    SystemTime::now().duration_since(modified).ok()
}

/// Tamaño total de una carpeta (best effort).
fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .filter_map(|e| e.ok())
        .map(|e| match e.metadata() {
            Ok(m) if m.is_dir() => dir_size(&e.path()),
            Ok(m) => m.len(),
            Err(_) => 0,
        })
        .sum()
}

/// Abre una carpeta en el Explorador / Finder (FR-18).
pub fn open_in_file_manager(path: &Path) -> Result<()> {
    #[cfg(windows)]
    let program = "explorer";
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let program = "xdg-open";
    std::fs::create_dir_all(path).map_err(|source| CoreError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    std::process::Command::new(program)
        .arg(path)
        .spawn()
        .map(drop)
        .map_err(|source| CoreError::Io {
            path: path.to_path_buf(),
            source,
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        root: PathBuf,
        cleanup: Cleanup,
        downloads: PathBuf,
    }

    impl Fixture {
        fn new(name: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "tstream-test-cleanup-{name}-{}",
                std::process::id()
            ));
            let _ = std::fs::remove_dir_all(&root);
            let paths = AppPaths::under(&root);
            paths.ensure_dirs().unwrap();
            let downloads = paths.downloads_dir();
            Self {
                root,
                cleanup: Cleanup::new(paths),
                downloads,
            }
        }

        fn dir_with(&self, name: &str, owner: Option<OwnerRecord>, bytes: usize) -> PathBuf {
            let d = self.downloads.join(name);
            std::fs::create_dir_all(&d).unwrap();
            std::fs::write(d.join("pieza"), vec![7u8; bytes]).unwrap();
            if let Some(o) = owner {
                crate::fsutil::write_json_atomic(&d.join(OWNER_FILE), &o).unwrap();
            }
            d
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn owner(app_pid: u32, started_at: chrono::DateTime<chrono::Utc>) -> OwnerRecord {
        OwnerRecord {
            app_pid,
            engine_pid: None,
            player_pid: None,
            started_at,
        }
    }

    /// Un PID que no existe (máximo de u32 menos algo: ningún SO lo asigna en una prueba).
    const DEAD_PID: u32 = u32::MAX - 7;

    #[test]
    fn t_05_dueno_muerto_es_huerfana_y_vivo_no() {
        let f = Fixture::new("orphan");
        let muerta = f.dir_with("muerta", Some(owner(DEAD_PID, chrono::Utc::now())), 10);
        let viva = f.dir_with(
            "viva",
            Some(owner(std::process::id(), chrono::Utc::now())),
            10,
        );
        let found = f.cleanup.scan(&HashSet::new()).unwrap();
        let dirs: Vec<&PathBuf> = found
            .iter()
            .filter_map(|l| match l {
                Leftover::DownloadDir { path, .. } => Some(path),
                _ => None,
            })
            .collect();
        assert_eq!(dirs, vec![&muerta]);
        let report = f.cleanup.clean_orphans(&HashSet::new()).unwrap();
        assert_eq!(report.dirs_removed, 1);
        assert!(!muerta.exists());
        assert!(viva.exists(), "el dueño vivo la protege");
    }

    #[test]
    fn pid_reciclado_no_engana() {
        // Nuestro PID existe, pero el registro dice que la carpeta se creó ANTES de que este
        // proceso arrancara (hace 1 año) → otro proceso con el mismo PID → huérfana.
        let f = Fixture::new("reuse");
        let hace_un_anio = chrono::Utc::now() - chrono::Duration::days(365);
        let d = f.dir_with("vieja", Some(owner(std::process::id(), hace_un_anio)), 10);
        let report = f.cleanup.clean_orphans(&HashSet::new()).unwrap();
        assert_eq!(report.dirs_removed, 1);
        assert!(!d.exists());
    }

    #[test]
    fn sin_registro_reciente_se_respeta() {
        let f = Fixture::new("unclaimed");
        let d = f.dir_with("recien-creada", None, 10);
        assert!(f
            .cleanup
            .scan(&HashSet::new())
            .unwrap()
            .iter()
            .all(|l| !matches!(l, Leftover::DownloadDir { .. })));
        assert!(d.exists());
    }

    #[test]
    fn fr_19_limpiar_no_toca_activas_ni_en_uso_y_reporta_tamano() {
        let f = Fixture::new("clean");
        let activa = f.dir_with(
            "activa",
            Some(owner(std::process::id(), chrono::Utc::now())),
            1000,
        );
        let en_uso = f.downloads.join("en-uso");
        std::fs::create_dir_all(&en_uso).unwrap();
        f.cleanup
            .claim(&en_uso, &owner(std::process::id(), chrono::Utc::now()))
            .unwrap();
        let detenida = f.dir_with(
            "detenida",
            Some(owner(std::process::id(), chrono::Utc::now())),
            3000,
        );
        let huerfana = f.dir_with("huerfana", Some(owner(DEAD_PID, chrono::Utc::now())), 2000);

        let active = HashSet::from([activa.clone()]);
        let size = f.cleanup.temp_size(&active).unwrap();
        assert!(
            size >= 5000,
            "detenida + huérfana (y sus registros): {size}"
        );

        let report = f.cleanup.clean(&active).unwrap();
        assert_eq!(report.dirs_removed, 2);
        assert!(activa.exists() && en_uso.exists());
        assert!(!detenida.exists() && !huerfana.exists());

        f.cleanup.release(&en_uso);
        assert_eq!(
            f.cleanup.clean(&active).unwrap().dirs_removed,
            1,
            "liberada → se limpia"
        );
    }

    #[test]
    fn nunca_borra_fuera_de_descargas() {
        let f = Fixture::new("outside");
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let fuera = f.root.join("data");
        assert!(rt.block_on(f.cleanup.remove_dir(&fuera)).is_err());
        assert!(rt.block_on(f.cleanup.remove_dir(&f.downloads)).is_err());
        assert!(fuera.exists());
    }
}
