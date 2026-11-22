//! Velocidad de internet (2026-11-16): cuánto baja esta conexión, medido contra Cloudflare. Es el
//! techo de la salud estimada de un torrent (por más seeders que tenga, no baja más rápido que la
//! línea). Se guarda una medición por red (la IP pública identifica la red sin pedir permisos de
//! ubicación para leer el nombre del Wi-Fi): al abrir la app solo se mide si esta red no tiene una.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::events::{CoreEvent, EventSink};
use crate::{CoreError, Result};

const TRACE_URL: &str = "https://speed.cloudflare.com/cdn-cgi/trace";
/// 50 MB por pedido (más da 403); cada conexión pide otro al terminar, hasta que corta el tiempo.
const DOWN_URL: &str = "https://speed.cloudflare.com/__down?bytes=50000000";
const CONNECTIONS: usize = 4;
const MEASURE: Duration = Duration::from_secs(8);
/// Lo primero se descarta: es el arranque de TCP, no la velocidad sostenida.
const WARMUP: Duration = Duration::from_secs(1);
const PROGRESS_EVERY: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpeedResult {
    pub mbps: f64,
    pub measured_at: chrono::DateTime<chrono::Utc>,
    /// Qué red (hash de la IP pública): la UI separa por red la calibración de la salud.
    #[serde(default)]
    pub network: String,
}

/// Para la UI: midiendo (con lo que va), lista o falló.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SpeedState {
    Measuring { mbps: f64 },
    Done { result: SpeedResult },
    Failed { message: String },
}

pub struct SpeedTest {
    /// `velocidad.json`: red (hash de la IP pública) → última medición.
    file: PathBuf,
    client: reqwest::Client,
    /// Una medición a la vez (otra pedida mientras tanto espera y usa la misma).
    running: tokio::sync::Mutex<()>,
}

impl SpeedTest {
    pub fn new(file: PathBuf) -> Self {
        Self {
            file,
            client: reqwest::Client::new(),
            running: tokio::sync::Mutex::default(),
        }
    }

    /// La velocidad de la red actual: la guardada si hay (salvo `force`), si no la mide avisando el
    /// progreso con `SpeedTest`.
    pub async fn run(&self, force: bool, events: &dyn EventSink) -> Result<SpeedResult> {
        let res = self.run_inner(force, events).await;
        let state = match &res {
            Ok(result) => SpeedState::Done {
                result: result.clone(),
            },
            Err(e) => SpeedState::Failed {
                message: e.user_message(),
            },
        };
        events.emit(CoreEvent::SpeedTest { state });
        res
    }

    async fn run_inner(&self, force: bool, events: &dyn EventSink) -> Result<SpeedResult> {
        let _one = self.running.lock().await;
        let network = self.network().await?;
        let mut saved: HashMap<String, SpeedResult> =
            crate::fsutil::read_json(&self.file)?.unwrap_or_default();
        if let Some(known) = saved.get(&network).filter(|_| !force) {
            return Ok(SpeedResult {
                network,
                ..known.clone()
            });
        }
        let mbps = self.measure(events).await?;
        let result = SpeedResult {
            mbps,
            measured_at: chrono::Utc::now(),
            network: network.clone(),
        };
        tracing::info!(mbps = mbps.round(), "velocidad de internet medida");
        saved.insert(network, result.clone());
        crate::fsutil::write_json_atomic(&self.file, &saved)?;
        Ok(result)
    }

    /// Qué red es: hash de la IP pública (no se guarda la IP).
    async fn network(&self) -> Result<String> {
        let trace = self
            .client
            .get(TRACE_URL)
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(failed)?
            .text()
            .await
            .map_err(failed)?;
        let ip = trace
            .lines()
            .find_map(|l| l.strip_prefix("ip="))
            .ok_or_else(|| failed("Cloudflare no dijo la IP"))?;
        Ok(format!("{:016x}", fnv1a(ip.as_bytes())))
    }

    /// `CONNECTIONS` descargas a la vez durante `MEASURE`; Mbps sostenidos (sin el arranque).
    async fn measure(&self, events: &dyn EventSink) -> Result<f64> {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<usize>();
        let mut tasks = tokio::task::JoinSet::new();
        for _ in 0..CONNECTIONS {
            let (client, tx) = (self.client.clone(), tx.clone());
            tasks.spawn(async move {
                loop {
                    let mut resp = client.get(DOWN_URL).send().await?.error_for_status()?;
                    while let Some(chunk) = resp.chunk().await? {
                        if tx.send(chunk.len()).is_err() {
                            return Ok::<_, reqwest::Error>(());
                        }
                    }
                }
            });
        }
        drop(tx);
        let start = Instant::now();
        let deadline = tokio::time::sleep(MEASURE);
        tokio::pin!(deadline);
        let (mut total, mut at_warmup) = (0usize, None);
        let mut last_progress = start;
        loop {
            tokio::select! {
                _ = &mut deadline => break,
                got = rx.recv() => match got {
                    Some(n) => total += n,
                    None => break, // terminaron todas (o fallaron)
                },
            }
            let elapsed = start.elapsed();
            if at_warmup.is_none() && elapsed >= WARMUP {
                at_warmup = Some(total);
            }
            if last_progress.elapsed() >= PROGRESS_EVERY {
                last_progress = Instant::now();
                events.emit(CoreEvent::SpeedTest {
                    state: SpeedState::Measuring {
                        mbps: mbps(total, elapsed),
                    },
                });
            }
        }
        tasks.abort_all();
        let elapsed = start.elapsed();
        let mbps = match at_warmup {
            Some(base) if elapsed > WARMUP => mbps(total - base, elapsed - WARMUP),
            _ => mbps(total, elapsed),
        };
        if total == 0 || !mbps.is_finite() {
            // Sin un byte: el error de alguna descarga explica por qué.
            let why = match tasks.join_next().await {
                Some(Ok(Err(e))) => e.to_string(),
                _ => "no bajó nada".into(),
            };
            return Err(failed(why));
        }
        Ok(mbps)
    }
}

fn mbps(bytes: usize, secs: Duration) -> f64 {
    bytes as f64 * 8.0 / secs.as_secs_f64().max(0.001) / 1e6
}

/// FNV-1a: estable entre versiones de Rust (el `DefaultHasher` no lo promete).
fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |h, b| {
        (h ^ u64::from(*b)).wrapping_mul(0x0100_0000_01b3)
    })
}

fn failed(e: impl std::fmt::Display) -> CoreError {
    CoreError::Catalog {
        user: "No se pudo medir la velocidad de internet.".into(),
        detail: format!("test de velocidad: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mbps_y_red_estable() {
        assert_eq!(mbps(1_000_000, Duration::from_secs(1)), 8.0);
        // Vectores de referencia de FNV-1a 64 bits.
        assert_eq!(fnv1a(b""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(fnv1a(b"a"), 0xaf63_dc4c_8601_ec8c);
        assert_ne!(fnv1a(b"1.2.3.4"), fnv1a(b"1.2.3.5"));
    }

    // Red real: `cargo test -p streamonte-core --lib speedtest -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore = "red real: descarga de Cloudflare para medir ancho de banda"]
    async fn mide_de_verdad() {
        let dir = crate::fsutil::test_dir("speed");
        let t = SpeedTest::new(dir.join("speed.json"));
        let r = t.run(true, &crate::events::NullSink).await.unwrap();
        println!("{r:?}");
        assert!(r.mbps > 1.0);
        assert_eq!(
            t.run(false, &crate::events::NullSink).await.unwrap(),
            r,
            "misma red: la guardada"
        );
    }
}
