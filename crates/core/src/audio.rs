//! Idiomas de audio de un video (pedido del usuario, 2026-11-14: "latino e inglés me importan").
//!
//! Dos fuentes:
//! - **Pistas reales**: la fase rápida del análisis ya abre el video con mpv sin ventana para leer
//!   la duración; de paso lee `track-list` (idioma + título de cada pista de audio).
//! - **Nombre del torrent** ("Dual Latino", "ENG", "Castellano"…): sirve antes de analizar, pero
//!   es una pista sin confirmar. [`from_release`] es la única regla: la usan la biblioteca y el
//!   catálogo (que además le pasa las banderas emoji de los addons).
//!
//! Español se separa en Latino / Castellano cuando la etiqueta o el título lo dicen
//! (`es-419`, "Latino", "Castellano"…); si no, queda "Español" a secas. La variante por texto
//! libre ([`spanish_variant`]) la comparten las pistas de audio y los subtítulos.

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
    /// ¿Audio en español (latino, España o sin variante)?
    pub fn is_spanish(&self) -> bool {
        matches!(self.code.as_str(), "lat" | "cast" | "es")
    }

    /// Argumentos de mpv para este audio. Con audio en español los subtítulos arrancan ocultos (no hacen falta; S los
    /// muestra): la regla vive acá para que valga igual por torrent y por TorBox.
    pub fn mpv_args(&self) -> Vec<String> {
        let mut args = vec![self.track_arg()];
        if self.is_spanish() {
            args.push("--sub-visibility=no".into());
        }
        args
    }
    fn track_arg(&self) -> String {
        if let Some(aid) = self.aid {
            return format!("--aid={aid}");
        }
        let alang = match self.code.as_str() {
            "lat" => "es-419,es-MX,es-AR,lat,spa,es",
            "cast" => "es-ES,spa,es",
            "es" => "spa,es,es-419",
            "en" => "eng,en",
            other => other,
        };
        format!("--alang={alang}")
    }
}

/// Variante del español (Q-03: latino primero, después España, después sin variante).
/// Para otros idiomas siempre `Unknown`. Agregado en F6 (aditivo).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Serialize, Deserialize,
)]
#[serde(rename_all = "kebab-case")]
pub enum SpanishVariant {
    Latino,
    Spain,
    #[default]
    Unknown,
}

/// Variante del español por texto libre: título de una pista de audio, descripción o nombre de
/// un subtítulo, nombre del idioma ("Español (Latinoamérica)", `es-419`, "Castellano"…).
pub fn spanish_variant(text: &str) -> SpanishVariant {
    // Por palabra entera (alfanumérica): "Collation" o "Platinum" no son latino. Misma regla que
    // `packages/ui/src/latino.ts spanishVariant` (golden `spanish_variant.json`).
    let lower = text.to_lowercase();
    let words: Vec<&str> = lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect();
    let word = |ws: &[&str]| words.iter().any(|w| ws.contains(w));
    let prefix = |ps: &[&str]| words.iter().any(|w| ps.iter().any(|p| w.starts_with(p)));
    let pair = |a: &str, b: &str| words.windows(2).any(|w| w[0] == a && w[1] == b);
    // "Latin America", "Latin American", "Latin América"
    let latin_america = words
        .windows(2)
        .any(|w| w[0] == "latin" && (w[1].starts_with("america") || w[1].starts_with("américa")));
    let latino = word(&["lat", "latam", "latino", "419", "méxico"])
        || prefix(&["latinoam", "mex", "argentin"])
        || latin_america
        || pair("es", "mx")
        || pair("es", "ar");
    let spain = word(&[
        "castellano",
        "castilian",
        "españa",
        "espana",
        "spain",
        "europe",
        "european",
    ]) || pair("es", "es")
        || lower.contains("(eu)");
    if latino {
        SpanishVariant::Latino
    } else if spain {
        SpanishVariant::Spain
    } else {
        SpanishVariant::Unknown
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

/// ¿Pista en español (audio o subtítulo, por etiqueta de idioma y título)? Con su variante.
/// Misma regla que los idiomas de audio.
pub fn spanish_track(lang: Option<&str>, title: Option<&str>) -> Option<SpanishVariant> {
    let t = AudioTrack {
        lang: lang.map(str::to_string),
        title: title.map(str::to_string),
        codec: None,
        channels: None,
        default: false,
    };
    match classify_track(&t).0 {
        Kind::Latino => Some(SpanishVariant::Latino),
        Kind::Castellano => Some(SpanishVariant::Spain),
        Kind::Spanish => Some(SpanishVariant::Unknown),
        _ => None,
    }
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
    let variant = spanish_variant(&title);
    let spanish_lang = lang == "spa" || lang == "es" || lang == "esp" || lang.starts_with("es-");
    let spanish_title = variant != SpanishVariant::Unknown
        || contains_any(&title, &["español", "espanol", "spanish"]);

    if spanish_lang || spanish_title {
        let region = lang.strip_prefix("es-").unwrap_or("");
        let latino_region = !region.is_empty() && region != "es";
        if variant == SpanishVariant::Latino || latino_region {
            return (Kind::Latino, String::new());
        }
        if variant == SpanishVariant::Spain || region == "es" {
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

/// Idiomas de audio y de subtítulos que declara el nombre de un release (spec 10 §C.2), con los
/// códigos de [`AudioLang::code`] (`lat`, `en`, `cast`, `es`, `multi`, u otros como `it`).
/// Precedencia: palabra explícita > bandera emoji. `spain_flag_generic`: Torrentio/TorrentsDB
/// usan 🇪🇸 para "spanish" genérico; Peerflix/Comet para castellano (10 §C.2).
pub fn from_release(text: &str, spain_flag_generic: bool) -> (Vec<String>, Vec<String>) {
    let lower = text.to_lowercase();
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
    // Con "subs" también: "ENG SubS Spa" = audio en inglés con subtítulos en español.
    if has(&["eng", "english", "ingles", "inglés"]) {
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
    if has(&["multi", "multiaudio", "dual", "dubbed"]) {
        kinds.push(Kind::Multi);
    }
    kinds.sort();
    kinds.dedup();
    let mut audio: Vec<String> = kinds
        .into_iter()
        .map(|k| make(k, "", false, String::new()).code)
        .collect();
    for cc in flags(text) {
        let code = match cc.as_str() {
            "mx" | "ar" | "co" | "cl" | "pe" | "ve" | "uy" => "lat",
            "es" if spain_flag_generic => "es",
            "es" => "cast",
            "gb" | "us" => "en",
            "jp" => "ja",
            other => other,
        };
        if !audio.iter().any(|c| c == code) {
            audio.push(code.to_string());
        }
    }
    collapse_spanish(&mut audio);
    // "Audio Español (+Eng +Subs)": el español es del audio aunque diga "subs".
    let explicit_spanish_audio = [
        "audio español",
        "audio espanol",
        "audio spanish",
        "audio latino",
        "audio castellano",
    ]
    .iter()
    .any(|p| lower.contains(p));
    let mut subs = Vec::new();
    let subtitled = has(&[
        "sub",
        "subs",
        "subt",
        "subtitulado",
        "subtitulos",
        "subtítulos",
        "vose",
        "vos",
        "subbed",
    ]);
    // "SubS Spa" / "Español+English subt.": el español genérico es de subtítulos, no de audio.
    if subtitled
        && !explicit_spanish_audio
        && (audio.iter().any(|c| c == "es")
            || has(&["spa", "esp", "español", "espanol", "spanish"]))
    {
        audio.retain(|c| c != "es");
        subs.push("es".to_string());
    }
    (audio, subs)
}

/// "Español" genérico sobra si ya se sabe la variante (latino o castellano).
pub fn collapse_spanish(audio: &mut Vec<String>) {
    if audio.iter().any(|c| c == "lat" || c == "cast") {
        audio.retain(|c| c != "es");
    }
}

/// Códigos de país de las banderas emoji (pares de indicadores regionales), en minúsculas.
fn flags(text: &str) -> Vec<String> {
    let ri = |c: char| (0x1F1E6..=0x1F1FF).contains(&(c as u32));
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i + 1 < chars.len() {
        if ri(chars[i]) && ri(chars[i + 1]) {
            let letter = |c: char| char::from(b'a' + (c as u32 - 0x1F1E6) as u8);
            out.push(format!("{}{}", letter(chars[i]), letter(chars[i + 1])));
            i += 2;
        } else {
            i += 1;
        }
    }
    out
}

/// Lo que se muestra: las pistas reales si ya se leyeron; si no, lo que dice el nombre
/// (sin confirmar; las banderas 🇪🇸 se toman como español genérico). En orden de preferencia
/// (Latino, Inglés, Castellano, Español, Varios, otros): la UI lo muestra tal cual.
pub fn languages(tracks: Option<&[AudioTrack]>, name: &str) -> Vec<AudioLang> {
    match tracks {
        Some(t) if !t.is_empty() => from_tracks(t),
        _ => {
            let mut langs: Vec<(Kind, AudioLang)> = from_release(name, true)
                .0
                .iter()
                .map(|code| {
                    let kind = match code.as_str() {
                        "lat" => Kind::Latino,
                        "en" => Kind::English,
                        "cast" => Kind::Castellano,
                        "es" => Kind::Spanish,
                        "multi" => Kind::Multi,
                        _ => Kind::Other,
                    };
                    (kind, make(kind, code, false, String::new()))
                })
                .collect();
            // Las banderas se agregan al final: "🇲🇽 ENG" tiene que dar Latino antes que Inglés.
            langs.sort_by_key(|(kind, _)| *kind);
            langs.into_iter().map(|(_, l)| l).collect()
        }
    }
}

/// Una opción del selector de audio al reproducir (FR-09b), lista para mostrar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AudioOption {
    /// Va en [`AudioPick::code`].
    pub code: String,
    /// Nombre corto: "Latino", "Inglés", "Español"…
    pub label: String,
    /// Pista exacta (`--aid`) si se leyeron las pistas.
    pub aid: Option<u32>,
    pub confirmed: bool,
}

/// Qué ofrecer al reproducir, en orden (Latino e Inglés primero). "Varios audios" sin detalle →
/// se ofrecen Latino e Inglés igual (mpv elige por idioma). Pistas sin idioma no se ofrecen.
pub fn play_options(langs: &[AudioLang]) -> Vec<AudioOption> {
    let mut opts: Vec<AudioOption> = langs
        .iter()
        .filter(|l| l.code != "?" && l.code != "multi")
        .map(|l| AudioOption {
            code: l.code.clone(),
            label: if l.code == "es" {
                "Español".into()
            } else {
                l.label.clone()
            },
            aid: l.aids.first().copied(),
            confirmed: l.confirmed,
        })
        .collect();
    if langs.iter().any(|l| l.code == "multi") {
        for kind in [Kind::Latino, Kind::English] {
            let l = make(kind, "", false, String::new());
            if !opts.iter().any(|o| o.code == l.code) {
                opts.push(AudioOption {
                    code: l.code,
                    label: l.label,
                    aid: None,
                    confirmed: false,
                });
            }
        }
    }
    let rank = |code: &str| match code {
        "lat" => 0,
        "en" => 1,
        _ => 2,
    };
    opts.sort_by_key(|o| rank(&o.code));
    opts
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
        let l = languages(
            None,
            "Dune.Part.Two.2024.1080p.WEB-DL.Dual.Latino-Ingles.mkv",
        );
        // "Dual" = varios audios (antes solo el catálogo lo decía; ahora también la biblioteca).
        assert_eq!(codes(&l), ["lat", "en", "multi"]);
        assert!(l.iter().all(|x| !x.confirmed));
        assert_eq!(
            codes(&languages(None, "Oppenheimer 2023 [MULTI] 2160p")),
            ["multi"]
        );
        assert!(languages(None, "The.Bear.S03E01.1080p.WEB.h264-ETHEL").is_empty());
        // Antes la biblioteca descartaba el inglés por "subs" y el catálogo lo volvía a poner:
        // gana el catálogo (audio en inglés con subtítulos).
        assert_eq!(
            codes(&languages(None, "Película.Castellano.ENG.subs")),
            ["en", "cast"]
        );
    }

    /// T-22 (antes en `catalog::normalize`): misma regla para el catálogo y la biblioteca.
    #[test]
    fn idiomas_del_release_t22() {
        let l = |t: &str, generic| from_release(t, generic);
        assert_eq!(l("Peli 🇲🇽", true).0, vec!["lat"]);
        assert_eq!(l("Peli Castellano", true).0, vec!["cast"]);
        assert_eq!(l("Peli 🇪🇸", true).0, vec!["es"]);
        assert_eq!(l("Peli 🇪🇸", false).0, vec!["cast"]);
        assert_eq!(l("Peli Latino Español 🇪🇸", true).0, vec!["lat"]);
        assert_eq!(l("Peli Dual Audio", true).0, vec!["multi"]);
        let (audio, subs) = l("Peli.1080p.ENG SubS Spa", true);
        assert_eq!(audio, vec!["en"]);
        assert_eq!(subs, vec!["es"]);
        let (audio, subs) = l("Juego de Tronos S08E01 Audio Español (+Eng +Subs)", true);
        assert!(audio.contains(&"es".to_string()) && audio.contains(&"en".to_string()));
        assert!(subs.is_empty());
        // Sin idioma: vacío, no se descarta.
        assert!(l("Peli.2014.1080p.WEB", true).0.is_empty());
    }

    /// Palabras de títulos comunes que NO son idioma ("En busca de…", "Cast Away", "Spanish Harlem").
    #[test]
    fn titulos_comunes_no_dan_idioma() {
        for name in [
            "En busca de la felicidad 2006 1080p",
            "Cast Away 2000 1080p BluRay",
        ] {
            let (audio, subs) = from_release(name, true);
            assert!(
                audio.is_empty() && subs.is_empty(),
                "{name}: {audio:?} {subs:?}"
            );
        }
        // `Spain` en el título cuenta como castellano: la regla es por palabra, no por contexto.
        assert_eq!(from_release("Spain 2019 1080p", true).0, ["cast"]);
    }

    #[test]
    fn banderas_en_el_nombre() {
        let l = |t: &str| from_release(t, true).0;
        assert_eq!(
            l("Peli 🇦🇷 🇨🇱"),
            ["lat"],
            "varias banderas latinas = un solo lat"
        );
        assert_eq!(l("Peli 🇬🇧"), ["en"]);
        assert_eq!(l("Peli 🇺🇸 🇬🇧"), ["en"]);
        assert_eq!(l("Peli 🇯🇵"), ["ja"]);
        assert_eq!(l("Peli 🇫🇷"), ["fr"]);
        assert_eq!(
            l("Peli 🇲🇽 Latino"),
            ["lat"],
            "palabra y bandera no se duplican"
        );
        // Una bandera suelta (un solo indicador regional) no es país.
        assert!(l("Peli \u{1F1EA}").is_empty());
    }

    #[test]
    fn detalle_de_pista() {
        let t = |codec: Option<&str>, channels, title: Option<&str>, default| AudioTrack {
            lang: None,
            title: title.map(String::from),
            codec: codec.map(String::from),
            channels,
            default,
        };
        assert_eq!(track_detail(&t(None, None, None, false)), "");
        assert_eq!(
            track_detail(&t(Some("eac3"), Some(6), Some(" Latino "), true)),
            "EAC3, 5.1, «Latino», por defecto"
        );
        assert_eq!(
            track_detail(&t(Some("aac"), Some(2), None, false)),
            "AAC, estéreo"
        );
        assert_eq!(track_detail(&t(None, Some(1), None, false)), "mono");
        assert_eq!(track_detail(&t(None, Some(8), None, false)), "7.1");
        assert_eq!(
            track_detail(&t(None, Some(3), Some("  "), false)),
            "3 canales"
        );
    }

    #[test]
    fn colapsa_espanol_generico() {
        let mut a = vec!["es".to_string(), "lat".to_string(), "en".to_string()];
        collapse_spanish(&mut a);
        assert_eq!(a, ["lat", "en"]);
        let mut a = vec!["es".to_string(), "en".to_string()];
        collapse_spanish(&mut a);
        assert_eq!(a, ["es", "en"]);
    }

    /// Unión de las palabras que usaban las pistas de audio y los subtítulos (Q-03).
    #[test]
    fn variante_del_espanol() {
        use SpanishVariant::*;
        for t in [
            "Español Latino",
            "LAT",
            "[lat]",
            "es-419",
            "Spanish (Latin America)",
            "Español (Latinoamérica)",
            "México",
            "argentina",
            "es-MX",
            "latam",
        ] {
            assert_eq!(spanish_variant(t), Latino, "{t}");
        }
        for t in [
            "Castellano",
            "España",
            "espana",
            "Spanish (Spain)",
            "Castilian",
            "European Spanish",
            "es-ES",
            "Español (EU)",
        ] {
            assert_eq!(spanish_variant(t), Spain, "{t}");
        }
        for t in ["Español", "Spanish", "Platinum", "English"] {
            assert_eq!(spanish_variant(t), Unknown, "{t}");
        }
    }

    #[test]
    fn eleccion_de_audio_a_argumentos_de_mpv() {
        let exact = AudioPick {
            code: "lat".into(),
            aid: Some(2),
        };
        assert_eq!(exact.mpv_args(), ["--aid=2", "--sub-visibility=no"]);
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
        assert_eq!(
            codes(&languages(None, "Peli Dual Latino")),
            ["lat", "multi"]
        );
        assert_eq!(codes(&languages(Some(&[]), "Peli Latino")), ["lat"]);
    }

    fn option_codes(langs: &[AudioLang]) -> Vec<(String, String)> {
        play_options(langs)
            .into_iter()
            .map(|o| (o.code, o.label))
            .collect()
    }

    #[test]
    fn opciones_de_audio_al_reproducir() {
        let pair = |c: &str, l: &str| (c.to_string(), l.to_string());
        // MULTI sin detalle: Latino e Inglés igual, en ese orden.
        assert_eq!(
            option_codes(&languages(None, "Peli.2024.MULTI.1080p")),
            [pair("lat", "Latino"), pair("en", "Inglés")]
        );
        // MULTI + castellano: Latino e Inglés primero, después lo que dice el nombre.
        assert_eq!(
            option_codes(&languages(None, "Peli.2024.Castellano.MULTI.1080p")),
            [
                pair("lat", "Latino"),
                pair("en", "Inglés"),
                pair("cast", "Castellano")
            ]
        );
        // Bandera mexicana al final del nombre: Latino igual va primero.
        assert_eq!(
            option_codes(&languages(None, "Peli.2024.ENG.1080p 🇲🇽")),
            [pair("lat", "Latino"), pair("en", "Inglés")]
        );
        // Español sin región: etiqueta corta.
        assert_eq!(
            option_codes(&languages(None, "Peli.2024.Spanish.1080p")),
            [pair("es", "Español")]
        );
        // Pistas reales: la pista exacta viaja en `aid`.
        let langs = from_tracks(&[track(Some("eng"), None), track(Some("es-419"), None)]);
        let opts = play_options(&langs);
        assert_eq!((opts[0].code.as_str(), opts[0].aid), ("lat", Some(2)));
        assert_eq!((opts[1].code.as_str(), opts[1].aid), ("en", Some(1)));
        assert!(opts.iter().all(|o| o.confirmed));
    }
}
