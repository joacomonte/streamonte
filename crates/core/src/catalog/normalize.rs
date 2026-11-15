//! Stream crudo → [`StreamCandidate`] (FR-43, FR-45, FR-40 streams, NFR-24).
//! Un solo parser tolerante que entiende los formatos conocidos (spec 10 §C.1: Torrentio/TorrentsDB
//! `👤 💾 ⚙️`, Peerflix `| 🌐`, Comet `📄 💾 🔎` + `videoSize`) y cae a lo genérico (nombre del
//! release) con cualquier otro addon: un addon nuevo funciona sin código nuevo (NFR-25).
//! Reutiliza el parser de releases ([`crate::release`]) y los idiomas de
//! [`crate::audio::from_release`].

use serde::Serialize;

use super::protocol::Stream;
use crate::magnet::InfoHash;

/// Stream normalizado y deduplicado (spec 09 §7.2), listo para analizar/reproducir.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct StreamCandidate {
    pub info_hash: InfoHash,
    pub file_idx: Option<usize>,
    pub file_name: Option<String>,
    pub release_name: String,
    pub size_bytes: Option<u64>,
    /// `true` si el tamaño viene de `videoSize` (exacto) y no del título.
    #[serde(skip)]
    pub size_exact: bool,
    /// 👤 de los addons (lo que dicen, sin verificar).
    pub seeders_declared: Option<u32>,
    /// Del scrape de trackers (FR-05): esto es lo que se muestra cuando llega.
    pub seeders: Option<u32>,
    pub leechers: Option<u32>,
    /// `2160p`, `1080p`, `720p`, `480p`.
    pub resolution: Option<String>,
    /// `HDR`, `DV`.
    pub hdr: Vec<String>,
    /// Formato de audio: `Atmos`, `TrueHD`, `DTS-HD`, `DTS`, `DD+`, `DD`, `AAC`, y canales `7.1`/`5.1`.
    pub audio_format: Vec<String>,
    pub codec: Option<String>,
    /// `REMUX`, `BluRay`, `WEB-DL`, `CAM`…
    pub source: Option<String>,
    /// Idiomas de audio con los códigos de `audio`: `lat`, `cast`, `es`, `en`, `multi`, u otros
    /// (`it`, `ru`…). Vacío = desconocido (no se descarta, FR-47).
    pub audio: Vec<String>,
    /// Subtítulos declarados: `es`, `en`.
    pub subs: Vec<String>,
    /// Grupo de idioma para la UI (lo pone `aggregate` según el orden configurado).
    pub lang_group: String,
    pub sites: Vec<String>,
    /// Nombres de los addons que lo trajeron (≥ 1).
    pub addons: Vec<String>,
    /// Posición del addon en la config (menor = más prioridad para los textos, FR-44).
    #[serde(skip)]
    pub addon_rank: usize,
    pub trackers: Vec<String>,
    pub binge_group: Option<String>,
    /// Temporada completa / varios episodios: el episodio sale de `file_idx` o del nombre (FR-49).
    pub is_pack: bool,
}

pub enum Parsed {
    Candidate(Box<StreamCandidate>),
    /// Aviso del tipo "configurá este addon" (FR-45).
    NeedsConfig,
    /// No-P2P, hash inválido, anime o solo japonés: se descarta.
    Skip,
}

pub struct ParseCtx<'a> {
    pub addon_name: &'a str,
    pub addon_rank: usize,
    /// Torrentio/TorrentsDB usan 🇪🇸 para "spanish" genérico; Peerflix/Comet para castellano (10 §C.2).
    pub spain_flag_is_generic: bool,
    pub is_series: bool,
}

/// Sitios de anime cuyos streams nunca se muestran (FR-40, spec 09 §7.3).
const ANIME_SITES: &[&str] = &[
    "nyaasi",
    "nyaa",
    "animetosho",
    "tokyotosho",
    "anidex",
    "horriblesubs",
    "nekobt",
    "seadex",
];
const MAX_TEXT: usize = 300;

pub fn parse(raw: &Stream, ctx: &ParseCtx) -> Parsed {
    let name = raw.name.as_deref().unwrap_or("");
    let body = raw
        .title
        .as_deref()
        .or(raw.description.as_deref())
        .unwrap_or("");
    let Some(hash) = raw.info_hash.as_deref() else {
        // FR-45: sin `infoHash` no es P2P. Los avisos "configure" se vuelven un estado del addon.
        let all = format!("{name} {body}").to_lowercase();
        return if all.contains("configur") || all.contains("install") {
            Parsed::NeedsConfig
        } else {
            Parsed::Skip
        };
    };
    // NFR-24: hash inválido → descartado.
    let Ok(info_hash) = InfoHash::parse(hash.trim()) else {
        return Parsed::Skip;
    };
    let hints = raw.behavior_hints.clone().unwrap_or_default();
    let lines: Vec<&str> = body
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();

    // Nombre del release: Comet `📄 …`; si no, la 1ª línea (Peerflix: antes del primer " | ").
    let release_name = lines
        .iter()
        .find_map(|l| l.strip_prefix("📄"))
        .or_else(|| lines.first().map(|l| l.split(" | ").next().unwrap_or(l)))
        .map(clean)
        .filter(|s| !s.is_empty())
        .or_else(|| hints.filename.as_deref().map(clean))
        .unwrap_or_else(|| clean(name));

    // Archivo dentro del pack: `filename`, o la 2ª línea de Torrentio si parece un archivo.
    let file_name = hints.filename.as_deref().map(clean).or_else(|| {
        lines
            .get(1)
            .filter(|l| !l.contains('👤') && crate::engine::is_video(l))
            .map(|l| clean(l))
    });

    let size_from_title = emoji_value(body, "💾").and_then(|v| parse_size(&v));
    let (size_bytes, size_exact) = match hints.video_size {
        Some(s) if s > 0 => (Some(s), true),
        _ => (size_from_title, false),
    };
    let seeders_declared = emoji_value(body, "👤").and_then(|v| {
        v.split_whitespace()
            .next()
            .and_then(|n| n.parse::<u32>().ok())
    });
    let sites: Vec<String> = ["⚙", "🌐", "🔎"]
        .iter()
        .filter_map(|e| emoji_value(body, e))
        .map(|s| clean(&s))
        .filter(|s| !s.is_empty())
        .collect();
    if sites
        .iter()
        .any(|s| ANIME_SITES.contains(&s.to_lowercase().replace([' ', '-', '.'], "").as_str()))
    {
        return Parsed::Skip;
    }

    let text = format!(
        "{name}\n{body}\n{}",
        hints.filename.as_deref().unwrap_or("")
    );
    let release = crate::release::parse_release_name(&release_name);
    let Tags {
        resolution,
        hdr,
        codec,
        audio_format,
        source,
    } = release_tags(&text, &release);
    let (audio, subs) = crate::audio::from_release(&text, ctx.spain_flag_is_generic);
    // FR-40: audio solo en japonés → fuera.
    if audio == ["ja"] {
        return Parsed::Skip;
    }
    let is_pack = ctx.is_series
        && release.episode.is_none()
        && (release.season.is_some()
            || tokens(&text)
                .iter()
                .any(|t| ["complete", "completa", "temporada", "season"].contains(&t.as_str())));
    let trackers = raw
        .sources
        .as_deref()
        .unwrap_or_default()
        .iter()
        .filter_map(|s| s.strip_prefix("tracker:"))
        .filter(|t| t.starts_with("udp://") || t.starts_with("http") || t.starts_with("wss://"))
        .take(50)
        .map(String::from)
        .collect();

    Parsed::Candidate(Box::new(StreamCandidate {
        info_hash,
        file_idx: raw.file_idx,
        file_name,
        release_name,
        size_bytes,
        size_exact,
        seeders_declared,
        seeders: None,
        leechers: None,
        resolution,
        hdr,
        audio_format,
        codec,
        source,
        audio,
        subs,
        lang_group: String::new(),
        sites,
        addons: vec![ctx.addon_name.to_string()],
        addon_rank: ctx.addon_rank,
        trackers,
        binge_group: hints.binge_group.as_deref().map(clean),
        is_pack,
    }))
}

/// Etiquetas de calidad de un release (pedido del usuario 2026-11-14: "si tiene HDR, Dolby…").
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Tags {
    /// `2160p`, `1440p`, `1080p`, `720p`, `480p`.
    pub resolution: Option<String>,
    /// `HDR`, `DV`.
    pub hdr: Vec<String>,
    /// `HEVC`, `H.264`, `AV1`.
    pub codec: Option<String>,
    /// Ver [`StreamCandidate::audio_format`].
    pub audio_format: Vec<String>,
    /// `CAM`, `REMUX`, o la fuente del nombre del release (`BluRay`, `WEB-DL`…).
    pub source: Option<String>,
}

/// Calidad por el texto libre del stream (nombre, título, archivo: `text`) y el nombre del
/// release ya parseado (de ahí sale la fuente si no es CAM ni REMUX). Lo usan [`parse`] y la
/// biblioteca (insignias de las filas).
pub fn release_tags(text: &str, release: &crate::release::ReleaseName) -> Tags {
    let tokens = tokens(text);
    let has = |words: &[&str]| tokens.iter().any(|t| words.contains(&t.as_str()));
    let resolution = if has(&["2160p", "4k", "uhd"]) {
        Some("2160p")
    } else if has(&["1440p"]) {
        Some("1440p")
    } else if has(&["1080p", "1080i"]) {
        Some("1080p")
    } else if has(&["720p"]) {
        Some("720p")
    } else if has(&["576p", "480p", "360p", "sd"]) {
        Some("480p")
    } else {
        None
    }
    .map(String::from);

    let lower = text.to_lowercase();
    let mut hdr = Vec::new();
    if has(&["hdr", "hdr10", "hdr10plus"]) || lower.contains("hdr10+") {
        hdr.push("HDR".to_string());
    }
    if has(&["dv", "dovi"]) || lower.contains("dolby vision") || lower.contains("dolbyvision") {
        hdr.push("DV".to_string());
    }
    let codec = if has(&["x265", "h265", "hevc"]) {
        Some("HEVC")
    } else if has(&["x264", "h264", "avc"]) {
        Some("H.264")
    } else if has(&["av1"]) {
        Some("AV1")
    } else {
        None
    }
    .map(String::from);
    let source = if is_cam(text) {
        Some("CAM".to_string())
    } else if has(&["remux"]) {
        Some("REMUX".to_string())
    } else {
        release.source.clone()
    };
    Tags {
        resolution,
        hdr,
        codec,
        audio_format: audio_format(&tokens, &lower),
        source,
    }
}

/// Formato de audio del release (pedido del usuario 2026-11-14: "si tiene HDR, Dolby…").
fn audio_format(tokens: &[String], lower: &str) -> Vec<String> {
    let has = |w: &str| tokens.iter().any(|t| t == w);
    let starts = |p: &str| tokens.iter().any(|t| t.starts_with(p));
    let mut out = Vec::new();
    let mut push = |cond: bool, name: &str| {
        if cond {
            out.push(name.to_string());
        }
    };
    push(has("atmos"), "Atmos");
    push(has("truehd"), "TrueHD");
    let dts_hd =
        has("dtshd") || has("dtsx") || (has("dts") && (has("hd") || has("ma") || has("x")));
    push(dts_hd, "DTS-HD");
    push(!dts_hd && has("dts"), "DTS");
    let ddp = starts("ddp") || has("eac3") || lower.contains("dd+");
    push(ddp, "DD+");
    push(
        !ddp && (has("ac3") || has("dd") || starts("dd5") || starts("dd2")),
        "DD",
    );
    push(has("aac") || starts("aac"), "AAC");
    if lower.contains("7.1") {
        out.push("7.1".into());
    } else if lower.contains("5.1") {
        out.push("5.1".into());
    }
    out
}

/// CAM/TS/screener. Por tramo (línea o `|`): sin la extensión del archivo (`movie.ts`) y, si hay
/// año, solo lo que viene después (el título puede ser "Cam (2018)").
fn is_cam(text: &str) -> bool {
    const CAM: &[&str] = &[
        "cam", "camrip", "hdcam", "ts", "hdts", "telesync", "tc", "telecine", "scr", "screener",
        "dvdscr",
    ];
    text.split(['\n', '|']).any(|part| {
        let part = part.trim();
        let part = match part.rsplit_once('.') {
            Some((stem, _)) if crate::engine::is_video(part) => stem,
            _ => part,
        };
        let t = tokens(part);
        let is_year =
            |t: &String| t.len() == 4 && t.parse::<u16>().is_ok_and(|y| (1900..=2099).contains(&y));
        let from = t.iter().position(is_year).map_or(0, |i| i + 1);
        t[from..].iter().any(|t| CAM.contains(&t.as_str()))
    })
}

fn tokens(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(String::from)
        .collect()
}

/// Texto que sigue a un emoji en la misma línea, hasta `|` o fin de línea.
fn emoji_value(text: &str, emoji: &str) -> Option<String> {
    let start = text.find(emoji)? + emoji.len();
    let rest = text[start..].trim_start_matches('\u{FE0F}');
    let end = rest.find(['\n', '|']).unwrap_or(rest.len());
    let v = rest[..end].trim();
    // Varios emojis en la misma línea (`👤 5 💾 1.15 GB ⚙️ X`): cortar en el siguiente.
    let v = v
        .split(|c: char| (c as u32) >= 0x1F300 || c == '⚙')
        .next()
        .unwrap_or("")
        .trim();
    (!v.is_empty()).then(|| v.to_string())
}

/// `1.15 GB` → bytes. Base 1024 (Torrentio: `GB` = GiB, spec 10 §C.1).
pub fn parse_size(text: &str) -> Option<u64> {
    let mut parts = text.split_whitespace();
    let number: f64 = parts.next()?.replace(',', ".").parse().ok()?;
    let unit = parts.next()?.to_ascii_uppercase();
    let mult = match unit.trim_end_matches("IB").trim_end_matches('B') {
        "" => 1.0,
        "K" => 1024.0,
        "M" => 1024.0 * 1024.0,
        "G" => 1024.0 * 1024.0 * 1024.0,
        "T" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    (number.is_finite() && number >= 0.0).then_some((number * mult) as u64)
}

/// NFR-24: sin caracteres de control, recortado. La UI igual lo pone como texto (nunca HTML).
pub fn clean(s: &str) -> String {
    let s: String = s
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_TEXT)
        .collect();
    s.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const HASH: &str = "08ada5a7a6183aae1e09d831df6748d566095a10";

    fn stream(json: serde_json::Value) -> Stream {
        serde_json::from_value(json).unwrap()
    }
    fn ctx(generic: bool, series: bool) -> ParseCtx<'static> {
        ParseCtx {
            addon_name: "Torrentio",
            addon_rank: 0,
            spain_flag_is_generic: generic,
            is_series: series,
        }
    }
    fn cand(p: Parsed) -> StreamCandidate {
        match p {
            Parsed::Candidate(c) => *c,
            _ => panic!("se esperaba candidato"),
        }
    }

    /// T-21/T-22: fixture del CA de FR-43 (formato Torrentio, spec 10 §C.1).
    #[test]
    fn torrentio_dual_latino() {
        let c = cand(parse(
            &stream(serde_json::json!({
                "name": "Torrentio\n1080p",
                "title": "Breaking.Bad.S01E01.2008.1080P-Dual-Lat\n👤 5 💾 1.15 GB ⚙️ Cinecalidad\nDual Audio / 🇲🇽",
                "infoHash": HASH, "fileIdx": 0,
                "sources": ["tracker:udp://tracker.opentrackr.org:1337/announce", "dht:x"],
                "behaviorHints": {"bingeGroup": "torrentio|1080p", "filename": "Breaking.Bad.S01E01.mkv"}
            })),
            &ctx(true, true),
        ));
        assert_eq!(c.resolution.as_deref(), Some("1080p"));
        assert_eq!(c.size_bytes, Some(1_234_803_097));
        assert!(!c.size_exact);
        assert_eq!(c.seeders_declared, Some(5));
        assert!(c.audio.contains(&"lat".to_string()) && c.audio.contains(&"multi".to_string()));
        assert_eq!(c.sites, vec!["Cinecalidad"]);
        assert_eq!(c.release_name, "Breaking.Bad.S01E01.2008.1080P-Dual-Lat");
        assert_eq!(
            c.trackers,
            vec!["udp://tracker.opentrackr.org:1337/announce"]
        );
        assert_eq!(c.file_idx, Some(0));
        assert!(!c.is_pack);
    }

    #[test]
    fn peerflix_castellano_sin_tamano() {
        let c = cand(parse(
            &stream(serde_json::json!({
                "name": "Peerflix 1080p",
                "title": "Pelicula.2014.1080p.WEB-DL | Pelicula.2014.mkv | 🇪🇸 |   👤 12 🌐 GranTorrent",
                "infoHash": HASH
            })),
            &ctx(false, false),
        ));
        assert_eq!(c.audio, vec!["cast"]);
        assert_eq!(c.size_bytes, None);
        assert_eq!(c.seeders_declared, Some(12));
        assert_eq!(c.sites, vec!["GranTorrent"]);
        assert_eq!(c.source.as_deref(), Some("WEB-DL"));
        assert_eq!(c.release_name, "Pelicula.2014.1080p.WEB-DL");
    }

    #[test]
    fn comet_videosize_exacto_sin_seeders() {
        let c = cand(parse(
            &stream(serde_json::json!({
                "name": "[TORRENT🧲] Comet 2160p",
                "description": "📄 Movie.2019.2160p.BluRay.REMUX.HDR.DV.HEVC-GRP\n📹 HEVC • HDR | 🔊 TrueHD • 7.1\n⭐ BluRay | 🏷️ GRP\n💾 50.2 GB 🔎 StremThru\n🇬🇧",
                "infoHash": HASH.to_uppercase(),
                "behaviorHints": {"videoSize": 53_901_000_000u64, "filename": "Movie.2019.mkv"}
            })),
            &ctx(false, false),
        ));
        assert_eq!(c.size_bytes, Some(53_901_000_000));
        assert!(c.size_exact);
        assert_eq!(c.seeders_declared, None);
        assert_eq!(c.resolution.as_deref(), Some("2160p"));
        assert_eq!(c.hdr, vec!["HDR", "DV"]);
        assert_eq!(c.audio_format, vec!["TrueHD", "7.1"]);
        assert_eq!(c.codec.as_deref(), Some("HEVC"));
        assert_eq!(c.source.as_deref(), Some("REMUX"));
        assert_eq!(c.audio, vec!["en"]);
        assert_eq!(
            c.release_name,
            "Movie.2019.2160p.BluRay.REMUX.HDR.DV.HEVC-GRP"
        );
        assert_eq!(c.info_hash.to_hex(), HASH);
    }

    /// T-26: filtro P2P y aviso de configuración.
    #[test]
    fn no_p2p_y_requiere_configuracion() {
        let url = stream(serde_json::json!({"name":"RD","url":"https://x/y.mkv","title":"Peli"}));
        assert!(matches!(parse(&url, &ctx(true, false)), Parsed::Skip));
        let cfg = stream(
            serde_json::json!({"name":"Jackettio","url":"https://x/configure","title":"Please configure this addon"}),
        );
        assert!(matches!(
            parse(&cfg, &ctx(true, false)),
            Parsed::NeedsConfig
        ));
        let yt = stream(serde_json::json!({"ytId":"abc"}));
        assert!(matches!(parse(&yt, &ctx(true, false)), Parsed::Skip));
    }

    /// T-30 / FR-40: hash inválido, anime y HTML hostil.
    #[test]
    fn datos_hostiles_y_anime() {
        let bad = stream(serde_json::json!({"infoHash":"zzz","title":"x"}));
        assert!(matches!(parse(&bad, &ctx(true, false)), Parsed::Skip));
        let nyaa =
            stream(serde_json::json!({"infoHash":HASH,"title":"Show 01\n👤 3 💾 1 GB ⚙️ NyaaSi"}));
        assert!(matches!(parse(&nyaa, &ctx(true, true)), Parsed::Skip));
        let ja = stream(serde_json::json!({"infoHash":HASH,"title":"Show 01 🇯🇵"}));
        assert!(matches!(parse(&ja, &ctx(true, true)), Parsed::Skip));
        let html = cand(parse(
            &stream(
                serde_json::json!({"infoHash":HASH,"title":"<script>alert(1)</script>\u{0007}"}),
            ),
            &ctx(true, false),
        ));
        assert_eq!(html.release_name, "<script>alert(1)</script>");
    }

    #[test]
    fn pack_de_temporada() {
        let c = cand(parse(
            &stream(serde_json::json!({"infoHash":HASH,"fileIdx":0,
                "title":"Breaking Bad Temporada 1 Completa 1080p\nBreaking_Bad_1x01_Pilot.mkv\n👤 9 💾 2 GB ⚙️ X"})),
            &ctx(true, true),
        ));
        assert!(c.is_pack);
        assert_eq!(c.file_name.as_deref(), Some("Breaking_Bad_1x01_Pilot.mkv"));
    }

    #[test]
    fn cam_solo_despues_del_ano_y_sin_extension() {
        assert!(!is_cam("Cam.2018.1080p.WEB"));
        assert!(!is_cam("movie.ts"));
        assert!(!is_cam("Movie.2023.1080p | Movie.2023.ts | 👤 3"));
        assert!(is_cam("Movie.2023.HDCAM"));
        assert!(is_cam("Movie 2023 TS"));
        assert!(is_cam("Torrentio\nCAM"));
    }

    #[test]
    fn tamanos() {
        assert_eq!(parse_size("1.15 GB"), Some(1_234_803_097));
        assert_eq!(parse_size("700 MB"), Some(734_003_200));
        assert_eq!(parse_size("x GB"), None);
    }
}
