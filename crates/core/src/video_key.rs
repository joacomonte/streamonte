//! `video_key` — identidad de UN video: info hash + qué video dentro del torrent.
//!
//! En un pack de temporada todos los episodios comparten el info hash: identificar por hash solo
//! mezclaba episodios (agregar S3E2 pisaba la fila de S3E1, play retomaba E1, "Retomar" sin haber
//! visto). Una fila de *Mis magnets*, una reproducción, una descarga pausada y el subtítulo
//! recordado (FR-28) se identifican con esta clave; el análisis de velocidad sigue por hash (mismo
//! enjambre). Se compara con `==`: es la única regla de identidad.
//!
//! Como texto (UI, `.tstream-kept.json`, `subtitles-memory.json`): `<hex>` (el torrent entero →
//! el video más grande), `<hex>:s3e2` (episodio) o `<hex>:f12` (archivo del addon).

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::magnet::InfoHash;
use crate::{CoreError, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct VideoKey {
    pub info_hash: InfoHash,
    pub part: Option<VideoPart>,
}

/// Qué video del torrent. El episodio manda sobre el archivo: dos addons pueden dar distinto
/// `fileIdx` para el mismo episodio y siguen siendo el mismo video.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum VideoPart {
    Episode { season: u32, episode: u32 },
    File(usize),
}

impl VideoKey {
    /// Magnet pegado sin más datos: el torrent entero (se reproduce el video más grande).
    pub fn whole(info_hash: InfoHash) -> Self {
        Self {
            info_hash,
            part: None,
        }
    }

    /// Desde lo que dice el catálogo (FR-48/49): episodio si lo hay, si no el archivo del addon.
    pub fn new(info_hash: InfoHash, episode: Option<(u32, u32)>, file_idx: Option<usize>) -> Self {
        let part = match (episode, file_idx) {
            (Some((season, episode)), _) => Some(VideoPart::Episode { season, episode }),
            (None, Some(i)) => Some(VideoPart::File(i)),
            (None, None) => None,
        };
        Self { info_hash, part }
    }

    pub fn parse(text: &str) -> Result<Self> {
        let bad = || CoreError::InvalidMagnet(format!("clave de video inválida: {text}"));
        let (hash, part) = match text.trim().split_once(':') {
            Some((h, p)) => (h, Some(p)),
            None => (text.trim(), None),
        };
        let info_hash = InfoHash::parse(hash)?;
        let part = match part {
            None => None,
            Some(p) => Some(if let Some(i) = p.strip_prefix('f') {
                VideoPart::File(i.parse().map_err(|_| bad())?)
            } else {
                let (s, e) = p
                    .strip_prefix('s')
                    .and_then(|rest| rest.split_once('e'))
                    .ok_or_else(bad)?;
                VideoPart::Episode {
                    season: s.parse().map_err(|_| bad())?,
                    episode: e.parse().map_err(|_| bad())?,
                }
            }),
        };
        Ok(Self { info_hash, part })
    }
}

impl fmt::Display for VideoKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.part {
            None => write!(f, "{}", self.info_hash),
            Some(VideoPart::Episode { season, episode }) => {
                write!(f, "{}:s{season}e{episode}", self.info_hash)
            }
            Some(VideoPart::File(i)) => write!(f, "{}:f{i}", self.info_hash),
        }
    }
}

impl TryFrom<String> for VideoKey {
    type Error = CoreError;
    fn try_from(s: String) -> Result<Self> {
        Self::parse(&s)
    }
}
impl From<VideoKey> for String {
    fn from(k: VideoKey) -> String {
        k.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn texto_ida_y_vuelta_y_el_episodio_manda() {
        let h = InfoHash::from_bytes([7; 20]);
        let hex = h.to_hex();
        for (key, text) in [
            (VideoKey::whole(h), hex.clone()),
            (
                VideoKey::new(h, Some((3, 2)), Some(9)),
                format!("{hex}:s3e2"),
            ),
            (VideoKey::new(h, None, Some(12)), format!("{hex}:f12")),
        ] {
            assert_eq!(key.to_string(), text);
            assert_eq!(VideoKey::parse(&text).unwrap(), key);
            let json = serde_json::to_string(&key).unwrap();
            assert_eq!(serde_json::from_str::<VideoKey>(&json).unwrap(), key);
        }
        assert_ne!(
            VideoKey::new(h, Some((3, 1)), None),
            VideoKey::new(h, Some((3, 2)), None)
        );
        assert_ne!(VideoKey::whole(h), VideoKey::new(h, Some((3, 1)), None));
        assert!(VideoKey::parse(&format!("{hex}:x1")).is_err());
    }
}
