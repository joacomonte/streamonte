//! Abrir una carpeta o una URL con el programa del sistema (Explorador / Finder / navegador).

use std::ffi::OsStr;

/// `explorer` (Windows), `open` (macOS) o `xdg-open` (otros), sin esperar a que termine.
pub(crate) fn open_external(target: impl AsRef<OsStr>) -> std::io::Result<()> {
    #[cfg(windows)]
    let program = "explorer";
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let program = "xdg-open";
    std::process::Command::new(program)
        .arg(target)
        .spawn()
        .map(drop)
}
