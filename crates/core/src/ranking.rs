//! `ranking` — necesita / margen / semáforo / orden (FR-07). Funciones puras.
//!
//! - Necesita (bytes/s) = tamaño ÷ duración (real, o estimada y marcada con "~").
//! - Margen = velocidad medida ÷ necesita.
//! - Verde ≥ 1,5 · Amarillo ≥ 1 · Rojo < 1 (umbrales en `RankingConfig`).
//! - Orden por defecto: medidos (margen desc) → seeders desc → leechers desc.

use serde::Serialize;

use crate::config::RankingConfig;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ContentKind {
    Movie,
    /// Nombre con SxxExx / 1x02 / "Episode".
    Episode,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct DurationInfo {
    pub secs: f64,
    /// `true` → la UI muestra "~" (FR-07).
    pub estimated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Light {
    Green,
    Yellow,
    Red,
    /// Sin medición de velocidad.
    Unknown,
}

/// Datos mínimos para rankear (los arma `library` desde cada entrada).
#[derive(Debug, Clone, Default)]
pub struct RankInput {
    pub name: String,
    pub size_bytes: Option<u64>,
    pub real_duration_secs: Option<f64>,
    pub measured_speed_bps: Option<f64>,
    pub seeders: Option<u32>,
    pub leechers: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct RankScore {
    pub duration: Option<DurationInfo>,
    pub needed_bps: Option<f64>,
    pub margin: Option<f64>,
    pub light: Light,
}

/// Episodio si el nombre tiene `SxxExx` (`S01E02`, `s1e2`), `1x02` o la palabra
/// episode/episodio/capítulo; si no, película. Sin regex: el patrón es chico y así no
/// sumamos una dependencia (NFR-14).
pub fn content_kind(name: &str) -> ContentKind {
    let lower = name.to_lowercase();
    let b = lower.as_bytes();
    let digits_at = |i: usize| {
        b.get(i..).map_or(0, |rest| {
            rest.iter().take_while(|c| c.is_ascii_digit()).count()
        })
    };
    let boundary_before = |i: usize| i == 0 || !b[i - 1].is_ascii_alphanumeric();
    let boundary_at = |i: usize| i >= b.len() || !b[i].is_ascii_alphanumeric();
    for i in 0..b.len() {
        if !boundary_before(i) {
            continue;
        }
        // S01E02 / s1e2
        if b[i] == b's' {
            let n = digits_at(i + 1);
            if (1..=2).contains(&n) && b.get(i + 1 + n) == Some(&b'e') {
                let m = digits_at(i + 2 + n);
                if (1..=3).contains(&m) && boundary_at(i + 2 + n + m) {
                    return ContentKind::Episode;
                }
            }
        }
        // 1x02 (pero no 1920x1080: temporada de 1–2 dígitos y episodio de 2)
        if b[i].is_ascii_digit() {
            let n = digits_at(i);
            if n <= 2 && b.get(i + n) == Some(&b'x') {
                let m = digits_at(i + n + 1);
                if m == 2 && boundary_at(i + n + 1 + m) {
                    return ContentKind::Episode;
                }
            }
        }
    }
    let is_episode_word = lower
        .split(|c: char| !c.is_alphanumeric())
        .any(|token| matches!(token, "episode" | "episodio" | "capitulo" | "capítulo"));
    if is_episode_word {
        ContentKind::Episode
    } else {
        ContentKind::Movie
    }
}

pub fn duration_or_estimate(
    real_secs: Option<f64>,
    name: &str,
    cfg: &RankingConfig,
) -> DurationInfo {
    match real_secs {
        Some(secs) if secs > 0.0 => DurationInfo {
            secs,
            estimated: false,
        },
        _ => {
            let minutes = match content_kind(name) {
                ContentKind::Movie => cfg.movie_minutes,
                ContentKind::Episode => cfg.episode_minutes,
            };
            DurationInfo {
                secs: f64::from(minutes) * 60.0,
                estimated: true,
            }
        }
    }
}

pub fn needed_bps(size_bytes: u64, duration: DurationInfo) -> f64 {
    size_bytes as f64 / duration.secs
}

pub fn light(margin: Option<f64>, cfg: &RankingConfig) -> Light {
    match margin {
        None => Light::Unknown,
        Some(m) if m >= cfg.green_margin => Light::Green,
        Some(m) if m >= cfg.yellow_margin => Light::Yellow,
        Some(_) => Light::Red,
    }
}

/// Combina lo anterior. Sin tamaño no hay "necesita"; sin velocidad medida no hay margen
/// (semáforo `Unknown`). La duración siempre se informa (real, o estimada con "~").
pub fn score(input: &RankInput, cfg: &RankingConfig) -> RankScore {
    let duration = duration_or_estimate(input.real_duration_secs, &input.name, cfg);
    let needed = input
        .size_bytes
        .filter(|s| *s > 0)
        .map(|size| needed_bps(size, duration));
    // Calibración automática: la medición de ~20 s subestima (o sobreestima) la velocidad que
    // después se sostiene reproduciendo; el factor lo aprende `playback` de tus reproducciones.
    let factor = if cfg.speed_factor.is_finite() && cfg.speed_factor > 0.0 {
        cfg.speed_factor
    } else {
        1.0
    };
    let margin = match (input.measured_speed_bps.map(|s| s * factor), needed) {
        (Some(speed), Some(needed)) if needed > 0.0 => Some(speed / needed),
        _ => None,
    };
    // Con duración ESTIMADA ("~") el "necesita" puede estar inflado (una peli de 2:40 tasada en
    // 2 h necesita un 33 % menos de lo calculado): no hay base para afirmar que se va a cortar.
    // Calibración pedida por el usuario (2026-11-13).
    let light = match light(margin, cfg) {
        Light::Red if duration.estimated => Light::Yellow,
        l => l,
    };
    RankScore {
        duration: Some(duration),
        needed_bps: needed,
        margin,
        light,
    }
}

/// Índices de `inputs` en el orden por defecto (estable, FR-07):
/// 1. medidos (con margen) primero, por margen descendente;
/// 2. después seeders descendente (sin dato al final);
/// 3. después leechers descendente.
pub fn default_order(inputs: &[RankInput], cfg: &RankingConfig) -> Vec<usize> {
    use std::cmp::Ordering;
    let margins: Vec<Option<f64>> = inputs.iter().map(|i| score(i, cfg).margin).collect();
    let mut order: Vec<usize> = (0..inputs.len()).collect();
    // `Option` ordena `None < Some`: comparar b con a deja los `None` al final.
    order.sort_by(|&a, &b| {
        let by_margin = match (margins[a], margins[b]) {
            (Some(x), Some(y)) => y.partial_cmp(&x).unwrap_or(Ordering::Equal),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => Ordering::Equal,
        };
        by_margin
            .then_with(|| inputs[b].seeders.cmp(&inputs[a].seeders))
            .then_with(|| inputs[b].leechers.cmp(&inputs[a].leechers))
    });
    order
}

#[cfg(test)]
mod tests {
    use super::*;

    const MB: u64 = 1_000_000;

    #[test]
    fn duracion_estimada_nunca_da_rojo() {
        let cfg = RankingConfig::default();
        let input = RankInput {
            name: "Pelicula.2024.2160p".into(),
            size_bytes: Some(20_000 * MB),
            real_duration_secs: None,                  // estimada: 2 h
            measured_speed_bps: Some(1.0 * MB as f64), // muy por debajo de lo "necesario"
            ..Default::default()
        };
        let s = score(&input, &cfg);
        assert!(s.duration.unwrap().estimated);
        assert!(s.margin.unwrap() < 1.0);
        assert_eq!(
            s.light,
            Light::Yellow,
            "sin duración real no se afirma 'se va a cortar'"
        );
    }

    #[test]
    fn detecta_episodios() {
        for name in [
            "Serie.S01E02.1080p.WEB-DL.mkv",
            "serie s1e2 720p",
            "Show 1x02 HDTV",
            "Serie - Episodio 3",
            "Show Episode 10",
        ] {
            assert_eq!(content_kind(name), ContentKind::Episode, "{name}");
        }
        for name in [
            "Sintel",
            "Pelicula.2019.2160p.UHD.BluRay.x265",
            "Movie 1920x1080",
            "Masters 2x Edition",
            "Spaceballs.1987",
            "Seven.Samurai.1954",
        ] {
            assert_eq!(content_kind(name), ContentKind::Movie, "{name}");
        }
    }

    #[test]
    fn necesita_margen_y_semaforo() {
        let cfg = RankingConfig::default();
        // 1 000 MB en 1 000 s → necesita 1 MB/s.
        let base = RankInput {
            name: "x".into(),
            size_bytes: Some(1_000 * MB),
            real_duration_secs: Some(1_000.0),
            ..Default::default()
        };
        let with_speed = |mbps: f64| RankInput {
            measured_speed_bps: Some(mbps * MB as f64),
            ..base.clone()
        };
        let s = score(&with_speed(1.5), &cfg);
        assert_eq!(s.needed_bps, Some(1_000_000.0));
        assert!((s.margin.unwrap() - 1.5).abs() < 1e-9);
        assert_eq!(s.light, Light::Green);
        assert_eq!(score(&with_speed(1.49), &cfg).light, Light::Yellow);
        assert_eq!(score(&with_speed(1.0), &cfg).light, Light::Yellow);
        assert_eq!(score(&with_speed(0.99), &cfg).light, Light::Red);
        assert_eq!(score(&base, &cfg).light, Light::Unknown);
        assert_eq!(score(&base, &cfg).margin, None);
    }
}
