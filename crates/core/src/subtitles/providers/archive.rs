//! Subtítulos que llegan comprimidos (`.zip`/`.rar`/`.7z`, p. ej. Subdivx).

use std::path::{Path, PathBuf};
use std::time::Duration;

use super::err;
use crate::{CoreError, Result};

/// Subdivx entrega `.zip`/`.rar`. Se descomprimen con el `tar` del sistema (bsdtar/libarchive:
/// viene con Windows 10+ y macOS y lee zip, rar y 7z) para no sumar dependencias (NFR-14).
/// Devuelve el subtítulo más grande del archivo (o los bytes tal cual si no es un archivo).
pub(super) async fn extract_if_archive(
    provider: &'static str,
    bytes: Vec<u8>,
    work: &Path,
) -> Result<Vec<u8>> {
    let is_archive = bytes.starts_with(b"PK\x03\x04")
        || bytes.starts_with(b"Rar!")
        || bytes.starts_with(&[0x37, 0x7A, 0xBC, 0xAF]);
    if !is_archive {
        return Ok(bytes);
    }
    let _ = std::fs::remove_dir_all(work);
    // Se borra también si falla un `?` o si se cancela la descarga (el future se descarta).
    struct RemoveOnDrop<'a>(&'a Path);
    impl Drop for RemoveOnDrop<'_> {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(self.0);
        }
    }
    let _cleanup = RemoveOnDrop(work);
    std::fs::create_dir_all(work).map_err(|source| CoreError::Io {
        path: work.to_path_buf(),
        source,
    })?;
    let archive = work.join("archivo.bin");
    let out = work.join("x");
    std::fs::create_dir_all(&out).map_err(|source| CoreError::Io {
        path: out.clone(),
        source,
    })?;
    std::fs::write(&archive, &bytes).map_err(|source| CoreError::Io {
        path: archive.clone(),
        source,
    })?;
    let mut cmd = tokio::process::Command::new("tar");
    cmd.arg("-xf")
        .arg(&archive)
        .arg("-C")
        .arg(&out)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let status = tokio::time::timeout(Duration::from_secs(20), cmd.status())
        .await
        .map_err(|_| err(provider, "descomprimir tardó demasiado"))?
        .map_err(|e| err(provider, format!("no se pudo ejecutar tar: {e}")))?;
    if status.success() {
        largest_subtitle(&out)
            .and_then(|p| std::fs::read(p).ok())
            .ok_or_else(|| err(provider, "el archivo comprimido no trae .srt/.ass"))
    } else {
        Err(err(
            provider,
            format!("tar no pudo descomprimir ({status})"),
        ))
    }
}

fn largest_subtitle(dir: &Path) -> Option<PathBuf> {
    let mut best: Option<(u64, PathBuf)> = None;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for entry in std::fs::read_dir(&d).ok()?.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let is_sub = path.extension().and_then(|e| e.to_str()).is_some_and(|e| {
                crate::subtitles::SUBTITLE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str())
            });
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            let bigger = match &best {
                Some((s, _)) => size > *s,
                None => true,
            };
            if is_sub && bigger {
                best = Some((size, path));
            }
        }
    }
    best.map(|(_, p)| p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn descomprime_o_pasa_tal_cual() {
        let dir = crate::fsutil::test_dir("subarchive");
        // Un archivo que no es comprimido pasa tal cual.
        let raw = extract_if_archive("x", b"texto".to_vec(), &dir.join("w"))
            .await
            .unwrap();
        assert_eq!(raw, b"texto");
        // Un zip roto falla y no deja la carpeta de trabajo.
        let work = dir.join(".tmp-x");
        assert!(extract_if_archive("x", b"PK\x03\x04roto".to_vec(), &work)
            .await
            .is_err());
        assert!(!work.exists());
    }
}
