//! Utilidades de archivos compartidas (nivel 0): JSON con escritura atómica.
//! Atómica = escribir un temporal único, `sync_all` y renombrar → un corte de luz o un cierre forzado
//! nunca deja `config.json` / `library.json` a medio escribir.

use std::path::Path;

use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::{CoreError, Result};

/// Lee JSON. `Ok(None)` si el archivo no existe.
pub fn read_json<T: DeserializeOwned>(path: &Path) -> Result<Option<T>> {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(source) => {
            return Err(CoreError::Io {
                path: path.to_path_buf(),
                source,
            })
        }
    };
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|source| CoreError::Json {
            path: path.to_path_buf(),
            source,
        })
}

/// Escribe JSON legible de forma atómica, creando la carpeta si falta.
pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let io = |source| CoreError::Io {
        path: path.to_path_buf(),
        source,
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(io)?;
    }
    let bytes = serde_json::to_vec_pretty(value).map_err(|source| CoreError::Json {
        path: path.to_path_buf(),
        source,
    })?;
    // Nombre único: dos escrituras del mismo archivo a la vez no se pisan el temporal.
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp = path.with_extension(format!("json.{}-{seq}.tmp", std::process::id()));
    let written = (|| {
        use std::io::Write;
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(&bytes)?;
        // Sin esto, tras un corte de luz el rename puede quedar en disco antes que los datos.
        file.sync_all()?;
        // En Windows `rename` reemplaza el destino si existe (MoveFileExW con REPLACE_EXISTING).
        std::fs::rename(&tmp, path)
    })();
    if written.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    written.map_err(io)
}

/// Si un JSON está corrupto, se aparta como `<archivo>.corrupt-<fecha>` para no perderlo
/// y la app sigue con valores por defecto (NFR-12).
pub fn quarantine(path: &Path) -> Result<std::path::PathBuf> {
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let name = format!(
        "{}.corrupt-{stamp}",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("archivo")
    );
    let dest = path.with_file_name(name);
    std::fs::rename(path, &dest).map_err(|source| CoreError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    Ok(dest)
}

/// Bytes realmente escritos de un archivo. Los motores crean el video como archivo disperso del
/// tamaño completo: lo que cuenta es lo asignado en disco, no la longitud.
/// shortcut: un archivo NO disperso preasignado cuenta como completo; si algún motor lo hace, habría que leer su bitfield.
pub fn allocated_bytes(path: &Path) -> Option<u64> {
    let len = std::fs::metadata(path).ok()?.len();
    #[cfg(windows)]
    {
        use windows::core::HSTRING;
        use windows::Win32::Storage::FileSystem::GetCompressedFileSizeW;
        let mut high = 0u32;
        // SAFETY: ruta UTF-16 válida mientras dura la llamada; `high` es un u32 local.
        let low =
            unsafe { GetCompressedFileSizeW(&HSTRING::from(path.as_os_str()), Some(&mut high)) };
        if low == u32::MAX && windows::core::Error::from_thread().code().is_err() {
            return None;
        }
        Some(((u64::from(high) << 32) | u64::from(low)).min(len))
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Some((std::fs::metadata(path).ok()?.blocks() * 512).min(len))
    }
    #[cfg(not(any(windows, unix)))]
    Some(len)
}

/// Lo bajado del video `file_name` en las carpetas `<downloads>/<prefix>*` (análisis FR-06d y
/// reproducciones pausadas FR-12): el MÁXIMO, no la suma (son piezas distintas del mismo archivo).
pub fn downloaded_in_dirs(downloads: &Path, prefix: &str, file_name: &str) -> u64 {
    let Some(leaf) = Path::new(file_name).file_name() else {
        return 0;
    };
    fn largest(dir: &Path, leaf: &std::ffi::OsStr, depth: u8) -> u64 {
        let Ok(rd) = std::fs::read_dir(dir) else {
            return 0;
        };
        rd.flatten()
            .map(|e| {
                let p = e.path();
                if p.is_dir() {
                    if depth > 0 {
                        largest(&p, leaf, depth - 1)
                    } else {
                        0
                    }
                } else if p.file_name() == Some(leaf) {
                    allocated_bytes(&p).unwrap_or(0)
                } else {
                    0
                }
            })
            .max()
            .unwrap_or(0)
    }
    let Ok(rd) = std::fs::read_dir(downloads) else {
        return 0;
    };
    rd.flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with(prefix) && e.path().is_dir())
        .map(|e| largest(&e.path(), leaf, 3))
        .max()
        .unwrap_or(0)
}

/// El archivo con más bytes escritos dentro de `dir` (el video; se saltean `.tstream-*`).
pub fn biggest_file(dir: &Path) -> Option<(std::path::PathBuf, u64)> {
    fn walk(dir: &Path, depth: u8, best: &mut Option<(std::path::PathBuf, u64)>) {
        let Ok(rd) = std::fs::read_dir(dir) else {
            return;
        };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                if depth > 0 {
                    walk(&p, depth - 1, best);
                }
            } else if !e.file_name().to_string_lossy().starts_with('.') {
                let n = allocated_bytes(&p).unwrap_or(0);
                if !matches!(best, Some((_, b)) if *b >= n) {
                    *best = Some((p, n));
                }
            }
        }
    }
    let mut best = None;
    walk(dir, 3, &mut best);
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bajado_es_el_maximo_entre_analisis_y_reproduccion_del_mismo_hash() {
        let root = std::env::temp_dir().join(format!("tstream-test-dl-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let write = |dir: &str, name: &str, n: usize| {
            let d = root.join(dir);
            std::fs::create_dir_all(&d).unwrap();
            std::fs::write(d.join(name), vec![1u8; n]).unwrap();
        };
        write("abc-analisis", "Peli.mkv", 300_000);
        write("abc-123-1/Carpeta", "Peli.mkv", 100_000);
        write("abd-analisis", "Peli.mkv", 900_000); // otro hash: no cuenta
        write("abc-analisis", "otro.mkv", 800_000); // otro archivo: no cuenta
        let got = downloaded_in_dirs(&root, "abc-", "Carpeta/Peli.mkv");
        // Lo asignado redondea a clusters: ~300 KB, nunca más que el archivo.
        assert!((290_000..=300_000).contains(&got), "{got}");
        assert_eq!(downloaded_in_dirs(&root, "zzz-", "Peli.mkv"), 0);
        std::fs::remove_dir_all(&root).unwrap();
    }
}
