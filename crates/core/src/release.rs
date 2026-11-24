//! `release` — lo que dice el nombre de un release: título, año, temporada/episodio, fuente,
//! grupo (ADR-10 actualizado: parser propio en Rust, ver ADR-13). Puro, sin E/S.
//!
//! Única regla de "¿es un episodio?": [`season_episodes`] (`S01E02`, `s1e2`, `S01` pack de
//! temporada, `1x02`, `1x002`). La usan `ranking` (duración estimada), `library`, `catalog`,
//! `subtitles` y el analizador. Para cortar la extensión usa `engine::is_video` y
//! `subtitles::SUBTITLE_EXTENSIONS` (solo datos, sin E/S).

use crate::engine::is_video;
use crate::subtitles::SUBTITLE_EXTENSIONS;

/// Lo que dice el nombre del release. Campos desconocidos = `None`, nunca error (R-10).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ReleaseName {
    /// Último componente de la ruta, con extensión.
    pub file_name: String,
    pub title: Option<String>,
    pub year: Option<u16>,
    pub season: Option<u16>,
    pub episode: Option<u16>,
    pub source: Option<String>,
    pub release_group: Option<String>,
}

/// Parsea el nombre del release (título, año, SxxExx, fuente, grupo).
pub fn parse_release_name(name: &str) -> ReleaseName {
    let file = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let stem = strip_extension(file);

    // Grupo: lo que sigue al último '-' ("…x264-GRUPO"), si parece un grupo y no un marcador.
    let release_group = stem
        .rsplit_once('-')
        .map(|(_, g)| g.trim())
        .filter(|g| {
            !g.is_empty()
                && g.len() <= 20
                && g.chars().all(|c| c.is_ascii_alphanumeric())
                && !is_marker(g)
                && !g.chars().all(|c| c.is_ascii_digit())
        })
        .map(String::from);

    let tokens: Vec<&str> = stem
        .split(['.', '_', ' ', '[', ']', '(', ')', '{', '}'])
        .filter(|t| !t.is_empty())
        .collect();

    let mut out = ReleaseName {
        file_name: file.to_string(),
        release_group,
        ..Default::default()
    };
    let mut title_end: Option<usize> = None;
    for (i, token) in tokens.iter().enumerate() {
        let lower = token.to_ascii_lowercase();
        // "2001 A Space Odyssey": un año en la primera posición es parte del título.
        if i > 0 && out.year.is_none() {
            if let Some(y) = parse_year(&lower) {
                out.year = Some(y);
                title_end.get_or_insert(i);
                continue;
            }
        }
        if let Some((s, e)) = parse_season_episode(&lower) {
            if out.season.is_none() {
                out.season = Some(s);
                out.episode = e;
            }
            title_end.get_or_insert(i);
            continue;
        }
        if let Some(src) = source_with_group(&lower) {
            out.source.get_or_insert_with(|| src.to_string());
        }
        if i > 0 && is_marker(&lower) {
            title_end.get_or_insert(i);
        }
    }
    let end = title_end.unwrap_or(tokens.len());
    let title = tokens[..end]
        .join(" ")
        .trim_matches(|c: char| c == '-' || c.is_whitespace())
        .to_string();
    if !title.is_empty() {
        out.title = Some(title);
    }
    out
}

/// Temporada y episodio (`None` = pack de temporada) de cada marca que aparezca en un texto
/// libre (nombres, rutas, varios nombres juntos). Palabras separadas por cualquier cosa que no
/// sea letra o dígito, así `1920x1080` o `x264` no cuentan.
pub fn season_episodes(text: &str) -> impl Iterator<Item = (u16, Option<u16>)> + '_ {
    text.split(|c: char| !c.is_alphanumeric())
        .filter_map(|t| parse_season_episode(&t.to_ascii_lowercase()))
}

pub(crate) fn strip_extension(file: &str) -> &str {
    let subtitle = std::path::Path::new(file)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| SUBTITLE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()));
    match file.rsplit_once('.') {
        Some((stem, _)) if is_video(file) || subtitle => stem,
        _ => file,
    }
}

fn parse_year(token: &str) -> Option<u16> {
    (token.len() == 4 && token.bytes().all(|b| b.is_ascii_digit()))
        .then(|| token.parse::<u16>().ok())
        .flatten()
        .filter(|y| (1900..=2099).contains(y))
}

/// `s01e02`, `s01` (pack de temporada), `1x02`. Temporada de 1–2 dígitos, episodio de 1–3
/// (2–3 en la forma `NxM`: si no, títulos como "4x4 (2019)" pasan por episodios).
fn parse_season_episode(token: &str) -> Option<(u16, Option<u16>)> {
    let digits = |s: &str| -> Option<u16> {
        (!s.is_empty() && s.len() <= 3 && s.bytes().all(|b| b.is_ascii_digit()))
            .then(|| s.parse().ok())
            .flatten()
    };
    if let Some(rest) = token.strip_prefix('s') {
        let (season, episode) = match rest.split_once('e') {
            Some((s, e)) => (s, Some(e)),
            None => (rest, None),
        };
        let season = digits(season).filter(|_| season.len() <= 2)?;
        return match episode {
            Some(e) => Some((season, Some(digits(e)?))),
            None => Some((season, None)),
        };
    }
    let (s, e) = token.split_once('x')?;
    Some((
        digits(s).filter(|_| s.len() <= 2)?,
        Some(digits(e).filter(|_| e.len() >= 2)?),
    ))
}

/// Como [`source_of`], pero acepta el grupo pegado con `-` (`web-dl-ntb`, `bluray-x`): primero la palabra entera
/// (`web-dl` lleva guion propio) y, si no, sin el último `-GRUPO`. Misma regla en `packages/ui/src/sub-match.ts`.
fn source_with_group(token: &str) -> Option<&'static str> {
    source_of(token).or_else(|| source_of(token.rsplit_once('-')?.0))
}

/// Fuente del release (`WEB-DL`, `BluRay`, `CAM`…) por una palabra del nombre.
fn source_of(token: &str) -> Option<&'static str> {
    Some(match token {
        "web-dl" | "webdl" => "WEB-DL",
        "webrip" | "web-rip" => "WEBRip",
        "web" => "WEB",
        "bluray" | "blu-ray" | "bdrip" | "brrip" | "bdremux" => "BluRay",
        "hdtv" => "HDTV",
        "dvdrip" | "dvd" => "DVDRip",
        "hdrip" => "HDRip",
        "cam" | "hdcam" | "ts" | "telesync" => "CAM",
        _ => return None,
    })
}

fn is_marker(token: &str) -> bool {
    let t = token.to_ascii_lowercase();
    let t = t.split('-').next().unwrap_or(&t);
    if source_of(t).is_some() {
        return true;
    }
    let resolution =
        t.len() >= 4 && t.ends_with('p') && t[..t.len() - 1].bytes().all(|b| b.is_ascii_digit());
    resolution
        || matches!(
            t,
            "4k" | "uhd"
                | "x264"
                | "x265"
                | "h264"
                | "h265"
                | "hevc"
                | "avc"
                | "xvid"
                | "10bit"
                | "hdr"
                | "hdr10"
                | "dv"
                | "remux"
                | "proper"
                | "repack"
                | "extended"
                | "unrated"
                | "multi"
                | "dual"
                | "latino"
                | "castellano"
                | "aac"
                | "ac3"
                | "dts"
                | "ddp5"
                | "dd5"
                | "atmos"
                | "complete"
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_pelicula() {
        let v = parse_release_name("The.Martian.2015.1080p.WEB-DL.x264-NTb.mkv");
        assert_eq!(v.title.as_deref(), Some("The Martian"));
        assert_eq!(v.year, Some(2015));
        assert_eq!(v.source.as_deref(), Some("WEB-DL"));
        assert_eq!(v.release_group.as_deref(), Some("NTb"));
        assert_eq!(v.season, None);
    }

    #[test]
    fn release_serie_y_casos_raros() {
        let v = parse_release_name("Show.Name.S01E02.720p.HDTV.x264-GRP.mkv");
        assert_eq!(v.title.as_deref(), Some("Show Name"));
        assert_eq!((v.season, v.episode), (Some(1), Some(2)));
        assert_eq!(v.source.as_deref(), Some("HDTV"));

        let v = parse_release_name("Sintel/Sintel.mp4");
        assert_eq!(v.title.as_deref(), Some("Sintel"));
        assert_eq!(v.file_name, "Sintel.mp4");
        assert_eq!(v.year, None);

        let v = parse_release_name("2001 A Space Odyssey (1968) [1080p].mkv");
        assert_eq!(v.title.as_deref(), Some("2001 A Space Odyssey"));
        assert_eq!(v.year, Some(1968));

        let v = parse_release_name("Spider-Man.No.Way.Home.2021.2160p.BluRay.mkv");
        assert_eq!(v.title.as_deref(), Some("Spider-Man No Way Home"));
        assert_eq!(v.release_group, None);
    }

    #[test]
    fn release_pack_multi_ruta_y_sin_datos() {
        // Pack completo: la temporada sin episodio corta el título.
        let v = parse_release_name("Show.Name.S01.COMPLETE.1080p.BluRay.x264-GRP");
        assert_eq!(v.title.as_deref(), Some("Show Name"));
        assert_eq!((v.season, v.episode), (Some(1), None));
        assert_eq!(v.release_group.as_deref(), Some("GRP"));

        // MULTi es marcador: no entra al título.
        let v = parse_release_name("Peli.Rara.2020.MULTi.1080p.WEB-DL.x264-GRP.mkv");
        assert_eq!(v.title.as_deref(), Some("Peli Rara"));
        assert_eq!(v.year, Some(2020));

        // Ruta con `\` (Windows): solo cuenta el último componente.
        let v = parse_release_name("Pack\\Temporada 1\\Show.S01E03.720p.mkv");
        assert_eq!(v.file_name, "Show.S01E03.720p.mkv");
        assert_eq!((v.season, v.episode), (Some(1), Some(3)));

        // Sin año ni grupo: título entero, resto en None.
        let v = parse_release_name("Mi Pelicula Casera.mp4");
        assert_eq!(v.title.as_deref(), Some("Mi Pelicula Casera"));
        assert_eq!((v.year, v.source, v.release_group), (None, None, None));
    }

    /// Las marcas que antes reconocían `ranking::content_kind` y el parser de subtítulos.
    /// Donde no coincidían gana este parser: `S01` (pack) y `1x002`/`4x4` también son episodios.
    #[test]
    fn marcas_de_temporada_y_episodio() {
        let se = |t| season_episodes(t).collect::<Vec<_>>();
        assert_eq!(se("Serie.S01E02.1080p.WEB-DL.mkv"), [(1, Some(2))]);
        assert_eq!(se("serie s1e2 720p"), [(1, Some(2))]);
        assert_eq!(se("Show 1x02 HDTV"), [(1, Some(2))]);
        assert_eq!(se("Breaking_Bad_1x01_Pilot.mkv"), [(1, Some(1))]);
        assert_eq!(se("Show-S01E02-GRP"), [(1, Some(2))]);
        assert_eq!(se("Show S01 1080p"), [(1, None)]);
        assert_eq!(se("Show 1x002"), [(1, Some(2))]);
        assert_eq!(se("Pack S01 / Show.S01E03.mkv"), [(1, None), (1, Some(3))]);
        for movie in [
            "Sintel",
            "Pelicula.2019.2160p.UHD.BluRay.x265",
            "Movie 1920x1080",
            "Masters 2x Edition",
            "4x4 (2019)",
            "Spaceballs.1987",
            "Seven.Samurai.1954",
            "Show.S01E02E03",
            "Show.S001E02",
            "Show.S01E1080",
        ] {
            assert_eq!(se(movie), [], "{movie}");
        }
    }
}
