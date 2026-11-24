//! `paths` — carpetas del sistema operativo y ejecutables externos (NFR-03).
//! Cero rutas absolutas en el código: todo sale de `directories` o de la config.

use std::path::{Path, PathBuf};

use crate::Result;

/// Carpetas de la app según el SO.
/// - Windows: `%APPDATA%\streamonte\{data,config}`, `%LOCALAPPDATA%\streamonte\cache`, `%TEMP%\streamonte`
/// - macOS:   `~/Library/Application Support/app.streamonte`, `~/Library/Caches/app.streamonte`, `$TMPDIR/streamonte`
///
/// Las descargas (pausadas FR-12b, análisis FR-06d) van en la caché, no en temporales: el SO
/// purga `$TMPDIR` / `%TEMP%` por su cuenta y se perdería lo que el usuario conserva.
#[derive(Debug, Clone)]
pub struct AppPaths {
    pub data_dir: PathBuf,
    pub cache_dir: PathBuf,
    /// Solo lo efímero (estado interno del motor). El SO puede purgarla en cualquier momento.
    pub temp_dir: PathBuf,
    pub log_dir: PathBuf,
}

impl AppPaths {
    /// Resuelve y crea las carpetas si faltan.
    pub fn resolve() -> Result<Self> {
        let dirs = directories::ProjectDirs::from("app", "", "streamonte")
            .ok_or(crate::CoreError::Unsupported("carpeta de usuario"))?;
        // Antes de crear las carpetas nuevas: si existen, la migración no toca nada.
        crate::rebrand::migrate(&dirs);
        let paths = Self {
            data_dir: dirs.data_dir().to_path_buf(),
            cache_dir: dirs.cache_dir().to_path_buf(),
            temp_dir: std::env::temp_dir().join("streamonte"),
            log_dir: dirs.data_local_dir().join("logs"),
        };
        paths.ensure_dirs()?;
        Ok(paths)
    }

    /// Crea todas las carpetas (idempotente).
    pub fn ensure_dirs(&self) -> Result<()> {
        for dir in [
            &self.data_dir,
            &self.cache_dir,
            &self.temp_dir,
            &self.log_dir,
            &self.torrent_cache_dir(),
            &self.downloads_dir(),
        ] {
            std::fs::create_dir_all(dir).map_err(|source| crate::CoreError::Io {
                path: dir.clone(),
                source,
            })?;
        }
        Ok(())
    }

    /// Variante para pruebas: todo bajo una carpeta raíz temporal.
    pub fn under(root: &Path) -> Self {
        Self {
            data_dir: root.join("data"),
            cache_dir: root.join("cache"),
            temp_dir: root.join("temp"),
            log_dir: root.join("logs"),
        }
    }

    pub fn library_file(&self) -> PathBuf {
        self.data_dir.join("library.json")
    }
    pub fn config_file(&self) -> PathBuf {
        self.data_dir.join("config.json")
    }
    /// Calibración del semáforo (reproducciones reales vs. análisis): la escribe solo `playback`.
    pub fn calibration_file(&self) -> PathBuf {
        self.data_dir.join("calibration.json")
    }
    /// Velocidad de internet medida, una por red (`speedtest`).
    pub fn speed_file(&self) -> PathBuf {
        self.data_dir.join("velocidad.json")
    }
    pub fn subtitles_memory_file(&self) -> PathBuf {
        self.data_dir.join("subtitles-memory.json")
    }
    /// Tabla de rutas del DHT (rqbit): evita arrancar el DHT en frío cada vez (ADR-30).
    pub fn dht_file(&self) -> PathBuf {
        self.cache_dir.join("dht.json")
    }
    /// `.torrent` guardados para no volver a pedir metadatos (FR-13).
    pub fn torrent_cache_dir(&self) -> PathBuf {
        self.cache_dir.join("torrents")
    }
    /// `.torrent` en caché de `hash` (FR-13).
    pub fn torrent_cache_file(&self, hash: &crate::magnet::InfoHash) -> PathBuf {
        self.torrent_cache_dir()
            .join(format!("{}.torrent", hash.to_hex()))
    }
    /// Peers vistos al analizar a fondo `hash`: arrancan la reproducción ya sabiendo a quién pedir.
    pub fn peers_cache_file(&self, hash: &crate::magnet::InfoHash) -> PathBuf {
        self.torrent_cache_dir()
            .join(format!("{}.peers", hash.to_hex()))
    }
    /// Caché de datos (`datacache`): fichas, puntajes, datasets de IMDb. Aparte de los videos.
    pub fn data_cache_dir(&self) -> PathBuf {
        self.cache_dir.join("datos")
    }
    /// Copia de la lista compartida de trackers (`trackers::shared_list`).
    pub fn shared_trackers_file(&self) -> PathBuf {
        self.cache_dir.join("trackers-best.txt")
    }
    /// Subtítulos de un video, adentro de la carpeta de su descarga (`<dir>/subs/<video_id>`):
    /// al borrar el video se van con él (2026-11-15: "todo en un mismo lugar").
    pub fn video_subtitles_dir(dir: &Path, video_id: &str) -> PathBuf {
        dir.join("subs").join(video_id)
    }
    /// Subtítulos pedidos desde el catálogo para una opción (video + torrent: el orden depende de
    /// su release) antes de que exista la carpeta del video; la reproducción los mueve adentro de
    /// la suya. Sin dueño: la limpieza de restos los borra.
    pub fn pending_subtitles_dir(&self, video_id: &str, hash: &crate::magnet::InfoHash) -> PathBuf {
        let torrent: String = hash.to_hex().chars().take(12).collect();
        self.downloads_dir()
            .join(format!("subs-{video_id}-{torrent}"))
    }
    /// Caché vieja (antes de 2026-11-15), una carpeta aparte para todos los subtítulos: se borra.
    pub fn legacy_subtitle_cache_dir(&self) -> PathBuf {
        self.cache_dir.join("subtitles")
    }
    /// Una subcarpeta por reproducción/medición: `downloads/<hash>-<id>` (FR-12, FR-19).
    pub fn downloads_dir(&self) -> PathBuf {
        self.cache_dir.join("downloads")
    }
    /// Carpeta efímera del motor rqbit (carpeta por defecto de la sesión y su estado).
    pub fn rqbit_temp_dir(&self) -> PathBuf {
        self.temp_dir.join("rqbit")
    }

    /// Hasta 2026-11 las descargas vivían en `temp_dir/downloads`. Al abrir se mueven a
    /// [`downloads_dir`](Self::downloads_dir) renombrando (idempotente: sin nada que mover no
    /// hace nada). Si no se puede (otro disco) quedan donde están y se anota en el log: no se
    /// copian GB al abrir la app.
    pub fn migrate_downloads_from_temp(&self) {
        let old = self.temp_dir.join("downloads");
        let Ok(entries) = std::fs::read_dir(&old) else {
            return;
        };
        let new = self.downloads_dir();
        for entry in entries.flatten() {
            let (from, to) = (entry.path(), new.join(entry.file_name()));
            if to.exists() {
                tracing::warn!(?from, ?to, "descarga vieja no movida: el destino ya existe");
                continue;
            }
            match std::fs::rename(&from, &to) {
                Ok(()) => tracing::info!(?from, ?to, "descarga movida de temporales a la caché"),
                Err(e) => {
                    tracing::warn!(?from, "descarga vieja no movida (queda en temporales): {e}")
                }
            }
        }
        let _ = std::fs::remove_dir(&old); // solo si quedó vacía
    }
    /// FR-06d: lo bajado al analizar un magnet (precarga + muestra de velocidad). Vive mientras
    /// el magnet esté en la lista; al dar play la reproducción adopta esta carpeta.
    pub fn analysis_dir(&self, hash: &crate::magnet::InfoHash) -> PathBuf {
        self.downloads_dir()
            .join(format!("{}-analisis", hash.to_hex()))
    }
}

/// Ejecutables externos que la app necesita.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Executable {
    Mpv,
    Vlc,
    /// Sincronización automática (FR-27), opcional.
    Alass,
}

impl Executable {
    pub fn display_name(self) -> &'static str {
        match self {
            Self::Mpv => "mpv",
            Self::Vlc => "VLC",
            Self::Alass => "alass",
        }
    }
}

/// Busca un ejecutable: 1) ruta configurada, 2) el mpv que trae la app (2026-11-17), 3) PATH,
/// 4) ubicaciones típicas del SO (p. ej. `Program Files\MPV Player`, `/Applications/mpv.app`,
/// Homebrew). Devuelve `None` si no está.
pub fn find_executable(exe: Executable, configured: Option<&Path>) -> Option<PathBuf> {
    locate(exe, configured).map(|(path, _)| path)
}

/// De dónde sale el ejecutable que se usa (Ajustes lo muestra).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Source {
    Configured,
    Bundled,
    Installed,
}

/// [`find_executable`] con de dónde salió.
pub fn locate(exe: Executable, configured: Option<&Path>) -> Option<(PathBuf, Source)> {
    if let Some(path) = configured {
        // La ruta configurada manda; si no existe, no adivinamos otra (el usuario la corrige).
        return path
            .is_file()
            .then(|| (path.to_path_buf(), Source::Configured));
    }
    if exe == Executable::Mpv {
        if let Some(path) = bundled_mpv() {
            return Some((path, Source::Bundled));
        }
    }
    let installed = which::which(exe.binary_name())
        .ok()
        .or_else(|| exe.typical_locations().into_iter().find(|p| p.is_file()));
    installed.map(|p| (p, Source::Installed))
}

/// El mpv que trae la app (2026-11-17), si este equipo lo puede correr: en macOS el oficial pide
/// macOS 15+ (en uno más viejo no carga y se usa el instalado o VLC). Junto al ejecutable (Windows y
/// desarrollo) o en `Resources` del `.app`. Se prueba una vez por ejecución.
pub fn bundled_mpv() -> Option<PathBuf> {
    static RUNS: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();
    RUNS.get_or_init(|| {
        let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
        let rel = if cfg!(windows) {
            "mpv/mpv.exe"
        } else {
            "mpv/mpv.app/Contents/MacOS/mpv"
        };
        let path = [dir.join(rel), dir.join("../Resources").join(rel)]
            .into_iter()
            .find(|p| p.is_file())?;
        // Bajado con la app sin firmar: macOS lo marca en cuarentena y podría frenarlo al abrirlo.
        #[cfg(target_os = "macos")]
        if let Some(app) = path.ancestors().nth(3) {
            let _ = std::process::Command::new("xattr")
                .args(["-dr", "com.apple.quarantine"])
                .arg(app)
                .output();
        }
        let ok = std::process::Command::new(&path)
            .arg("--version")
            .output()
            .is_ok_and(|o| o.status.success());
        if !ok {
            tracing::info!("mpv incluido: no corre en este equipo, se usa el instalado o VLC");
        }
        ok.then_some(path)
    })
    .clone()
}

impl Executable {
    /// Nombre del binario en PATH (sin extensión: `which` agrega `.exe` en Windows).
    fn binary_name(self) -> &'static str {
        match self {
            Self::Mpv => "mpv",
            Self::Vlc => "vlc",
            Self::Alass => "alass-cli",
        }
    }

    /// Ubicaciones de instalación habituales cuando no está en PATH.
    fn typical_locations(self) -> Vec<PathBuf> {
        let mut out = Vec::new();
        #[cfg(windows)]
        {
            let roots: Vec<PathBuf> = ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"]
                .iter()
                .filter_map(|v| std::env::var_os(v).map(PathBuf::from))
                .collect();
            let rel: &[&str] = match self {
                Self::Mpv => &[
                    "mpv\\mpv.exe",
                    "MPV Player\\mpv.exe",
                    "Programs\\mpv\\mpv.exe",
                ],
                Self::Vlc => &["VideoLAN\\VLC\\vlc.exe"],
                Self::Alass => &[],
            };
            for root in &roots {
                out.extend(rel.iter().map(|r| root.join(r)));
            }
            if let (Self::Mpv, Some(home)) = (self, std::env::var_os("USERPROFILE")) {
                out.push(PathBuf::from(home).join("scoop\\apps\\mpv\\current\\mpv.exe"));
            }
        }
        #[cfg(target_os = "macos")]
        {
            let rel: &[&str] = match self {
                Self::Mpv => &[
                    "/Applications/mpv.app/Contents/MacOS/mpv",
                    "/opt/homebrew/bin/mpv",
                    "/usr/local/bin/mpv",
                ],
                Self::Vlc => &["/Applications/VLC.app/Contents/MacOS/VLC"],
                Self::Alass => &["/opt/homebrew/bin/alass-cli", "/usr/local/bin/alass-cli"],
            };
            out.extend(rel.iter().map(PathBuf::from));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migra_descargas_de_temporales_a_la_cache() {
        let root = crate::fsutil::test_dir("migrate");
        let p = AppPaths::under(&root);
        p.ensure_dirs().unwrap();
        let old = p.temp_dir.join("downloads").join("abc-analisis");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("pieza"), b"x").unwrap();

        p.migrate_downloads_from_temp();
        assert!(p
            .downloads_dir()
            .join("abc-analisis")
            .join("pieza")
            .is_file());
        assert!(!p.temp_dir.join("downloads").exists());
        p.migrate_downloads_from_temp(); // sin nada que mover: no falla
    }

    #[test]
    fn ensure_dirs_crea_las_carpetas() {
        let root = crate::fsutil::test_dir("ensure");
        let p = AppPaths::under(&root);
        p.ensure_dirs().unwrap();
        for dir in [
            &p.data_dir,
            &p.cache_dir,
            &p.temp_dir,
            &p.log_dir,
            &p.torrent_cache_dir(),
            &p.downloads_dir(),
        ] {
            assert!(dir.is_dir(), "{}", dir.display());
        }
    }

    #[test]
    fn ruta_configurada_inexistente_devuelve_none() {
        let fake = std::env::temp_dir().join("no-existe-mpv.exe");
        assert_eq!(find_executable(Executable::Mpv, Some(&fake)), None);
    }

    #[test]
    fn ruta_configurada_existente_se_respeta() {
        let exe = std::env::current_exe().unwrap();
        assert_eq!(find_executable(Executable::Vlc, Some(&exe)), Some(exe));
    }
}
