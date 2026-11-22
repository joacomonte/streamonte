//! Caché de datos (2026-11-16): lo que sirve de nuevo y cuesta traer (datasets de IMDb, fichas
//! de series y películas, puntajes por temporada, fichas y pósters de TMDB). Separada de la caché
//! de videos: vive en `cache/datos/`, "Borrar caché" no la toca y tiene su propio botón.
//!
//! Un archivo por clave; la edad sale de la fecha de modificación. Cada quien decide cuánto le
//! sirve un dato (`age`) y, si la red falla, puede usar uno vencido.

use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::{CoreError, Result};

/// Tope total: al abrir la app se borra lo más viejo hasta quedar debajo.
pub const MAX_BYTES: u64 = 300 * 1024 * 1024;

#[derive(Debug)]
pub struct DataCache {
    dir: PathBuf,
}

impl DataCache {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    /// `key`: nombre de archivo armado por quien llama (sin `/`).
    fn path(&self, key: &str) -> PathBuf {
        self.dir.join(key.replace(['/', '\\', ':'], "_"))
    }

    /// Los bytes guardados y hace cuánto se guardaron.
    pub fn read(&self, key: &str) -> Option<(Vec<u8>, Duration)> {
        let path = self.path(key);
        let age = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| SystemTime::now().duration_since(t).ok())
            .unwrap_or_default();
        Some((std::fs::read(&path).ok()?, age))
    }

    /// Guarda (escribe aparte y renombra: un corte a mitad no deja un archivo roto). Si falla, solo
    /// se avisa en el log: la caché es una ayuda, nunca un error para el usuario.
    pub fn write(&self, key: &str, bytes: &[u8]) {
        let path = self.path(key);
        let tmp = path.with_extension("tmp");
        let res = std::fs::create_dir_all(&self.dir)
            .and_then(|()| std::fs::write(&tmp, bytes))
            .and_then(|()| std::fs::rename(&tmp, &path));
        if let Err(e) = res {
            tracing::debug!(key, "no se pudo guardar en la caché de datos: {e}");
        }
    }

    /// Un JSON guardado y su edad; `None` si no está o no se puede leer (formato viejo).
    pub fn get<T: DeserializeOwned>(&self, key: &str) -> Option<(T, Duration)> {
        let (bytes, age) = self.read(key)?;
        Some((serde_json::from_slice(&bytes).ok()?, age))
    }

    pub fn put<T: Serialize>(&self, key: &str, value: &T) {
        if let Ok(bytes) = serde_json::to_vec(value) {
            self.write(key, &bytes);
        }
    }

    fn files(&self) -> Vec<(PathBuf, u64, SystemTime)> {
        let Ok(dir) = std::fs::read_dir(&self.dir) else {
            return Vec::new();
        };
        dir.flatten()
            .filter_map(|e| {
                let m = e.metadata().ok().filter(|m| m.is_file())?;
                Some((
                    e.path(),
                    m.len(),
                    m.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                ))
            })
            .collect()
    }

    pub fn size(&self) -> u64 {
        self.files().iter().map(|(_, len, _)| len).sum()
    }

    /// "Borrar datos guardados": todo. Devuelve los bytes liberados.
    pub fn clear(&self) -> Result<u64> {
        let freed = self.size();
        match std::fs::remove_dir_all(&self.dir) {
            Ok(()) => Ok(freed),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(0),
            Err(source) => Err(CoreError::Io {
                path: self.dir.clone(),
                source,
            }),
        }
    }

    /// Borra lo guardado hace más tiempo hasta quedar debajo de `max_bytes`.
    pub fn prune(&self, max_bytes: u64) {
        let mut files = self.files();
        let mut total: u64 = files.iter().map(|(_, len, _)| len).sum();
        files.sort_by_key(|(_, _, modified)| *modified);
        for (path, len, _) in files {
            if total <= max_bytes {
                break;
            }
            if std::fs::remove_file(&path).is_ok() {
                total -= len;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guarda_lee_poda_y_borra() {
        let dir = crate::fsutil::test_dir("datacache");
        let cache = DataCache::new(dir.to_path_buf());
        assert!(cache.get::<Vec<u32>>("nada.json").is_none());
        cache.put("a.json", &vec![1u32, 2, 3]);
        let (v, age) = cache.get::<Vec<u32>>("a.json").unwrap();
        assert_eq!(v, [1, 2, 3]);
        assert!(age < Duration::from_secs(5));
        cache.write("b/c:d", &[0u8; 100]);
        assert_eq!(
            cache.read("b/c:d").unwrap().0.len(),
            100,
            "la clave se sanea"
        );
        // a.json (7 bytes) + b (40) = 47 > 45: se va lo más viejo (a.json) y queda b.
        cache.write("b/c:d", &[0u8; 40]);
        // Fecha fija en vez de dormir: a.json es de hace una hora.
        std::fs::File::options()
            .write(true)
            .open(dir.join("a.json"))
            .unwrap()
            .set_modified(SystemTime::now() - Duration::from_secs(3600))
            .unwrap();
        cache.prune(45);
        assert!(cache.read("a.json").is_none());
        assert!(cache.read("b/c:d").is_some());
        assert_eq!(cache.clear().unwrap(), 40);
        assert_eq!(cache.size(), 0);
    }
}
