//! `paths` — carpetas del sistema operativo y ejecutables externos (NFR-03).
//! Cero rutas absolutas en el código: todo sale de `directories` o de la config.

use std::path::{Path, PathBuf};

use crate::Result;

/// Carpetas de la app según el SO.
/// - Windows: `%APPDATA%\tstream\v2\{data,config}`, `%LOCALAPPDATA%\tstream\v2\cache`, `%TEMP%\tstream-v2`
/// - macOS:   `~/Library/Application Support/app.tstream.v2`, `~/Library/Caches/app.tstream.v2`, `$TMPDIR/tstream-v2`
#[derive(Debug, Clone)]
pub struct AppPaths {
    pub data_dir: PathBuf,
    pub cache_dir: PathBuf,
    /// Descargas en curso. Siempre limpiable (spec 04, "Temporales").
    pub temp_dir: PathBuf,
    pub log_dir: PathBuf,
}

impl AppPaths {
    /// Resuelve y crea las carpetas si faltan.
    pub fn resolve() -> Result<Self> {
        let dirs = directories::ProjectDirs::from("app", "tstream", "v2")
            .ok_or(crate::CoreError::Unsupported("carpeta de usuario"))?;
        let paths = Self {
            data_dir: dirs.data_dir().to_path_buf(),
            cache_dir: dirs.cache_dir().to_path_buf(),
            temp_dir: std::env::temp_dir().join("tstream-v2"),
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
            &self.subtitle_cache_dir(),
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
    pub fn subtitle_cache_dir(&self) -> PathBuf {
        self.cache_dir.join("subtitles")
    }
    /// Perfil de mpv propio de la app (`--config-dir`), no pisa la config personal (FR-34).
    pub fn mpv_profile_dir(&self) -> PathBuf {
        self.data_dir.join("mpv")
    }
    /// Una subcarpeta por reproducción/medición: `downloads/<hash>-<id>` (FR-12, FR-19).
    pub fn downloads_dir(&self) -> PathBuf {
        self.temp_dir.join("downloads")
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

/// Busca un ejecutable: 1) ruta configurada, 2) PATH, 3) ubicaciones típicas del SO
/// (p. ej. `Program Files\MPV Player`, `/Applications/mpv.app`, Homebrew).
/// Devuelve `None` si no está; la UI pide la ruta en Ajustes.
pub fn find_executable(exe: Executable, configured: Option<&Path>) -> Option<PathBuf> {
    if let Some(path) = configured {
        // La ruta configurada manda; si no existe, no adivinamos otra (el usuario la corrige).
        return path.is_file().then(|| path.to_path_buf());
    }
    if let Ok(path) = which::which(exe.binary_name()) {
        return Some(path);
    }
    exe.typical_locations().into_iter().find(|p| p.is_file())
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

/// `main.mjs` del sidecar webtorrent: 1) ruta configurada, 2) `engines/webtorrent-sidecar/`
/// junto al ejecutable (app instalada), 3) solo en builds de desarrollo, el del repositorio.
/// El empaquetado definitivo del sidecar se decide tras el benchmark (R-03, R-07).
pub fn webtorrent_sidecar_script(configured: Option<&Path>) -> Option<PathBuf> {
    const REL: &str = "engines/webtorrent-sidecar/src/main.mjs";
    if let Some(path) = configured {
        return path.is_file().then(|| path.to_path_buf());
    }
    let beside_exe = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|d| d.join(REL)));
    if let Some(p) = beside_exe.filter(|p| p.is_file()) {
        return Some(p);
    }
    #[cfg(debug_assertions)]
    {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join(REL);
        if repo.is_file() {
            return Some(repo);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn under_pone_todo_bajo_la_raiz() {
        let root = std::env::temp_dir().join("tstream-test-paths");
        let p = AppPaths::under(&root);
        for dir in [&p.data_dir, &p.cache_dir, &p.temp_dir, &p.log_dir] {
            assert!(dir.starts_with(&root));
        }
        assert!(p.library_file().starts_with(&p.data_dir));
        assert!(p.downloads_dir().starts_with(&p.temp_dir));
    }

    #[test]
    fn ensure_dirs_crea_las_carpetas() {
        let root = std::env::temp_dir().join(format!("tstream-test-ensure-{}", std::process::id()));
        let p = AppPaths::under(&root);
        p.ensure_dirs().unwrap();
        assert!(p.downloads_dir().is_dir());
        assert!(p.torrent_cache_dir().is_dir());
        std::fs::remove_dir_all(&root).unwrap();
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
