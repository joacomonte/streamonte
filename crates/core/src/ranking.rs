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

/// Veredicto completo de una fila: la UI arma sus textos y tooltips SOLO con esto (no recalcula
/// el margen ni el semáforo).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct RankScore {
    pub duration: Option<DurationInfo>,
    pub needed_bps: Option<f64>,
    /// Velocidad medida × calibración: la que se compara contra `needed_bps`.
    pub effective_speed_bps: Option<f64>,
    /// Calibración aplicada (1,0 = sin datos).
    pub speed_factor: f64,
    /// `effective_speed_bps ÷ needed_bps`.
    pub margin: Option<f64>,
    pub light: Light,
    /// Daría rojo, pero la duración es estimada: queda amarillo.
    pub capped_by_estimate: bool,
    /// Umbrales con que se decidió `light` (config del usuario), para explicarlo.
    pub green_margin: f64,
    pub yellow_margin: f64,
}

/// Clave de orden por defecto (FR-07), ascendente y comparable fila por fila: la UI reordena con
/// ella sin pedir la lista entera. `[sin margen, -margen, -seeders, -leechers]`; un dato que
/// falta va al final (1 > cualquier -n).
pub type SortKey = [f64; 4];

pub fn sort_key(input: &RankInput, score: &RankScore) -> SortKey {
    let desc = |v: Option<f64>| v.map_or(1.0, |v| -v);
    [
        if score.margin.is_some() { 0.0 } else { 1.0 },
        score.margin.map_or(0.0, |m| -m),
        desc(input.seeders.map(f64::from)),
        desc(input.leechers.map(f64::from)),
    ]
}

/// Compara dos [`SortKey`] (la UI hace lo mismo, componente por componente).
pub fn cmp_sort_keys(a: &SortKey, b: &SortKey) -> std::cmp::Ordering {
    a.iter()
        .zip(b)
        .map(|(x, y)| x.partial_cmp(y).unwrap_or(std::cmp::Ordering::Equal))
        .find(|o| o.is_ne())
        .unwrap_or(std::cmp::Ordering::Equal)
}

/// Episodio si el nombre tiene una marca de temporada/episodio
/// ([`crate::release::season_episodes`]: `S01E02`, `s1e2`, `1x02`, o `S01` de un pack de
/// temporada, cuyos archivos son episodios) o la palabra episode/episodio/capítulo; si no,
/// película.
pub fn content_kind(name: &str) -> ContentKind {
    let lower = name.to_lowercase();
    let is_episode_word = lower
        .split(|c: char| !c.is_alphanumeric())
        .any(|token| matches!(token, "episode" | "episodio" | "capitulo" | "capítulo"));
    if is_episode_word || crate::release::season_episodes(name).next().is_some() {
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
/// `speed_factor`: calibración automática (`playback::Calibration`; 1,0 = sin datos).
pub fn score(input: &RankInput, cfg: &RankingConfig, speed_factor: f64) -> RankScore {
    // Config o mediciones raras (duración 0 → necesita ∞, factor NaN…): sin dato antes que ∞/NaN.
    let usable = |x: f64| (x.is_finite() && x > 0.0).then_some(x);
    let duration = duration_or_estimate(input.real_duration_secs, &input.name, cfg);
    let needed = input
        .size_bytes
        .filter(|s| *s > 0)
        .and_then(|size| usable(needed_bps(size, duration)));
    // Calibración automática: la medición de ~20 s subestima (o sobreestima) la velocidad que
    // después se sostiene reproduciendo; el factor lo aprende `playback` de tus reproducciones.
    let factor = usable(speed_factor).unwrap_or(1.0);
    let effective = input.measured_speed_bps.map(|s| s * factor);
    let margin = match (effective, needed) {
        (Some(speed), Some(needed)) => Some(speed / needed).filter(|m| m.is_finite()),
        _ => None,
    };
    // Con duración ESTIMADA ("~") el "necesita" puede estar inflado (una peli de 2:40 tasada en
    // 2 h necesita un 33 % menos de lo calculado): no hay base para afirmar que se va a cortar.
    // Calibración pedida por el usuario (2026-11-13).
    let raw = light(margin, cfg);
    let capped_by_estimate = raw == Light::Red && duration.estimated;
    RankScore {
        duration: Some(duration),
        needed_bps: needed,
        effective_speed_bps: effective,
        speed_factor: factor,
        margin,
        light: if capped_by_estimate {
            Light::Yellow
        } else {
            raw
        },
        capped_by_estimate,
        green_margin: cfg.green_margin,
        yellow_margin: cfg.yellow_margin,
    }
}

/// Índices de `inputs` en el orden por defecto (estable, FR-07), con [`sort_key`]:
/// 1. medidos (con margen) primero, por margen descendente;
/// 2. después seeders descendente (sin dato al final);
/// 3. después leechers descendente.
pub fn default_order(inputs: &[RankInput], cfg: &RankingConfig, speed_factor: f64) -> Vec<usize> {
    let keys: Vec<SortKey> = inputs
        .iter()
        .map(|i| sort_key(i, &score(i, cfg, speed_factor)))
        .collect();
    let mut order: Vec<usize> = (0..inputs.len()).collect();
    order.sort_by(|&a, &b| cmp_sort_keys(&keys[a], &keys[b]));
    order
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_en_cero_no_da_infinito() {
        let cfg = RankingConfig {
            movie_minutes: 0,
            ..RankingConfig::default()
        };
        let s = score(
            &RankInput {
                name: "Sintel.2010".into(),
                size_bytes: Some(1_000),
                measured_speed_bps: Some(10.0),
                ..Default::default()
            },
            &cfg,
            f64::NAN,
        );
        assert_eq!(
            (s.needed_bps, s.margin, s.light),
            (None, None, Light::Unknown)
        );
    }

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
        let s = score(&input, &cfg, 1.0);
        assert!(s.duration.unwrap().estimated);
        assert!(s.margin.unwrap() < 1.0);
        assert_eq!(
            s.light,
            Light::Yellow,
            "sin duración real no se afirma 'se va a cortar'"
        );
        assert!(s.capped_by_estimate);
    }

    /// El margen (también el provisorio de una medición en curso) aplica la calibración y los
    /// umbrales de la config; la UI solo lo muestra.
    #[test]
    fn margen_con_calibracion_y_umbrales_de_la_config() {
        let cfg = RankingConfig {
            green_margin: 3.0,
            yellow_margin: 2.0,
            ..RankingConfig::default()
        };
        let input = RankInput {
            name: "x".into(),
            size_bytes: Some(1_000 * MB),
            real_duration_secs: Some(1_000.0), // necesita 1 MB/s
            measured_speed_bps: Some(2.0 * MB as f64),
            ..Default::default()
        };
        let s = score(&input, &cfg, 1.25);
        assert_eq!(s.effective_speed_bps, Some(2.5 * MB as f64));
        assert!((s.margin.unwrap() - 2.5).abs() < 1e-9);
        assert_eq!(s.light, Light::Yellow, "2,5× con verde desde 3×");
        assert!(!s.capped_by_estimate);
        assert_eq!((s.green_margin, s.yellow_margin), (3.0, 2.0));
    }

    #[test]
    fn clave_de_orden_por_margen_seeders_y_leechers() {
        let cfg = RankingConfig::default();
        let key = |speed: Option<f64>, seeders: Option<u32>| {
            let i = RankInput {
                name: "x".into(),
                size_bytes: Some(1_000 * MB),
                real_duration_secs: Some(1_000.0),
                measured_speed_bps: speed,
                seeders,
                ..Default::default()
            };
            sort_key(&i, &score(&i, &cfg, 1.0))
        };
        use std::cmp::Ordering::Less;
        let fast = key(Some(3e6), None);
        let slow = key(Some(1e6), Some(99));
        let seeded = key(None, Some(5));
        let nothing = key(None, None);
        assert_eq!(cmp_sort_keys(&fast, &slow), Less);
        assert_eq!(cmp_sort_keys(&slow, &seeded), Less);
        assert_eq!(cmp_sort_keys(&seeded, &nothing), Less);
    }

    /// Las marcas SxxExx / 1x02 / packs se prueban en `release::tests`; acá solo lo propio de `content_kind`.
    #[test]
    fn detecta_episodios() {
        for name in [
            "Serie - Episodio 3",
            "Show Episode 10",
            "Serie Capítulo 4",
            "Serie capitulo 4",
            "Serie.S01E02.1080p.WEB-DL.mkv", // smoke: delega en `release`
        ] {
            assert_eq!(content_kind(name), ContentKind::Episode, "{name}");
        }
        assert_eq!(content_kind("Pelicula.2019.2160p.UHD"), ContentKind::Movie);
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
        let s = score(&with_speed(1.5), &cfg, 1.0);
        assert_eq!(s.needed_bps, Some(1_000_000.0));
        assert!((s.margin.unwrap() - 1.5).abs() < 1e-9);
        assert_eq!(s.light, Light::Green);
        assert_eq!(score(&with_speed(1.49), &cfg, 1.0).light, Light::Yellow);
        assert_eq!(score(&with_speed(1.0), &cfg, 1.0).light, Light::Yellow);
        assert_eq!(score(&with_speed(0.99), &cfg, 1.0).light, Light::Red);
        assert_eq!(score(&base, &cfg, 1.0).light, Light::Unknown);
        assert_eq!(score(&base, &cfg, 1.0).margin, None);
    }
}
