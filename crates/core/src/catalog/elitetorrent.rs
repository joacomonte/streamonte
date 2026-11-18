//! EliteTorrent (2026-11-18): sitio WordPress con películas en castellano/latino. Sin API ni
//! IMDb/TMDB id: se busca el título en español por RSS (`/?s=TEXTO&feed=rss2`, búsqueda difusa →
//! se filtra por título normalizado) y cada ficha (una por versión) se lee por HTML: `Idioma:`,
//! `Calidad:`, `Tamaño:` y dos enlaces `acortame-esto.com/s.php?i=X`. Al acortador NO se entra:
//! `X` se decodifica en local (base64 ×5 y ROT13); el 1º da la ruta del .torrent y el 2º un magnet.
//! Solo películas: las series vienen como una ficha por episodio ("1×01"), sin idioma ni calidad
//! (probado con "Ultimo aviso"), así que no se puede mapear S/E de forma fiable.
//! Año: la ficha no trae el de estreno (`Fecha:` es la de subida), así que solo se descartan las
//! fichas subidas antes del estreno. Si el HTML, la ofuscación o Cloudflare cambian, la fuente
//! queda en error (no se evade nada).

use std::time::Duration;

use base64::alphabet::STANDARD;
use base64::engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig};
use base64::Engine;
use tokio::task::JoinSet;

use super::addons::AddonOutcome;
use super::http::Http;
use super::normalize::{self, ParseCtx, Parsed, StreamCandidate};
use super::protocol::Stream;
use super::{cinemeta, tmdb, MediaKind, VideoId};
use crate::magnet::Magnet;

const BASE: &str = "https://www.elitetorrent.com";
/// Fichas que se leen por película (una GET c/u; el cliente HTTP ya limita 2 por host).
const MAX_FICHAS: usize = 12;
const MAX_ENCODED: usize = 20_000;

/// Decodifica el parámetro `i` del acortador: base64 cinco veces y ROT13.
fn decode_link(x: &str) -> Option<String> {
    if x.is_empty() || x.len() > MAX_ENCODED {
        return None;
    }
    let engine = GeneralPurpose::new(
        &STANDARD,
        GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent),
    );
    let mut cur = x.as_bytes().to_vec();
    for _ in 0..5 {
        cur = engine.decode(&cur).ok()?;
    }
    let text = String::from_utf8(cur).ok()?;
    Some(
        text.chars()
            .map(|c| match c {
                'a'..='z' => (((c as u8 - b'a') + 13) % 26 + b'a') as char,
                'A'..='Z' => (((c as u8 - b'A') + 13) % 26 + b'A') as char,
                _ => c,
            })
            .collect(),
    )
}

/// Texto entre `start` y `end` (primera aparición), sin incluirlos.
fn between<'a>(s: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let from = s.find(start)? + start.len();
    let len = s[from..].find(end)?;
    Some(&s[from..from + len])
}

/// Entidades HTML/XML que aparecen en títulos del RSS.
fn unescape(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let end = rest.find(';').filter(|e| *e <= 8);
        let ch = end.and_then(|e| match &rest[1..e] {
            "amp" => Some('&'),
            "quot" => Some('"'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "apos" => Some('\''),
            n => n
                .strip_prefix('#')
                .and_then(|d| match d.strip_prefix(['x', 'X']) {
                    Some(h) => u32::from_str_radix(h, 16).ok(),
                    None => d.parse().ok(),
                })
                .and_then(char::from_u32),
        });
        match (ch, end) {
            (Some(c), Some(e)) => {
                out.push(c);
                rest = &rest[e + 1..];
            }
            _ => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

struct RssItem {
    title: String,
    url: String,
}

/// Fichas de películas del RSS de búsqueda. Solo enlaces del propio sitio.
fn parse_rss(xml: &str) -> Vec<RssItem> {
    xml.split("<item>")
        .skip(1)
        .filter_map(|item| {
            let title = unescape(between(item, "<title>", "</title>")?.trim());
            let url = between(item, "<link>", "</link>")?.trim().to_string();
            url.starts_with(&format!("{BASE}/peliculas/"))
                .then_some(RssItem { title, url })
        })
        .collect()
}

/// Título comparable: sin lo que va entre () o [] (versión: "(DVDRip)", "[CAM] [Spanish Latino]"),
/// sin acentos ni signos.
fn norm_title(s: &str) -> String {
    let mut depth = 0u32;
    let mut out = String::new();
    for c in s.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = depth.saturating_sub(1),
            _ if depth > 0 => {}
            'á' | 'à' | 'ä' | 'Á' => out.push('a'),
            'é' | 'è' | 'ë' | 'É' => out.push('e'),
            'í' | 'ì' | 'ï' | 'Í' => out.push('i'),
            'ó' | 'ò' | 'ö' | 'Ó' => out.push('o'),
            'ú' | 'ù' | 'ü' | 'Ú' => out.push('u'),
            'ñ' | 'Ñ' => out.push('n'),
            c if c.is_alphanumeric() => out.extend(c.to_lowercase()),
            _ => out.push(' '),
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Datos de una ficha de película.
#[derive(Debug, PartialEq)]
struct Ficha {
    /// `Español Latino`, `Español Castellano`, `VOSE`…
    language: String,
    quality: String,
    size: String,
    /// Año de subida (`Fecha: dd-mm-aaaa`).
    uploaded_year: Option<u32>,
    magnet: String,
}

/// Valor de un campo `<span><b>Nombre:</b> valor</span>`.
fn field(html: &str, name: &str) -> String {
    between(html, &format!("<b>{name}:</b>"), "</span>")
        .map(|v| unescape(v.trim()))
        .unwrap_or_default()
}

fn parse_ficha(html: &str) -> Option<Ficha> {
    // El 2º enlace del acortador es el magnet; se busca entre todos el que lo sea.
    let magnet = html
        .split("acortame-esto.com/s.php?i=")
        .skip(1)
        .filter_map(|part| {
            let x = part.split(['&', '"', '\'']).next()?;
            decode_link(x)
        })
        .find(|d| d.starts_with("magnet:?"))?;
    Some(Ficha {
        language: field(html, "Idioma"),
        quality: field(html, "Calidad"),
        size: field(html, "Tamaño"),
        uploaded_year: field(html, "Fecha")
            .rsplit('-')
            .next()
            .and_then(|y| y.trim().parse().ok()),
        magnet,
    })
}

/// Idioma de la ficha → la palabra que entiende `normalize::parse`. VOSE (subtitulado) no lleva
/// ninguna palabra de audio en español: no es audio en español.
fn language_word(language: &str) -> &'static str {
    let l = language.to_lowercase();
    if l.contains("latino") {
        "Latino"
    } else if l.contains("castellano") {
        "Castellano"
    } else if l.trim().is_empty() {
        ""
    } else {
        "VOSE"
    }
}

fn candidate(ficha: &Ficha, rss_title: &str, name: &str, rank: usize) -> Option<StreamCandidate> {
    let magnet = Magnet::parse(&ficha.magnet).ok()?;
    let ctx = ParseCtx {
        addon_name: name,
        addon_rank: rank,
        spain_flag_is_generic: false,
        is_series: false,
    };
    let quality = ficha.quality.trim_matches('-');
    // "1.31 GBs" → "1.31 GB" para el parser de tamaños.
    let size = match ficha.size.strip_suffix('s') {
        Some(s) if !s.is_empty() => s,
        _ => ficha.size.as_str(),
    };
    // Fichas viejas traen "desc." en vez de un tamaño.
    let size = if !size.starts_with(|c: char| c.is_ascii_digit()) {
        String::new()
    } else {
        format!("\n💾 {size}")
    };
    let release = magnet
        .display_name
        .clone()
        .unwrap_or_else(|| rss_title.to_string());
    let stream = Stream {
        info_hash: Some(magnet.info_hash.to_hex()),
        title: Some(format!(
            "{release}\n{rss_title} {quality} {}{size}",
            language_word(&ficha.language)
        )),
        sources: Some(
            magnet
                .trackers
                .iter()
                .map(|t| format!("tracker:{t}"))
                .collect(),
        ),
        ..Stream::default()
    };
    match normalize::parse(&stream, &ctx) {
        Parsed::Candidate(c) => Some(*c),
        _ => None,
    }
}

/// Títulos a buscar (TMDB en español; si no hay, Cinemeta) y año de estreno.
async fn wanted(
    http: &Http,
    imdb_id: &str,
    timeout: Duration,
) -> Option<(Vec<String>, Option<u32>)> {
    let local = tmdb::localized(http, imdb_id, timeout).await;
    let meta = cinemeta::meta(http, MediaKind::Movie, imdb_id, timeout)
        .await
        .ok();
    let mut titles: Vec<String> = Vec::new();
    for t in [
        local.as_ref().and_then(|l| l.title.clone()),
        meta.as_ref().map(|m| m.name.clone()),
    ]
    .into_iter()
    .flatten()
    {
        if !titles.iter().any(|x| norm_title(x) == norm_title(&t)) {
            titles.push(t);
        }
    }
    if titles.is_empty() {
        return None;
    }
    let year = local
        .and_then(|l| l.year)
        .or_else(|| meta.and_then(|m| m.year))
        .and_then(|y| y.get(..4)?.parse().ok());
    Some((titles, year))
}

/// Consulta una película. Las series no están soportadas (ver cabecera).
pub async fn streams(
    http: &Http,
    video: &VideoId,
    kind: MediaKind,
    rank: usize,
    name: &str,
    timeout: Duration,
) -> AddonOutcome {
    if kind == MediaKind::Series {
        return AddonOutcome::Unsupported;
    }
    let deadline = tokio::time::Instant::now() + timeout;
    let left = || deadline.saturating_duration_since(tokio::time::Instant::now());
    let Some((titles, year)) = wanted(http, video.imdb_id(), left() / 4).await else {
        return AddonOutcome::Failed("no se pudo obtener el título".into());
    };
    let wanted_norm: Vec<String> = titles.iter().map(|t| norm_title(t)).collect();
    // Se busca por cada título hasta que el RSS traiga fichas que coincidan.
    let mut hits: Vec<RssItem> = Vec::new();
    for title in &titles {
        let query = reqwest::Url::parse_with_params("https://x/", [("s", title.as_str())])
            .map(|u| u.query().unwrap_or_default().to_string())
            .unwrap_or_default();
        let url = format!("{BASE}/?{query}&feed=rss2");
        let xml = match http.get_text(&url, left()).await {
            Ok(x) => x,
            Err(e) => return AddonOutcome::Failed(e.user_text()),
        };
        hits = parse_rss(&xml)
            .into_iter()
            .filter(|i| wanted_norm.contains(&norm_title(&i.title)))
            .take(MAX_FICHAS)
            .collect();
        if !hits.is_empty() {
            break;
        }
    }
    let budget = left();
    let mut tasks = JoinSet::new();
    for item in hits {
        let http = http.clone();
        tasks.spawn(async move {
            let html = http.get_text(&item.url, budget).await;
            (item.title, html)
        });
    }
    let (mut out, mut first_err) = (Vec::new(), None);
    while let Some(done) = tasks.join_next().await {
        let Ok((title, html)) = done else { continue };
        match html {
            Ok(html) => {
                let Some(ficha) = parse_ficha(&html) else {
                    continue;
                };
                // Subida antes del estreno = otra película con el mismo título.
                if let (Some(up), Some(y)) = (ficha.uploaded_year, year) {
                    if up < y {
                        continue;
                    }
                }
                out.extend(candidate(&ficha, &title, name, rank));
            }
            Err(e) => first_err = first_err.or(Some(e)),
        }
    }
    match (out.is_empty(), first_err) {
        (true, Some(e)) => AddonOutcome::Failed(e.user_text()),
        _ => AddonOutcome::Ok(out),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode(plain: &str) -> String {
        let rot: String = plain
            .chars()
            .map(|c| match c {
                'a'..='z' => (((c as u8 - b'a') + 13) % 26 + b'a') as char,
                'A'..='Z' => (((c as u8 - b'A') + 13) % 26 + b'A') as char,
                _ => c,
            })
            .collect();
        let mut cur = rot;
        for _ in 0..5 {
            cur = base64::engine::general_purpose::STANDARD.encode(cur);
        }
        cur
    }

    #[test]
    fn decodifica_base64_x5_y_rot13() {
        let plain = "magnet:?xt=urn:btih:11D28409E84E630AFA6F105F5746CC3B168CBE6B";
        assert_eq!(decode_link(&encode(plain)).as_deref(), Some(plain));
        assert!(decode_link("???").is_none());
    }

    #[test]
    fn rss_solo_peliculas_del_sitio() {
        let xml = r#"<channel><title>Resultados</title><link>https://www.elitetorrent.com</link>
        <item><title>La familia Addams 2: La Gran Escapada</title><link>https://www.elitetorrent.com/peliculas/la-familia-addams-2/</link></item>
        <item><title>La familia Addams</title><link>https://www.elitetorrent.com/peliculas/la-familia-addams-1080p-latino/</link></item>
        <item><title>Ultimo aviso &#8211; 1&#215;01</title><link>https://www.elitetorrent.com/series/ultimo-aviso-1x01-1/</link></item>
        <item><title>SuperAgente 86 [CAM] [Spanish Latino]</title><link>https://otro.com/peliculas/x/</link></item></channel>"#;
        let items = parse_rss(xml);
        assert_eq!(items.len(), 2);
        assert_eq!(norm_title(&items[1].title), "la familia addams");
        assert_eq!(
            norm_title("SuperAgente 86 [CAM] [Spanish Latino]"),
            "superagente 86"
        );
        assert_eq!(norm_title("Superagente 86 (DVDRip)"), "superagente 86");
        assert_eq!(
            unescape("Ultimo aviso &#8211; 1&#215;01"),
            "Ultimo aviso – 1×01"
        );
    }

    #[test]
    fn ficha_a_candidato_con_idioma() {
        let magnet = "magnet:?xt=urn:btih:11D28409E84E630AFA6F105F5746CC3B168CBE6B&amp;dn=La+Familia+Addams+%5B1080p%5D&amp;xl=1411203595&amp;tr=udp://tracker.opentrackr.org:1337/announce";
        let html = format!(
            r#"<span><b>Fecha:</b> 10-10-2019</span><br><span><b>Tamaño:</b> 1.31 GBs</span><br>
            <span><b>Idioma:</b> Español Latino</span><br><span><b>Formato:</b> MKV</span><br>
            <span><b>Calidad:</b> 1080p</span><br>
            <a href="https://acortame-esto.com/s.php?i={}&st=et">Descargar el .torrent</a>
            <a href="https://acortame-esto.com/s.php?i={}&st=mg">Magnet</a>"#,
            encode("/wp-content/uploads/files/x.torrent"),
            encode(magnet)
        );
        let ficha = parse_ficha(&html).unwrap();
        assert_eq!(ficha.language, "Español Latino");
        assert_eq!(ficha.uploaded_year, Some(2019));
        let c = candidate(&ficha, "La familia Addams", "EliteTorrent", 7).unwrap();
        assert_eq!(c.addons, ["EliteTorrent"]);
        assert_eq!(c.audio, ["lat"]);
        assert_eq!(c.resolution.as_deref(), Some("1080p"));
        assert_eq!(c.size_bytes, Some((1.31 * 1024.0 * 1024.0 * 1024.0) as u64));
        // Castellano y VOSE.
        let cast = Ficha {
            language: "Español Castellano".into(),
            ..ficha
        };
        assert_eq!(candidate(&cast, "x", "E", 7).unwrap().audio, ["cast"]);
        let vose = Ficha {
            language: "VOSE".into(),
            ..cast
        };
        assert!(candidate(&vose, "x", "E", 7).unwrap().audio.is_empty());
    }
}
