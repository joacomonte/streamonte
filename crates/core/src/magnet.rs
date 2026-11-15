//! `magnet` — parseo de magnets, normalización del info hash, agregado de trackers (FR-01, FR-10).
//! Puro: sin E/S. Lección 8: el magnet nunca pasa por un shell, así que `&` no es problema
//! en v2; igual se prueba (T-07).

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::{CoreError, Result};

/// Info hash v1 (SHA-1, 20 bytes). Se serializa siempre como hex en minúsculas.
/// Acepta hex (40) y base32 (32) — FR-01. Magnets BitTorrent v2 (`btmh`) fuera de alcance.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct InfoHash([u8; 20]);

impl InfoHash {
    pub fn from_bytes(bytes: [u8; 20]) -> Self {
        Self(bytes)
    }
    pub fn as_bytes(&self) -> &[u8; 20] {
        &self.0
    }

    /// Acepta 40 hex o 32 base32 (mayúsculas o minúsculas).
    pub fn parse(text: &str) -> Result<Self> {
        let text = text.trim();
        let decoded = match text.len() {
            40 => data_encoding::HEXLOWER_PERMISSIVE
                .decode(text.as_bytes())
                .ok(),
            32 => data_encoding::BASE32
                .decode(text.to_ascii_uppercase().as_bytes())
                .ok(),
            _ => None,
        };
        decoded
            .and_then(|bytes| <[u8; 20]>::try_from(bytes).ok())
            .map(Self)
            .ok_or_else(|| CoreError::InvalidMagnet(format!("info hash inválido: {text}")))
    }

    pub fn to_hex(&self) -> String {
        data_encoding::HEXLOWER.encode(&self.0)
    }
}

impl fmt::Display for InfoHash {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_hex())
    }
}
impl fmt::Debug for InfoHash {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "InfoHash({})", self.to_hex())
    }
}
impl TryFrom<String> for InfoHash {
    type Error = crate::CoreError;
    fn try_from(s: String) -> Result<Self> {
        Self::parse(&s)
    }
}
impl From<InfoHash> for String {
    fn from(h: InfoHash) -> String {
        h.to_hex()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Magnet {
    pub info_hash: InfoHash,
    /// `dn` decodificado (puede faltar).
    pub display_name: Option<String>,
    /// `tr` del magnet original, en orden, sin duplicados.
    pub trackers: Vec<String>,
}

impl Magnet {
    /// Parsea un único `magnet:?xt=urn:btih:…`. Tolera `&amp;`, mayúsculas, parámetros desconocidos.
    pub fn parse(uri: &str) -> Result<Self> {
        let invalid = || CoreError::InvalidMagnet(truncate(uri, 80));
        let uri = uri.trim();
        let query = strip_prefix_ci(uri, "magnet:?").ok_or_else(invalid)?;
        // Magnets pegados desde HTML traen `&amp;`.
        let query = query.replace("&amp;", "&");

        let mut info_hash = None;
        let mut display_name = None;
        let mut trackers: Vec<String> = Vec::new();
        for pair in query.split('&').filter(|p| !p.is_empty()) {
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            match key.to_ascii_lowercase().as_str() {
                "xt" if info_hash.is_none() => {
                    let value = percent_decode(value, false);
                    if let Some(hash) = strip_prefix_ci(&value, "urn:btih:") {
                        // Basura pegada al hash (`HASH)`, `HASH,`): hex y base32 son alfanuméricos.
                        let hash = hash
                            .split(|c: char| !c.is_ascii_alphanumeric())
                            .next()
                            .unwrap_or_default();
                        info_hash = Some(InfoHash::parse(hash)?);
                    }
                }
                "dn" if display_name.is_none() => {
                    let name = percent_decode(value, true);
                    if !name.trim().is_empty() {
                        display_name = Some(name.trim().to_string());
                    }
                }
                "tr" => {
                    let tracker = percent_decode(value, false);
                    if !tracker.is_empty() && !trackers.contains(&tracker) {
                        trackers.push(tracker);
                    }
                }
                _ => {}
            }
        }
        Ok(Self {
            info_hash: info_hash.ok_or_else(invalid)?,
            display_name,
            trackers,
        })
    }

    /// Copia con trackers extra agregados al final, sin duplicados (FR-10).
    pub fn with_trackers(&self, extra: &[String]) -> Self {
        let mut trackers = self.trackers.clone();
        for t in extra {
            if !trackers.contains(t) {
                trackers.push(t.clone());
            }
        }
        Self {
            trackers,
            ..self.clone()
        }
    }

    /// URI canónico (hash hex + dn + tr, percent-encoded).
    pub fn to_uri(&self) -> String {
        let mut uri = format!("magnet:?xt=urn:btih:{}", self.info_hash.to_hex());
        if let Some(name) = &self.display_name {
            uri.push_str("&dn=");
            uri.push_str(&percent_encode(name));
        }
        for tracker in &self.trackers {
            uri.push_str("&tr=");
            uri.push_str(&percent_encode(tracker));
        }
        uri
    }
}

/// Todos los magnets de un texto (FR-01: "texto con varios magnets → se agregan todos"),
/// sin duplicados por info hash, en orden de aparición. Ignora los inválidos.
pub fn extract_all(text: &str) -> Vec<Magnet> {
    extract_all_with_raw(text)
        .into_iter()
        .map(|(m, _)| m)
        .collect()
}

/// Como [`extract_all`], pero con el texto original de cada magnet (para "Copiar magnet",
/// FR-04: se devuelve tal cual se copió). Agregado en F2.
pub fn extract_all_with_raw(text: &str) -> Vec<(Magnet, String)> {
    let mut found: Vec<(Magnet, String)> = Vec::new();
    for candidate in magnet_spans(text) {
        if let Ok(m) = Magnet::parse(candidate) {
            if !found.iter().any(|(f, _)| f.info_hash == m.info_hash) {
                found.push((m, candidate.to_string()));
            }
        }
    }
    found
}

/// ¿El texto es SOLO magnets (y espacios)? Usado por el historial Win+V (FR-02, ver Q-09).
pub fn is_only_magnets(text: &str) -> bool {
    let mut any = false;
    for token in text.split_whitespace() {
        if Magnet::parse(token).is_err() {
            return false;
        }
        any = true;
    }
    any
}

// ---------- utilidades internas ----------

const MAGNET_PREFIX: &str = "magnet:?";

/// Trozos de texto que empiezan con `magnet:?` (sin distinguir mayúsculas) y terminan en
/// espacio, comillas o `<>` (magnets pegados desde HTML o JSON), sin la puntuación final
/// del texto que lo rodea (`[x](magnet:…)`, `magnet:…,`).
fn magnet_spans(text: &str) -> Vec<&str> {
    let lower = text.to_ascii_lowercase();
    let mut spans = Vec::new();
    let mut from = 0;
    while let Some(pos) = lower[from..].find(MAGNET_PREFIX) {
        let start = from + pos;
        let end = text[start..]
            .find(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | '<' | '>'))
            .map_or(text.len(), |e| start + e);
        spans.push(trim_trailing_punct(&text[start..end]));
        from = end;
    }
    spans
}

/// Quita `,.;` finales y `)]}` que no cierran nada abierto dentro del magnet
/// (`dn=Sintel+(2010)` conserva su paréntesis).
fn trim_trailing_punct(mut span: &str) -> &str {
    loop {
        let unbalanced =
            |open: char, close: char| span.matches(close).count() > span.matches(open).count();
        span = match span.chars().last() {
            Some(',' | '.' | ';') => &span[..span.len() - 1],
            Some(')') if unbalanced('(', ')') => &span[..span.len() - 1],
            Some(']') if unbalanced('[', ']') => &span[..span.len() - 1],
            Some('}') if unbalanced('{', '}') => &span[..span.len() - 1],
            _ => return span,
        };
    }
}

fn strip_prefix_ci<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    let head = s.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix)
        .then(|| &s[prefix.len()..])
}

fn truncate(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// `%XX` → byte. En `dn`, `+` también es espacio (convención de formularios, la usan muchos sitios).
fn percent_decode(s: &str, plus_is_space: bool) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => match (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                (Some(h), Some(l)) => {
                    out.push(h * 16 + l);
                    i += 3;
                    continue;
                }
                _ => out.push(b'%'),
            },
            b'+' if plus_is_space => out.push(b' '),
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    (b as char).to_digit(16).map(|d| d as u8)
}

fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEX: &str = "08ada5a7a6183aae1e09d831df6748d566095a10"; // Sintel
    const B32: &str = "BCW2LJ5GDA5K4HQJ3AY56Z2I2VTASWQQ";

    #[test]
    fn hash_hex_y_base32_son_el_mismo() {
        let a = InfoHash::parse(HEX).unwrap();
        let b = InfoHash::parse(B32).unwrap();
        let c = InfoHash::parse(&B32.to_lowercase()).unwrap();
        assert_eq!(a, b);
        assert_eq!(a, c);
        assert_eq!(a.to_hex(), HEX);
        assert!(InfoHash::parse("abc").is_err());
    }

    #[test]
    fn parsea_dn_trackers_y_ampersand_en_el_nombre() {
        // T-07: `&` codificado dentro del nombre, `&amp;` de HTML, mayúsculas y `+` como espacio.
        let uri = format!(
            "MAGNET:?xt=urn:btih:{HEX}&amp;dn=Tom+%26+Jerry%20(1940)&tr=udp%3A%2F%2Fa%3A1&tr=udp%3A%2F%2Fa%3A1&x.pe=1.2.3.4:5"
        );
        let m = Magnet::parse(&uri).unwrap();
        assert_eq!(m.info_hash.to_hex(), HEX);
        assert_eq!(m.display_name.as_deref(), Some("Tom & Jerry (1940)"));
        assert_eq!(m.trackers, vec!["udp://a:1".to_string()], "sin duplicados");
    }

    #[test]
    fn solo_hash_sin_trackers() {
        let m = Magnet::parse(&format!("magnet:?xt=urn:btih:{B32}")).unwrap();
        assert!(m.trackers.is_empty());
        assert!(m.display_name.is_none());
    }

    #[test]
    fn invalidos() {
        assert!(Magnet::parse("http://x").is_err());
        assert!(Magnet::parse("magnet:?dn=sin-hash").is_err());
        assert!(Magnet::parse("magnet:?xt=urn:btih:zzz").is_err());
    }

    #[test]
    fn to_uri_ida_y_vuelta_con_trackers_extra() {
        let m = Magnet::parse(&format!("magnet:?xt=urn:btih:{HEX}&dn=A%26B")).unwrap();
        let extra = vec!["udp://t:1/announce".to_string(), "wss://w".to_string()];
        let full = m.with_trackers(&extra);
        let back = Magnet::parse(&full.to_uri()).unwrap();
        assert_eq!(back, full);
        assert_eq!(back.trackers, extra);
    }

    #[test]
    fn extract_all_varios_y_repetidos() {
        // FR-01: 3 magnets (uno repetido, uno en base32 = mismo hash) → 2.
        let other = "c9e15763f722f23e98a29decdfae341b98d53056";
        let text = format!(
            "mirá esto magnet:?xt=urn:btih:{HEX}&dn=Sintel\n\"magnet:?xt=urn:btih:{other}\" y magnet:?xt=urn:btih:{B32}"
        );
        let all = extract_all(&text);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].info_hash.to_hex(), HEX);
        assert_eq!(all[1].info_hash.to_hex(), other);
    }

    #[test]
    fn puntuacion_alrededor_del_magnet() {
        let other = "c9e15763f722f23e98a29decdfae341b98d53056";
        let text = format!(
            "[x](magnet:?xt=urn:btih:{HEX}&tr=udp%3A%2F%2Fa%3A1), magnet:?xt=urn:btih:{other}&dn=Sintel+(2010)."
        );
        let all = extract_all_with_raw(&text);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].0.trackers, vec!["udp://a:1".to_string()]);
        assert_eq!(
            all[0].1,
            format!("magnet:?xt=urn:btih:{HEX}&tr=udp%3A%2F%2Fa%3A1")
        );
        assert_eq!(all[1].0.display_name.as_deref(), Some("Sintel (2010)"));
        // El hash se corta en lo primero que no es alfanumérico.
        let m = Magnet::parse(&format!("magnet:?xt=urn:btih:{HEX})")).unwrap();
        assert_eq!(m.info_hash.to_hex(), HEX);
    }

    #[test]
    fn is_only_magnets_reglas() {
        assert!(is_only_magnets(&format!(" magnet:?xt=urn:btih:{HEX} \n")));
        assert!(!is_only_magnets(&format!("hola magnet:?xt=urn:btih:{HEX}")));
        assert!(!is_only_magnets("   "));
    }
}
