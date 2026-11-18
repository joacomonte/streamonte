//! Caché de subtítulos bajados (uno por candidato, normalizado a UTF-8). La comparten el
//! analizador y la reproducción.

use std::path::{Path, PathBuf};

use super::err;
use crate::subtitles::{merge, SubtitleCandidate};
use crate::{CoreError, Result};

/// Bytes de un subtítulo → texto UTF-8: UTF-8 (con o sin BOM), UTF-16 con BOM, o
/// Windows-1252/Latin-1 (subtítulos en español viejos).
pub(in crate::subtitles) fn to_utf8(bytes: &[u8]) -> String {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(rest).into_owned();
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return encoding_rs::UTF_16LE.decode(bytes).0.into_owned();
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return encoding_rs::UTF_16BE.decode(bytes).0.into_owned();
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => encoding_rs::WINDOWS_1252.decode(bytes).0.into_owned(),
    }
}

pub(super) fn sanitize(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') {
                c
            } else {
                '_'
            }
        })
        .collect();
    s.chars().take(120).collect()
}

/// Ruta en caché de un candidato ya bajado (srt o ass), si existe. Evita volver a gastar cuota.
pub fn cached(cache_dir: &Path, cand: &SubtitleCandidate) -> Option<PathBuf> {
    cached_by_key(cache_dir, &cand.key())
}

/// Igual que [`cached`] pero por la clave `proveedor:id` (la que guarda la memoria, FR-28).
pub fn cached_by_key(cache_dir: &Path, key: &str) -> Option<PathBuf> {
    merge::CACHE_EXTENSIONS
        .iter()
        .map(|ext| cache_dir.join(format!("{}.{ext}", sanitize(key))))
        .find(|p| p.is_file())
}

/// Escribe `bytes` en un temporal único de la misma carpeta y lo renombra: el analizador y la
/// reproducción comparten la caché y nunca deben ver un archivo a medio escribir.
pub(in crate::subtitles) fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let io = |p: &Path| {
        let p = p.to_path_buf();
        move |source| CoreError::Io { path: p, source }
    };
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(format!(".tmp-{}-{n}", std::process::id()));
    let tmp = PathBuf::from(tmp);
    std::fs::write(&tmp, bytes).map_err(io(&tmp))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        io(path)(e)
    })
}

/// Guarda el subtítulo normalizado a UTF-8 en la caché. Rechaza lo que no tiene ningún evento
/// (páginas de error, archivos vacíos).
pub(super) fn save(cache_dir: &Path, cand: &SubtitleCandidate, bytes: &[u8]) -> Result<PathBuf> {
    let text = to_utf8(bytes);
    let cues = merge::parse_any(&text);
    if cues.is_empty() {
        return Err(err(cand.provider, "lo bajado no es un subtítulo"));
    }
    let path = cache_dir.join(format!(
        "{}.{}",
        sanitize(&cand.key()),
        merge::format_ext(&text)
    ));
    std::fs::create_dir_all(cache_dir).map_err(|source| CoreError::Io {
        path: cache_dir.to_path_buf(),
        source,
    })?;
    write_atomic(&path, text.as_bytes())?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::SubtitleLanguage;
    use crate::subtitles::providers::WYZIE;
    use crate::subtitles::{MatchKind, SpanishVariant};

    #[test]
    fn texto_a_utf8() {
        assert_eq!(to_utf8(b"\xEF\xBB\xBFhola"), "hola");
        assert_eq!(to_utf8(b"canci\xf3n"), "canción");
        assert_eq!(to_utf8("ñandú".as_bytes()), "ñandú");
        assert_eq!(to_utf8(&[0xFF, 0xFE, b'h', 0, b'i', 0]), "hi");
    }

    #[test]
    fn guarda_en_cache_y_rechaza_basura() {
        let dir =
            std::env::temp_dir().join(format!("streamonte-test-subcache-{}", std::process::id()));
        let cand = SubtitleCandidate {
            provider: WYZIE,
            provider_id: "a/b".into(),
            release_name: String::new(),
            language: SubtitleLanguage::Es,
            match_kind: MatchKind::None,
            downloads: 0,
            variant: SpanishVariant::Unknown,
            url: String::new(),
            fps: None,
            last_secs: None,
        };
        assert!(save(&dir, &cand, b"<html>error</html>").is_err());
        assert_eq!(cached(&dir, &cand), None);
        let p = save(&dir, &cand, b"1\n00:00:01,000 --> 00:00:02,000\nhola\n").unwrap();
        assert_eq!(cached(&dir, &cand), Some(p));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
