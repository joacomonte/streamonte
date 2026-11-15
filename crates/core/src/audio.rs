//! Idiomas de audio de un video (pedido del usuario, 2026-11-14: "latino e inglés me importan").
//!
//! Dos fuentes:
//! - **Pistas reales**: la fase rápida del análisis ya abre el video con mpv sin ventana para leer
//!   la duración; de paso lee `track-list` (idioma + título de cada pista de audio).
//! - **Nombre del torrent** ("Dual Latino", "ENG", "Castellano"…): sirve antes de analizar, pero
//!   es una pista sin confirmar.
//!
//! Español se separa en Latino / Castellano cuando la etiqueta o el título lo dicen
//! (`es-419`, "Latino", "Castellano"…); si no, queda "Español" a secas.

use serde::{Deserialize, Serialize};

/// Una pista de audio tal como la informa mpv.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AudioTrack {
    pub lang: Option<String>,
    pub title: Option<String>,
    pub codec: Option<String>,
    pub channels: Option<u32>,
    #[serde(default)]
    pub default: bool,
}

/// Idioma para mostrar en la fila.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AudioLang {
    /// Código corto estable: `lat`, `cast`, `es`, `en`, `multi`, o el código de la pista (`fre`…).
    pub code: String,
    /// Texto corto para la insignia: "LAT", "EN"…
    pub short: String,
    /// Nombre completo: "Latino", "Inglés"…
    pub label: String,
    /// `true` = sale de las pistas reales; `false` = adivinado por el nombre.
    pub confirmed: bool,
    /// Detalle de la pista ("AC3 5.1, por defecto"); vacío si viene del nombre.
    pub detail: String,
    /// Número de pista de audio en mpv (`--aid`, desde 1) de cada pista de este idioma.
    /// Vacío si viene del nombre.
    pub aids: Vec<u32>,
}

/// Audio elegido por el usuario al reproducir (pedido 2026-11-14: "que me pregunte inglés o latino").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AudioPick {
    /// `lat`, `en`, `cast`, `es`… (el `code` de [`AudioLang`]).
    pub code: String,
    /// Pista exacta si se leyeron las pistas; si no, mpv elige por idioma.
    #[serde(default)]
    pub aid: Option<u32>,
}

impl AudioPick {
    /// ¿Audio en español? Entonces los subtítulos en español arrancan ocultos (S los muestra).
    pub fn is_spanish(&self) -> bool {
        matches!(self.code.as_str(), "lat" | "cast" | "es")
    }

    /// Argumentos de mpv para arrancar con ese audio.
    pub fn mpv_args(&self) -> Vec<String> {
        if let Some(aid) = self.aid {
            return vec![format!("--aid={aid}")];
        }
        let alang = match self.code.as_str() {
            "lat" => "es-419,es-MX,es-AR,lat,spa,es",
            "cast" => "es-ES,spa,es",
            "es" => "spa,es,es-419",
            "en" => "eng,en",
            other => other,
        };
        vec![format!("--alang={alang}")]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Kind {
    Latino,
    English,
    Castellano,
    Spanish,
    Multi,
    Other,
}

fn make(kind: Kind, other_code: &str, confirmed: bool, detail: String) -> AudioLang {
    let (code, short, label) = match kind {
        Kind::Latino => ("lat".into(), "LAT".into(), "Latino".into()),
        Kind::Castellano => ("cast".into(), "CAST".into(), "Castellano".into()),
        Kind::Spanish => (
            "es".into(),
            "ES".into(),
            "Español (sin saber si latino)".into(),
        ),
        Kind::English => ("en".into(), "EN".into(), "Inglés".into()),
        Kind::Multi => ("multi".into(), "MULTI".into(), "Varios audios".into()),
        Kind::Other => {
            let code = if other_code.is_empty() {
                "?".to_string()
            } else {
                other_code.to_lowercase()
            };
            let label = other_label(&code);
            let short = if code == "?" {
                "?".to_string()
            } else {
                code.chars().take(3).collect::<String>().to_uppercase()
            };
            (code, short, label)
        }
    };
    AudioLang {
        code,
        short,
        label,
        confirmed,
        detail,
        aids: Vec::new(),
    }
}

fn other_label(code: &str) -> String {
    match code {
        "fre" | "fra" | "fr" => "Francés",
        "por" | "pt" | "pt-br" => "Portugués",
        "ita" | "it" => "Italiano",
        "ger" | "deu" | "de" => "Alemán",
        "jpn" | "ja" => "Japonés",
        "kor" | "ko" => "Coreano",
        "rus" | "ru" => "Ruso",
        "chi" | "zho" | "zh" => "Chino",
        "hin" | "hi" => "Hindi",
        "?" => "Idioma sin etiqueta",
        other => return format!("Idioma «{other}»"),
    }
    .to_string()
}

fn contains_any(text: &str, words: &[&str]) -> bool {
    words.iter().any(|w| text.contains(w))
}

/// Clasifica una pista real por su etiqueta de idioma y su título.
fn classify_track(t: &AudioTrack) -> (Kind, String) {
    let lang = t
        .lang
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_lowercase()
        .replace('_', "-");
    let title = t.title.as_deref().unwrap_or("").to_lowercase();
    let latino_title = contains_any(
        &title,
        &[
            "latino",
            "latam",
            "latin america",
            "latinoam",
            "méxico",
            "mexico",
            "es-419",
            "(lat)",
            "[lat]",
            " lat ",
        ],
    ) || title == "lat"
        || title.starts_with("lat ")
        || title.ends_with(" lat");
    let cast_title = contains_any(
        &title,
        &[
            "castellano",
            "españa",
            "espana",
            "spain",
            "castilian",
            "european",
        ],
    );
    let spanish_lang = lang == "spa" || lang == "es" || lang == "esp" || lang.starts_with("es-");
    let spanish_title =
        latino_title || cast_title || contains_any(&title, &["español", "espanol", "spanish"]);

    if spanish_lang || spanish_title {
        let region = lang.strip_prefix("es-").unwrap_or("");
        let latino_region = !region.is_empty() && region != "es";
        if latino_title || latino_region {
            return (Kind::Latino, String::new());
        }
        if cast_title || region == "es" {
            return (Kind::Castellano, String::new());
        }
        return (Kind::Spanish, String::new());
    }
    if lang == "eng"
        || lang == "en"
        || lang.starts_with("en-")
        || contains_any(&title, &["english", "inglés", "ingles"])
    {
        return (Kind::English, String::new());
    }
    let code = if lang.is_empty() || lang == "und" {
        String::new()
    } else {
        lang
    };
    (Kind::Other, code)
}

fn track_detail(t: &AudioTrack) -> String {
    let mut parts = Vec::new();
    if let Some(c) = &t.codec {
        parts.push(c.to_uppercase());
    }
    if let Some(ch) = t.channels {
        parts.push(match ch {
            1 => "mono".to_string(),
            2 => "estéreo".to_string(),
            6 => "5.1".to_string(),
            8 => "7.1".to_string(),
            n => format!("{n} canales"),
        });
    }
    if let Some(title) = t.title.as_deref().filter(|s| !s.trim().is_empty()) {
        parts.push(format!("«{}»", title.trim()));
    }
    if t.default {
        parts.push("por defecto".to_string());
    }
    parts.join(", ")
}

/// Idiomas a partir de las pistas reales (sin repetir; Latino e Inglés primero).
pub fn from_tracks(tracks: &[AudioTrack]) -> Vec<AudioLang> {
    let mut found: Vec<(Kind, String, Vec<String>, Vec<u32>)> = Vec::new();
    for (i, t) in tracks.iter().enumerate() {
        let (kind, code) = classify_track(t);
        let detail = track_detail(t);
        // mpv numera las pistas de audio desde 1, en el orden de `track-list`.
        let aid = u32::try_from(i + 1).unwrap_or(u32::MAX);
        match found
            .iter_mut()
            .find(|(k, c, _, _)| *k == kind && *c == code)
        {
            Some((_, _, details, aids)) => {
                details.push(detail);
                aids.push(aid);
            }
            None => found.push((kind, code, vec![detail], vec![aid])),
        }
    }
    found.sort_by_key(|f| f.0);
    found
        .into_iter()
        .map(|(kind, code, details, aids)| {
            let detail = details
                .into_iter()
                .filter(|d| !d.is_empty())
                .collect::<Vec<_>>()
                .join(" · ");
            AudioLang {
                aids,
                ..make(kind, &code, true, detail)
            }
        })
        .collect()
}

/// Idiomas adivinados por el nombre del torrent / archivo (sin confirmar).
pub fn from_name(name: &str) -> Vec<AudioLang> {
    let lower = name.to_lowercase();
    let tokens: Vec<&str> = lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .collect();
    let has = |words: &[&str]| tokens.iter().any(|t| words.contains(t));
    let mut kinds = Vec::new();
    // Solo palabras que no aparecen en títulos comunes ("En busca de…", "Cast Away").
    if has(&["latino", "lat", "latam"]) || lower.contains("es-la") || lower.contains("es-419") {
        kinds.push(Kind::Latino);
    }
    if has(&["eng", "english", "ingles", "inglés"])
        && !has(&["subs", "sub", "subtitulado", "vose", "vos"])
    {
        kinds.push(Kind::English);
    }
    if has(&["castellano", "spain"]) {
        kinds.push(Kind::Castellano);
    }
    if !kinds
        .iter()
        .any(|k| matches!(k, Kind::Latino | Kind::Castellano))
        && has(&["spanish", "español", "espanol", "spa", "esp"])
    {
        kinds.push(Kind::Spanish);
    }
    if has(&["multi", "multiaudio"]) {
        kinds.push(Kind::Multi);
    }
    kinds.sort();
    kinds.dedup();
    kinds
        .into_iter()
        .map(|k| make(k, "", false, String::new()))
        .collect()
}

/// Lo que se muestra: las pistas reales si ya se leyeron; si no, lo que dice el nombre.
pub fn languages(tracks: Option<&[AudioTrack]>, name: &str) -> Vec<AudioLang> {
    match tracks {
        Some(t) if !t.is_empty() => from_tracks(t),
        _ => from_name(name),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(lang: Option<&str>, title: Option<&str>) -> AudioTrack {
        AudioTrack {
            lang: lang.map(str::to_string),
            title: title.map(str::to_string),
            codec: Some("ac3".into()),
            channels: Some(6),
            default: false,
        }
    }

    fn codes(v: &[AudioLang]) -> Vec<&str> {
        v.iter().map(|l| l.code.as_str()).collect()
    }

    #[test]
    fn pistas_separan_latino_castellano_e_ingles() {
        let langs = from_tracks(&[
            track(Some("eng"), None),
            track(Some("spa"), Some("Español Latino")),
            track(Some("spa"), Some("Castellano")),
            track(Some("es-419"), None),
            track(Some("fre"), None),
        ]);
        assert_eq!(codes(&langs), ["lat", "en", "cast", "fre"]);
        assert!(langs.iter().all(|l| l.confirmed));
        assert_eq!(langs[0].aids, [2, 4], "pistas 2 y 4 son latino");
        assert_eq!(langs[1].aids, [1]);
        assert!(langs[0].detail.contains("5.1"));
    }

    #[test]
    fn espanol_sin_region_queda_generico() {
        assert_eq!(codes(&from_tracks(&[track(Some("spa"), None)])), ["es"]);
        assert_eq!(codes(&from_tracks(&[track(None, Some("LAT"))])), ["lat"]);
        assert_eq!(codes(&from_tracks(&[track(Some("und"), None)])), ["?"]);
    }

    #[test]
    fn nombre_da_una_pista_sin_confirmar() {
        let l = from_name("Dune.Part.Two.2024.1080p.WEB-DL.Dual.Latino-Ingles.mkv");
        assert_eq!(codes(&l), ["lat", "en"]);
        assert!(l.iter().all(|x| !x.confirmed));
        assert_eq!(
            codes(&from_name("Oppenheimer 2023 [MULTI] 2160p")),
            ["multi"]
        );
        assert!(from_name("The.Bear.S03E01.1080p.WEB.h264-ETHEL").is_empty());
        assert!(from_name("Película.Castellano.ENG.subs")
            .iter()
            .all(|l| l.code != "en"));
    }

    #[test]
    fn eleccion_de_audio_a_argumentos_de_mpv() {
        let exact = AudioPick {
            code: "lat".into(),
            aid: Some(2),
        };
        assert_eq!(exact.mpv_args(), ["--aid=2"]);
        assert!(exact.is_spanish());
        let by_lang = AudioPick {
            code: "en".into(),
            aid: None,
        };
        assert_eq!(by_lang.mpv_args(), ["--alang=eng,en"]);
        assert!(!by_lang.is_spanish());
    }

    #[test]
    fn pistas_reales_mandan_sobre_el_nombre() {
        let tracks = [track(Some("eng"), None)];
        assert_eq!(codes(&languages(Some(&tracks), "Peli Dual Latino")), ["en"]);
        assert_eq!(codes(&languages(None, "Peli Dual Latino")), ["lat"]);
        assert_eq!(codes(&languages(Some(&[]), "Peli Latino")), ["lat"]);
    }
}
