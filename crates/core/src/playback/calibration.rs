//! Calibración automática: mientras se mira (minutos 1–5) se mide la velocidad real sostenida y se
//! compara con la que predijo el análisis; la mediana de esas razones ajusta el semáforo.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::magnet::InfoHash;
use crate::paths::AppPaths;

use super::{Shared, Slot};

/// Ventana de calibración: desde el minuto 1 (peers ya conectados) hasta el 5.
const CALIBRATION_FROM: Duration = Duration::from_secs(60);
const CALIBRATION_TO: Duration = Duration::from_secs(300);
/// Mínimo de segundos válidos para que una reproducción cuente para la calibración.
const CALIBRATION_MIN_SAMPLES: usize = 20;
/// Cuántas reproducciones recientes se usan para el factor.
const CALIBRATION_KEEP: usize = 30;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CalibrationSample {
    info_hash: InfoHash,
    predicted_bps: f64,
    actual_bps: f64,
    at: DateTime<Utc>,
}

/// Mediana de real ÷ predicción, acotada a [0,5; 4] para que un caso raro no rompa todo.
fn calibration_factor(samples: &[CalibrationSample]) -> (f64, u32) {
    let mut ratios: Vec<f64> = samples
        .iter()
        .filter(|s| s.predicted_bps > 0.0 && s.actual_bps > 0.0)
        .map(|s| s.actual_bps / s.predicted_bps)
        .collect();
    if ratios.is_empty() {
        return (1.0, 0);
    }
    ratios.sort_by(|a, b| a.total_cmp(b));
    let n = ratios.len();
    let median = if n % 2 == 0 {
        (ratios[n / 2 - 1] + ratios[n / 2]) / 2.0
    } else {
        ratios[n / 2]
    };
    (median.clamp(0.5, 4.0), n as u32)
}

/// Velocidad real sostenida mientras se reproduce: bytes recibidos por segundo entre el minuto 1
/// y el 5, solo mientras quedaba algo por bajar y la descarga no estaba pausada.
#[derive(Default)]
pub(super) struct CalibrationSampler {
    prev: Option<(Instant, u64)>,
    rates: Vec<f64>,
}

impl CalibrationSampler {
    pub(super) fn push(
        &mut self,
        playing_for: Duration,
        stats: &crate::engine::Stats,
        download_paused: bool,
    ) {
        let now = Instant::now();
        let bytes = stats.received_bytes;
        if let Some((t, b)) = self.prev {
            let in_window = playing_for >= CALIBRATION_FROM && playing_for <= CALIBRATION_TO;
            if in_window && !download_paused && stats.progress < 0.98 && bytes > 0 {
                let dt = now.duration_since(t).as_secs_f64().max(0.001);
                self.rates.push(bytes.saturating_sub(b) as f64 / dt);
            }
        }
        self.prev = Some((now, bytes));
    }

    pub(super) fn sustained(&self) -> Option<f64> {
        if self.rates.len() < CALIBRATION_MIN_SAMPLES {
            return None;
        }
        let mut v = self.rates.clone();
        v.sort_by(|a, b| a.total_cmp(b));
        Some(v[v.len() / 2]).filter(|x| *x > 0.0)
    }
}

/// Dueña de `calibration.json`: las reproducciones que alimentan el factor del semáforo. Es dato
/// derivado, no config del usuario (`config.json` no lo guarda). Las muestras viven en memoria y
/// cada alta escribe el archivo bajo el mismo lock: dos reproducciones que terminan juntas no se
/// pisan.
pub struct Calibration {
    file: PathBuf,
    samples: Mutex<Vec<CalibrationSample>>,
}

impl Calibration {
    /// Carga `calibration.json` (inválido → vacío, como antes; la próxima muestra lo reescribe).
    /// Migración: sin muestras y con un `config.json` viejo que traía `ranking.speed_factor`
    /// aprendido, lo siembra una vez como una muestra (con el factor tal cual).
    pub fn load(paths: &AppPaths) -> Self {
        let file = paths.calibration_file();
        let mut samples: Vec<CalibrationSample> = match crate::fsutil::read_json(&file) {
            Ok(v) => v.unwrap_or_default(),
            Err(e) => {
                tracing::warn!("calibración: {e}; se empieza de cero");
                Vec::new()
            }
        };
        if samples.is_empty() {
            if let Some(seed) = legacy_seed(&paths.config_file()) {
                samples.push(seed);
                if let Err(e) = crate::fsutil::write_json_atomic(&file, &samples) {
                    tracing::warn!("calibración: no se pudo sembrar {file:?}: {e}");
                }
            }
        }
        Self {
            file,
            samples: Mutex::new(samples),
        }
    }

    /// Factor actual y cuántas reproducciones lo alimentan (1,0 y 0 = sin datos).
    pub fn factor(&self) -> (f64, u32) {
        calibration_factor(&self.samples.lock().expect("calibración"))
    }

    /// Agrega una reproducción, guarda y devuelve el factor nuevo. Si no se puede guardar, no
    /// cambia nada (memoria = disco).
    fn record(&self, sample: CalibrationSample) -> crate::Result<(f64, u32)> {
        let mut samples = self.samples.lock().expect("calibración");
        let mut next = samples.clone();
        next.push(sample);
        if next.len() > CALIBRATION_KEEP {
            next.drain(..next.len() - CALIBRATION_KEEP);
        }
        crate::fsutil::write_json_atomic(&self.file, &next)?;
        *samples = next;
        Ok(calibration_factor(&samples))
    }
}

/// `ranking.speed_factor` de un `config.json` de antes de `calibration.json`, como una muestra
/// sintética (predicción 1, real = factor). `None` si no había nada aprendido.
fn legacy_seed(config_file: &Path) -> Option<CalibrationSample> {
    let config: serde_json::Value = crate::fsutil::read_json(config_file).ok()??;
    let ranking = config.get("ranking")?;
    let factor = ranking.get("speed_factor")?.as_f64()?;
    let learned_from = ranking.get("speed_factor_samples")?.as_u64()?;
    (learned_from > 0 && factor.is_finite() && factor > 0.0).then(|| CalibrationSample {
        info_hash: InfoHash::from_bytes([0; 20]),
        predicted_bps: 1.0,
        actual_bps: factor,
        at: Utc::now(),
    })
}

impl Shared {
    /// Calibración automática: guarda (predicción del análisis, velocidad real) y actualiza el
    /// factor del semáforo con la mediana de las últimas reproducciones.
    pub(super) async fn record_calibration(&self, slot: &Slot, hash: InfoHash, actual_bps: f64) {
        let predicted = self
            .deps
            .library
            .lock()
            .await
            .any_of(&hash)
            .and_then(|e| e.live.as_ref().map(|l| l.avg_speed_bps))
            .filter(|p| *p > 0.0);
        let Some(predicted) = predicted else {
            return; // sin análisis previo no hay contra qué comparar
        };
        let recorded = self.deps.calibration.record(CalibrationSample {
            info_hash: hash,
            predicted_bps: predicted,
            actual_bps,
            at: Utc::now(),
        });
        let (factor, n) = match recorded {
            Ok(f) => f,
            Err(e) => {
                tracing::warn!("calibración: {e}");
                return;
            }
        };
        self.deps.library.lock().await.set_speed_factor(factor);
        self.log(
            slot,
            format!(
                "calibración: análisis {:.1} Mbps · real {:.1} Mbps → factor {factor:.2} ({n} reproducciones)",
                predicted * 8.0 / 1e6,
                actual_bps * 8.0 / 1e6
            ),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(predicted_mbps: f64, actual_mbps: f64) -> CalibrationSample {
        CalibrationSample {
            info_hash: InfoHash::from_bytes([1; 20]),
            predicted_bps: predicted_mbps * 1e6 / 8.0,
            actual_bps: actual_mbps * 1e6 / 8.0,
            at: Utc::now(),
        }
    }

    #[test]
    fn factor_es_la_mediana_acotada() {
        assert_eq!(calibration_factor(&[]), (1.0, 0));
        let (f, n) =
            calibration_factor(&[sample(20.0, 60.0), sample(10.0, 25.0), sample(30.0, 33.0)]);
        assert_eq!(n, 3);
        assert!(
            (f - 2.5).abs() < 1e-9,
            "mediana de 3,0 · 2,5 · 1,1 = 2,5 (fue {f})"
        );
        let (f, _) = calibration_factor(&[sample(1.0, 100.0)]);
        assert_eq!(f, 4.0, "acotado arriba");
    }

    fn paths_under(name: &str) -> AppPaths {
        let root =
            std::env::temp_dir().join(format!("tstream-test-calib-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let paths = AppPaths::under(&root);
        paths.ensure_dirs().unwrap();
        paths
    }

    /// Dos reproducciones que terminan a la vez: las dos muestras quedan en disco.
    #[test]
    fn dos_reproducciones_juntas_guardan_las_dos_muestras() {
        let paths = paths_under("concurrent");
        let calibration = std::sync::Arc::new(Calibration::load(&paths));
        let threads: Vec<_> = [(20.0, 40.0), (10.0, 30.0)]
            .into_iter()
            .map(|(p, a)| {
                let c = calibration.clone();
                std::thread::spawn(move || c.record(sample(p, a)).unwrap())
            })
            .collect();
        for t in threads {
            t.join().unwrap();
        }
        let reloaded = Calibration::load(&paths);
        assert_eq!(reloaded.factor(), (2.5, 2), "mediana de 2 y 3");
        assert_eq!(calibration.factor(), reloaded.factor(), "memoria = disco");
        std::fs::remove_dir_all(paths.data_dir.parent().unwrap()).unwrap();
    }

    /// `config.json` viejo con el factor aprendido y sin `calibration.json`: se siembra una vez.
    #[test]
    fn siembra_desde_config_viejo_una_vez() {
        let paths = paths_under("legacy");
        std::fs::write(
            paths.config_file(),
            r#"{ "ranking": { "speed_factor": 1.8, "speed_factor_samples": 5 } }"#,
        )
        .unwrap();
        let first = Calibration::load(&paths);
        assert_eq!(first.factor().1, 1);
        assert!((first.factor().0 - 1.8).abs() < 1e-9);
        first.record(sample(10.0, 30.0)).unwrap();
        // Ya hay muestras: no se vuelve a sembrar aunque el config viejo siga ahí.
        assert_eq!(Calibration::load(&paths).factor().1, 2);
        // Sin aprendido (0 muestras) no se siembra nada.
        let fresh = paths_under("legacy-none");
        std::fs::write(
            fresh.config_file(),
            r#"{ "ranking": { "speed_factor": 1.0, "speed_factor_samples": 0 } }"#,
        )
        .unwrap();
        assert_eq!(Calibration::load(&fresh).factor(), (1.0, 0));
        for p in [paths, fresh] {
            std::fs::remove_dir_all(p.data_dir.parent().unwrap()).unwrap();
        }
    }

    #[test]
    fn muestreador_ignora_el_primer_minuto_y_archivo_completo() {
        let mut s = CalibrationSampler::default();
        let stats = |bytes: u64, progress: f32| crate::engine::Stats {
            received_bytes: bytes,
            progress,
            ..Default::default()
        };
        s.push(Duration::from_secs(10), &stats(0, 0.1), false);
        s.push(Duration::from_secs(11), &stats(1_000_000, 0.1), false);
        assert!(s.rates.is_empty(), "antes del minuto 1 no cuenta");
        s.push(Duration::from_secs(70), &stats(2_000_000, 0.99), false);
        assert!(
            s.rates.is_empty(),
            "archivo casi completo: la velocidad cae y no sirve"
        );
        s.push(Duration::from_secs(71), &stats(3_000_000, 0.5), true);
        assert!(s.rates.is_empty(), "descarga pausada no cuenta");
        s.push(Duration::from_secs(72), &stats(4_000_000, 0.5), false);
        assert_eq!(s.rates.len(), 1);
        assert!(s.sustained().is_none(), "pocas muestras");
    }
}
