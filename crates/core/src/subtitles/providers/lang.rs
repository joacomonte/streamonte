//! Idioma y variante del español (Q-03: latino / España) por el nombre de un archivo de
//! subtítulo. La variante sale de [`crate::audio::spanish_variant`] (regla única).

use super::words;
use crate::audio::{spanish_variant, SpanishVariant};
use crate::config::SubtitleLanguage;

/// Idioma (y variante) por el nombre de un archivo de subtítulo del torrent:
/// `Sintel.es.srt`, `2_Spanish.srt`, `peli.spa.lat.srt`, `x.es-419.srt`, `x.eng.srt`.
pub(crate) fn lang_from_name(name: &str) -> Option<(SubtitleLanguage, SpanishVariant)> {
    let file = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let w = words(file);
    let spanish = w.iter().any(|t| {
        matches!(
            t.as_str(),
            "es" | "spa" | "spanish" | "español" | "espanol" | "esp" | "castellano" | "latino"
        )
    });
    if spanish {
        let es_count = w.iter().filter(|t| *t == "es").count();
        let variant = match spanish_variant(file) {
            SpanishVariant::Unknown if es_count >= 2 => SpanishVariant::Spain, // "es-ES"
            v => v,
        };
        return Some((SubtitleLanguage::Es, variant));
    }
    let english = w
        .iter()
        .any(|t| matches!(t.as_str(), "en" | "eng" | "english"));
    english.then_some((SubtitleLanguage::En, SpanishVariant::Unknown))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idioma_por_nombre_de_archivo() {
        use SpanishVariant::*;
        let es = SubtitleLanguage::Es;
        assert_eq!(lang_from_name("Sintel/Sintel.es.srt"), Some((es, Unknown)));
        assert_eq!(lang_from_name("Subs/2_Spanish.srt"), Some((es, Unknown)));
        assert_eq!(lang_from_name("peli.spa.latino.srt"), Some((es, Latino)));
        assert_eq!(lang_from_name("peli.es-419.srt"), Some((es, Latino)));
        assert_eq!(lang_from_name("peli.es-ES.srt"), Some((es, Spain)));
        assert_eq!(lang_from_name("peli.castellano.srt"), Some((es, Spain)));
        assert_eq!(
            lang_from_name("Sintel/Sintel.en.srt"),
            Some((SubtitleLanguage::En, Unknown))
        );
        assert_eq!(lang_from_name("Sintel/Sintel.de.srt"), None);
    }
}
