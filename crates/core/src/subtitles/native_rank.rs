//! Orden de los subtítulos nativos (los que trae el video) para el idioma preferido del usuario, y cuál se recomienda.
//! Misma regla en la web: `packages/ui/src/subs/native-rank.ts` (golden `packages/golden/native_rank.json`).
//!
//! Criterios, en este orden: 1) los forzados al fondo; 2) idioma preferido (y su variante: la preferida, después
//! sin variante, después la otra); 3) completo antes que para sordos (SDH); 4) texto antes que imagen (PGS/VobSub);
//! 5) el marcado default; 6) el orden original de las pistas.

use super::NativeSub;
use crate::audio::{spanish_track, SpanishVariant};

/// `order`: índices de `subs` del mejor al peor. `recommended`: el primero no forzado del idioma preferido
/// (`None` si no hay idioma preferido o ningún sub es de ese idioma).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeRank {
    pub order: Vec<usize>,
    pub recommended: Option<usize>,
}

/// Palabras del nombre en minúscula, por palabra entera (igual que la regla de latino).
fn words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_string)
        .collect()
}

/// Para sordos: el flag de la pista o lo que dice el nombre.
fn is_sdh(sub: &NativeSub) -> bool {
    let w = words(sub.title.as_deref().unwrap_or(""));
    sub.sdh
        || w.iter()
            .any(|x| matches!(x.as_str(), "sdh" | "cc" | "hi" | "sordos" | "hearing"))
        || w.windows(2)
            .any(|p| p[0] == "closed" && p[1].starts_with("caption"))
}

/// Forzado: el flag de la pista o lo que dice el nombre.
fn is_forced(sub: &NativeSub) -> bool {
    sub.forced
        || words(sub.title.as_deref().unwrap_or(""))
            .iter()
            .any(|x| matches!(x.as_str(), "forced" | "forzados" | "signs" | "carteles"))
}

/// Subtítulo de imagen (PGS, VobSub…): no se puede restilar ni buscar texto.
fn is_image(sub: &NativeSub) -> bool {
    let codec = sub.codec.as_deref().unwrap_or("").to_lowercase();
    matches!(
        codec.as_str(),
        "hdmv_pgs_subtitle" | "pgs" | "dvd_subtitle" | "dvdsub" | "vobsub" | "dvb_subtitle"
    ) || codec.starts_with("s_hdmv")
        || codec.starts_with("s_vobsub")
}

/// Código de idioma de 2 letras (`spa`, `es-419`, `eng` → `es`, `es`, `en`).
fn lang_code(lang: &str) -> String {
    let lower = lang.trim().to_lowercase().replace('_', "-");
    let primary = lower.split('-').next().unwrap_or("");
    match primary {
        "spa" | "esp" => "es",
        "eng" => "en",
        "por" => "pt",
        "fra" | "fre" => "fr",
        "deu" | "ger" => "de",
        "ita" => "it",
        "jpn" => "ja",
        "zho" | "chi" => "zh",
        "rus" => "ru",
        "kor" => "ko",
        other => other,
    }
    .to_string()
}

/// 0 = idioma preferido con la variante preferida (o sin preferencia de variante), 1 = idioma preferido sin
/// variante, 2 = idioma preferido con la otra variante; `None` = otro idioma.
fn language_tier(sub: &NativeSub, lang: &str, variant: SpanishVariant) -> Option<u8> {
    if lang == "es" {
        let got = spanish_track(sub.lang.as_deref(), sub.title.as_deref())?;
        return Some(if variant == SpanishVariant::Unknown || got == variant {
            0
        } else if got == SpanishVariant::Unknown {
            1
        } else {
            2
        });
    }
    (lang_code(sub.lang.as_deref().unwrap_or("")) == lang).then_some(0)
}

/// Ordena `subs` para el idioma preferido `lang` (`es`, `en`, `spa`…; `None` = sin preferencia) y su `variant`
/// (solo cuenta en español; `Unknown` = sin preferencia de variante).
pub fn native_rank(subs: &[NativeSub], lang: Option<&str>, variant: SpanishVariant) -> NativeRank {
    let want = lang.map(lang_code).filter(|l| !l.is_empty());
    let tiers: Vec<Option<u8>> = subs
        .iter()
        .map(|s| want.as_deref().and_then(|l| language_tier(s, l, variant)))
        .collect();
    let mut order: Vec<usize> = (0..subs.len()).collect();
    order.sort_by_key(|&i| {
        let s = &subs[i];
        (
            is_forced(s),
            tiers[i].unwrap_or(3),
            is_sdh(s),
            is_image(s),
            !s.default,
            i,
        )
    });
    let recommended = order
        .iter()
        .copied()
        .find(|&i| tiers[i].is_some() && !is_forced(&subs[i]));
    NativeRank { order, recommended }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    #[test]
    fn golden_native_rank() {
        let cases: Vec<Value> =
            serde_json::from_str(include_str!("../../../../packages/golden/native_rank.json"))
                .unwrap();
        for case in cases {
            let input = &case["in"];
            let subs: Vec<NativeSub> = serde_json::from_value(input["subs"].clone()).unwrap();
            let variant = match input["variant"].as_str() {
                Some("latino") => SpanishVariant::Latino,
                Some("spain") => SpanishVariant::Spain,
                _ => SpanishVariant::Unknown,
            };
            let got = native_rank(&subs, input["lang"].as_str(), variant);
            let out = json!({ "order": got.order, "recommended": got.recommended });
            assert_eq!(out, case["out"], "{}", case["nota"]);
        }
    }

    #[test]
    fn nombre_marca_sordos_y_forzados() {
        let sub = |title: &str| NativeSub {
            sid: Some(1),
            file: None,
            lang: Some("spa".into()),
            title: Some(title.into()),
            codec: None,
            forced: false,
            sdh: false,
            default: false,
        };
        for t in [
            "Español SDH",
            "Spanish [CC]",
            "Para sordos",
            "Closed Captions",
            "HI",
        ] {
            assert!(is_sdh(&sub(t)), "{t}");
        }
        for t in ["Español", "Chicago", "Hindi"] {
            assert!(!is_sdh(&sub(t)), "{t}");
        }
        for t in ["Forzados", "Signs & Songs", "Carteles"] {
            assert!(is_forced(&sub(t)), "{t}");
        }
        assert!(!is_forced(&sub("Español")));
    }
}
