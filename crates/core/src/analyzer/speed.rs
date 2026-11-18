//! Velocidad real sostenida: muestreo por segundo, meseta y medición parcial (FR-06, calibración
//! del 2026-11-13). Todo menos [`sample_speed`] es puro.

use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio_util::sync::CancellationToken;

use super::{MeasurePhase, ProgressSink, SpeedProgress};
use crate::library::LiveMeasurement;
use crate::Result;

pub(super) struct SpeedSample {
    pub(super) avg_bps: f64,
    pub(super) max_bps: f64,
    pub(super) peers: u32,
    pub(super) seeds: u32,
    /// Segundos de velocidad medidos (cantidad de muestras de 1 s).
    pub(super) secs: f64,
}

/// Lo medido hasta ahora, para guardar una medición parcial si el usuario pausa (2026-11-13).
#[derive(Default)]
pub(super) struct Partial {
    pub(super) torrent_name: Option<String>,
    pub(super) file: Option<crate::engine::FileInfo>,
    samples: Vec<f64>,
    peers: u32,
    seeds: u32,
}

pub(super) type PartialRef = Arc<std::sync::Mutex<Partial>>;

/// Mínimo de segundos de velocidad para que una medición parcial valga la pena.
const PARTIAL_MIN_SAMPLES: usize = 3;

/// Medición parcial con lo que se llegó a medir (sin duración real: se estima con "~").
pub(super) fn partial_measurement(partial: &PartialRef) -> Option<LiveMeasurement> {
    let p = partial.lock().expect("partial");
    let file = p.file.clone()?;
    if p.samples.len() < PARTIAL_MIN_SAMPLES {
        return None;
    }
    let speed = sustained_speed(&p.samples, p.peers, p.seeds);
    Some(LiveMeasurement {
        measured_at: chrono::Utc::now(),
        torrent_name: p.torrent_name.clone(),
        file_index: file.index,
        file_name: file.name,
        file_size: file.size,
        peers: speed.peers,
        seeds: speed.seeds,
        partial: true,
        measured_secs: speed.secs,
        avg_speed_bps: speed.avg_bps,
        max_speed_bps: speed.max_bps,
        duration_secs: None,
        audio: None,
        subs: None,
        fps: None,
    })
}

/// Ventana de medición de velocidad: como mínimo `min` (después del arranque) y como máximo `max`.
#[derive(Debug, Clone, Copy)]
pub(super) struct SpeedWindow {
    pub(super) min: Duration,
    pub(super) max: Duration,
}

/// Velocidad real sostenida. Mide hasta que la velocidad se estabiliza (entre `min` y `max`),
/// o hasta que el usuario toca "Listo" (`finish`). Informa el avance cada 2 s (`progress`).
/// Cuanto más se mide, más real (hasta la meseta): por eso se puede estirar hasta `max`.
pub(super) async fn sample_speed(
    engine: &dyn crate::engine::TorrentEngine,
    handle: crate::engine::TorrentHandle,
    window: SpeedWindow,
    partial: &PartialRef,
    finish: &CancellationToken,
    progress: &ProgressSink,
) -> Result<(SpeedSample, u64)> {
    // Calibración (usuario, 2026-11-13: "dice que se va a cortar pero no se corta"):
    // 1. Bytes RECIBIDOS, no piezas verificadas: con piezas de 16 MB, en 15 s casi no se completan.
    // 2. Se descarta el arranque (WARMUP): los primeros segundos los peers recién se conectan (lección 5).
    // 3. Velocidad sostenida = MEDIANA de las muestras por segundo (no la suma total / tiempo).
    // 4. Si la velocidad sigue subiendo al final, se estira la ventana hasta EXTEND_MAX.
    let mut samples: Vec<f64> = Vec::new();
    let mut peers = 0;
    let mut seeds = 0;
    let mut prev: Option<(Instant, u64)> = None;
    let mut use_received = true;
    let mut base_downloaded: Option<u64> = None;
    let mut last_downloaded = 0;
    let t0 = Instant::now();
    let min_until = WARMUP + window.min;
    let max_until = WARMUP + window.max;
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    loop {
        tokio::select! {
            _ = tick.tick() => {}
            // "Listo": se cierra con lo medido (si ya hay algo).
            _ = finish.cancelled(), if !samples.is_empty() => break,
        }
        let Ok(Ok(s)) = tokio::time::timeout(Duration::from_secs(3), engine.stats(handle)).await
        else {
            continue;
        };
        peers = peers.max(s.peers);
        seeds = seeds.max(s.seeds);
        last_downloaded = s.downloaded_bytes;
        // Motores que no informan bytes recibidos: se cae a los verificados. Contra el arranque:
        // con lo de un análisis anterior en disco `downloaded` ya empieza > 0 (FR-06d).
        let base = *base_downloaded.get_or_insert(s.downloaded_bytes);
        if use_received && s.received_bytes == 0 && s.downloaded_bytes > base {
            use_received = false;
            // `prev` tenía el contador de recibidos: restarlo del de verificados daría un pico.
            prev = None;
        }
        let bytes = if use_received {
            s.received_bytes
        } else {
            s.downloaded_bytes
        };
        let now = Instant::now();
        if let Some((t_prev, b_prev)) = prev {
            if now.duration_since(t0) > WARMUP {
                let dt = now.duration_since(t_prev).as_secs_f64().max(0.001);
                samples.push(bytes.saturating_sub(b_prev) as f64 / dt);
            }
        }
        prev = Some((now, bytes));
        {
            let mut p = partial.lock().expect("partial");
            p.samples.clone_from(&samples);
            p.peers = peers;
            p.seeds = seeds;
        }

        let stable = is_stable(&samples);
        if !samples.is_empty() && samples.len() % 2 == 0 {
            let downloaded_bytes = s.downloaded_bytes;
            let s = sustained_speed(&samples, peers, seeds);
            progress(SpeedProgress {
                speed_bps: s.avg_bps,
                secs: s.secs,
                peers,
                seeds,
                stable,
                downloaded_bytes,
                phase: MeasurePhase::Measuring,
            });
        }

        let elapsed = t0.elapsed();
        if elapsed >= max_until || (elapsed >= min_until && stable) {
            break;
        }
    }
    Ok((sustained_speed(&samples, peers, seeds), last_downloaded))
}

/// Segundos iniciales que no cuentan (conexión de peers).
const WARMUP: Duration = Duration::from_secs(5);

/// ¿Los últimos 5 s van claramente más rápido que la mediana? (todavía no llegó a la meseta)
fn still_rising(samples: &[f64]) -> bool {
    if samples.len() < 8 {
        return true;
    }
    let tail = median(&samples[samples.len() - 5..]);
    tail > median(samples) * 1.2
}

/// Meseta alcanzada: ya no sube y los últimos 10 s están cerca (±15 %) de la velocidad
/// sostenida. A partir de acá medir más casi no cambia el resultado.
fn is_stable(samples: &[f64]) -> bool {
    if samples.len() < 15 || still_rising(samples) {
        return false;
    }
    let sustained = median(&samples[samples.len() / 2..]);
    if sustained <= 0.0 {
        return false;
    }
    let recent = median(&samples[samples.len() - 10..]);
    (recent / sustained - 1.0).abs() <= 0.15
}

fn median(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut v = values.to_vec();
    v.sort_by(|a, b| a.total_cmp(b));
    let mid = v.len() / 2;
    if v.len() % 2 == 0 {
        (v[mid - 1] + v[mid]) / 2.0
    } else {
        v[mid]
    }
}

/// Velocidad sostenida (mediana de la meseta: la segunda mitad de las muestras, que ya pasó el
/// arranque) y máxima (mejor promedio móvil de 3 s, para no tomar un pico de 1 s).
fn sustained_speed(samples: &[f64], peers: u32, seeds: u32) -> SpeedSample {
    let plateau = &samples[samples.len() / 2..];
    let avg_bps = median(plateau);
    let max_bps = samples
        .windows(3)
        .map(|w| w.iter().sum::<f64>() / 3.0)
        .fold(avg_bps, f64::max);
    SpeedSample {
        avg_bps,
        max_bps,
        peers,
        seeds,
        secs: samples.len() as f64,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn velocidad_sostenida_ignora_el_arranque_lento() {
        // Caso real (Torrentio 27,6 GB): arranque lento y después ~60 Mbps sostenidos.
        let mbps = |x: f64| x * 1e6 / 8.0;
        let samples: Vec<f64> = [
            2.0, 5.0, 9.0, 20.0, 35.0, 55.0, 60.0, 62.0, 58.0, 61.0, 63.0, 59.0, 60.0, 64.0,
        ]
        .iter()
        .map(|&m| mbps(m))
        .collect();
        let s = sustained_speed(&samples, 10, 4);
        let got = s.avg_bps * 8.0 / 1e6;
        assert!((59.0..=62.0).contains(&got), "sostenida {got} Mbps");
        // El total/tiempo viejo daba mucho menos (lo que marcaba "se va a cortar").
        let old = samples.iter().sum::<f64>() / samples.len() as f64 * 8.0 / 1e6;
        assert!(old < 50.0);
        assert!(s.max_bps >= s.avg_bps);
    }

    #[test]
    fn sigue_subiendo_estira_la_ventana() {
        let rising: Vec<f64> = (1..=12).map(|i| f64::from(i) * 1e6).collect();
        assert!(still_rising(&rising));
        let flat = vec![5e6; 12];
        assert!(!still_rising(&flat));
        assert!(still_rising(&[1e6; 3]), "pocas muestras: seguir midiendo");
    }

    #[test]
    fn meseta_estable_corta_la_medicion() {
        assert!(!is_stable(&[5e6; 10]), "10 s: muy poco para saber");
        assert!(is_stable(&[5e6; 20]), "20 s planos: estable");
        let mut subiendo: Vec<f64> = vec![5e6; 10];
        subiendo.extend((1..=10).map(|i| 5e6 + f64::from(i) * 1e6));
        assert!(!is_stable(&subiendo), "todavía sube: seguir midiendo");
        let mut ruidosa = vec![5e6; 10];
        ruidosa.extend([1e6, 9e6, 1e6, 9e6, 1e6, 9e6, 1e6, 9e6, 1e6, 9e6]);
        let _ = is_stable(&ruidosa); // no debe entrar en pánico con ruido
    }

    #[test]
    fn pausa_a_mitad_guarda_medicion_parcial() {
        let p: PartialRef = Arc::default();
        assert!(
            partial_measurement(&p).is_none(),
            "sin metadatos no hay nada"
        );
        {
            let mut g = p.lock().unwrap();
            g.torrent_name = Some("Pelicula.2024.2160p".into());
            g.file = Some(crate::engine::FileInfo {
                index: 0,
                name: "p.mkv".into(),
                size: 20_000_000_000,
                offset: 0,
            });
            g.samples = vec![1e6, 2e6];
        }
        assert!(
            partial_measurement(&p).is_none(),
            "2 s de velocidad: muy poco"
        );
        p.lock().unwrap().samples = vec![1e6, 4e6, 5e6, 5e6, 6e6];
        p.lock().unwrap().seeds = 7;
        let m = partial_measurement(&p).expect("parcial");
        assert!(m.partial);
        assert_eq!(m.measured_secs, 5.0);
        assert_eq!(m.seeds, 7);
        assert!(m.duration_secs.is_none(), "sin duración real: se estima");
        assert!(m.avg_speed_bps >= 5e6);
    }

    #[test]
    fn sin_muestras_da_cero_sin_panic() {
        let s = sustained_speed(&[], 0, 0);
        assert_eq!(s.avg_bps, 0.0);
    }
}
