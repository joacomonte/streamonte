//! `preload` — precarga del principio y, si es MP4/MOV, del índice del final, con prioridad
//! EXCLUSIVA antes de abrir el reproductor (FR-11, ADR-06, lecciones 2 y 3).
//!
//! Secuencia:
//! 1. `plan()` → rangos (inicio siempre; final solo MP4/MOV).
//! 2. `engine.prioritize_ranges(.., Exclusive)`.
//! 3. Esperar `RangeReady` de todos, o `fallback_open_secs` (plan B), o cancelación.
//! 4. Si `select_after`: `engine.select_file()` → el resto del archivo sigue bajando (reproducir).
//!    El análisis rápido no lo pide: solo necesita el principio y el final para leer duración e
//!    idiomas, y bajar el archivo entero llenaba el disco (2026-11-15: 36 GB en una tarde).
//!
//! Con diagnóstico activo: cada 2 s, `RangeProgress` por rango al target `diag::preload`.

use std::time::{Duration, Instant};

use serde::Serialize;
use tokio_util::sync::CancellationToken;

use crate::config::PreloadConfig;
use crate::engine::{
    ByteRange, EngineEvent, FileInfo, RangeProgress, TorrentEngine, TorrentHandle,
};
use crate::logger::DIAG_PRELOAD;
use crate::{CoreError, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Container {
    /// .mp4 .m4v .mov — el índice `moov` puede estar al final.
    Mp4Like,
    /// .mkv .webm — basta el principio.
    Matroska,
    Other,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PreloadPlan {
    pub file_index: usize,
    pub container: Container,
    pub ranges: Vec<ByteRange>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct PreloadProgress {
    /// 0.0–1.0 sobre el total de piezas de todos los rangos.
    pub fraction: f32,
    pub elapsed_secs: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PreloadOutcome {
    Ready {
        elapsed: Duration,
    },
    /// Plan B: se abre igual (FR-11).
    TimedOut {
        elapsed: Duration,
        fraction: f32,
    },
}

/// Extensión → (contenedor, MIME). Única tabla: la leen [`container_of`] y el servidor HTTP
/// local de rqbit (`Content-Type`, vía [`mime_of_extension`]).
const CONTAINERS: &[(&str, Container, &str)] = &[
    ("mp4", Container::Mp4Like, "video/mp4"),
    ("m4v", Container::Mp4Like, "video/mp4"),
    ("mov", Container::Mp4Like, "video/quicktime"),
    ("mkv", Container::Matroska, "video/x-matroska"),
    ("webm", Container::Matroska, "video/webm"),
];

fn container_entry(ext: &str) -> Option<&'static (&'static str, Container, &'static str)> {
    let ext = ext.to_ascii_lowercase();
    CONTAINERS.iter().find(|(e, _, _)| *e == ext)
}

pub fn container_of(file_name: &str) -> Container {
    std::path::Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .and_then(container_entry)
        .map_or(Container::Other, |(_, c, _)| *c)
}

/// MIME de una extensión (sin el punto, cualquier mayúscula); `application/octet-stream` si no
/// es un contenedor conocido.
pub(crate) fn mime_of_extension(ext: &str) -> &'static str {
    container_entry(ext).map_or("application/octet-stream", |(_, _, mime)| mime)
}

/// Rangos a precargar. Si el archivo es más chico que inicio+final, un único rango.
/// Como v1, ningún rango supera 1/4 del archivo (en archivos chicos no tiene sentido bajar medio video).
pub fn plan(file: &FileInfo, cfg: &PreloadConfig) -> PreloadPlan {
    let container = container_of(&file.name);
    let quarter = (file.size / 4).max(1);
    let head = cfg.head_bytes.min(quarter).min(file.size);
    let tail = if container == Container::Mp4Like {
        cfg.tail_bytes.min(quarter)
    } else {
        0
    };

    let mut ranges = vec![ByteRange {
        start: 0,
        end: head,
    }];
    if tail > 0 {
        let tail_start = file.size - tail;
        if tail_start <= head {
            ranges = vec![ByteRange {
                start: 0,
                end: file.size,
            }];
        } else {
            ranges.push(ByteRange {
                start: tail_start,
                end: file.size,
            });
        }
    }
    PreloadPlan {
        file_index: file.index,
        container,
        ranges,
    }
}

/// Ejecuta la precarga. Devuelve `Err(Cancelled)` si `cancel` se dispara (el usuario detuvo).
/// Al terminar (listo o plan B) selecciona el archivo completo si `select_after`: el resto sigue
/// bajando.
pub async fn run(
    engine: &dyn TorrentEngine,
    handle: TorrentHandle,
    plan: &PreloadPlan,
    cfg: &PreloadConfig,
    cancel: CancellationToken,
    select_after: bool,
    on_progress: &(dyn Fn(PreloadProgress) + Send + Sync),
) -> Result<PreloadOutcome> {
    // Suscribirse ANTES de pedir los rangos para no perder un `RangeReady` rápido.
    let mut events = engine.subscribe();
    engine
        .prioritize_ranges(handle, plan.file_index, &plan.ranges)
        .await?;

    let started = Instant::now();
    let deadline = Duration::from_secs(cfg.fallback_open_secs);
    let mut pending: Vec<ByteRange> = plan.ranges.clone();
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    let mut ticks: u64 = 0;
    let mut fraction = 0.0_f32;
    // (mejor fracción vista, cuándo se vio): para detectar la precarga estancada.
    let mut advance = (0.0_f32, Duration::ZERO);

    let outcome = loop {
        if pending.is_empty() {
            break PreloadOutcome::Ready {
                elapsed: started.elapsed(),
            };
        }
        if started.elapsed() >= deadline || stalled(fraction, &mut advance, started.elapsed()) {
            break PreloadOutcome::TimedOut {
                elapsed: started.elapsed(),
                fraction,
            };
        }
        tokio::select! {
            _ = cancel.cancelled() => return Err(CoreError::Cancelled),
            ev = events.recv() => match ev {
                Ok(EngineEvent::RangeReady { handle: h, file_index, range })
                    if h == handle && file_index == plan.file_index =>
                {
                    pending.retain(|r| *r != range);
                    tracing::debug!(target: DIAG_PRELOAD, ?range, faltan = pending.len(), "rango completo");
                }
                Ok(EngineEvent::Exited { .. }) => return Err(CoreError::Engine("el motor se cerró durante la precarga".into())),
                Ok(_) => {}
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!(n, "eventos del motor perdidos; se sigue por stats");
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    return Err(CoreError::Engine("el motor se cerró durante la precarga".into()));
                }
            },
            _ = tick.tick() => {
                ticks += 1;
                // Con límite: un motor trabado no debe impedir el plan B (NFR-12).
                if let Ok(Ok(stats)) = tokio::time::timeout(Duration::from_secs(3), engine.stats(handle)).await {
                    let (done, total) = stats.ranges.iter().fold((0u32, 0u32), |(d, t), r| (d + r.pieces_done, t + r.pieces_total));
                    if total > 0 {
                        fraction = done as f32 / total as f32;
                    }
                    // Si el broadcast se atrasó (Lagged) se pierde el `RangeReady`: las stats lo cubren.
                    drop_completed(&mut pending, &stats.ranges);
                    // Lección 9: este log fue el que encontró las causas 1–3 en v1.
                    if ticks % 2 == 0 {
                        for r in &stats.ranges {
                            tracing::debug!(
                                target: DIAG_PRELOAD,
                                start = r.range.start, end = r.range.end,
                                piezas = format!("{}/{}", r.pieces_done, r.pieces_total),
                                peers_con_faltantes = r.peers_with_missing,
                                vel_mbps = format!("{:.1}", stats.download_speed_bps * 8.0 / 1e6),
                                peers = stats.peers,
                                "precarga"
                            );
                        }
                    }
                }
                on_progress(PreloadProgress { fraction, elapsed_secs: started.elapsed().as_secs_f32() });
            }
        }
    };

    on_progress(PreloadProgress {
        fraction: if matches!(outcome, PreloadOutcome::Ready { .. }) {
            1.0
        } else {
            fraction
        },
        elapsed_secs: started.elapsed().as_secs_f32(),
    });
    tracing::info!(?outcome, "precarga terminada");
    if select_after {
        engine.select_file(handle, plan.file_index).await?;
    }
    Ok(outcome)
}

/// Sin avance en este lapso se abre ya: en logs reales mpv por HTTP arrancó en ~6 s donde la
/// precarga seguía en 0 % a los 45 s, y cuando sí avanza suele hacerlo en los primeros 4–10 s.
const STALL: Duration = Duration::from_secs(12);

/// Precarga estancada: la fracción no subió en `STALL` (incluye "sigue en 0 % desde el inicio").
/// `advance` = (mejor fracción vista, cuándo se vio); se actualiza acá.
fn stalled(fraction: f32, advance: &mut (f32, Duration), elapsed: Duration) -> bool {
    if fraction > advance.0 {
        *advance = (fraction, elapsed);
    }
    elapsed.saturating_sub(advance.1) >= STALL
}

/// Saca de `pending` los rangos que las stats ya dan completos.
fn drop_completed(pending: &mut Vec<ByteRange>, stats: &[RangeProgress]) {
    pending.retain(|p| {
        !stats
            .iter()
            .any(|r| r.range == *p && r.pieces_total > 0 && r.pieces_done >= r.pieces_total)
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::MIB;

    fn file(name: &str, size: u64) -> FileInfo {
        FileInfo {
            index: 3,
            name: name.into(),
            size,
            offset: 0,
        }
    }

    #[test]
    fn mp4_grande_pide_inicio_y_final() {
        let cfg = PreloadConfig::default();
        let size = 20 * 1024 * MIB;
        let p = plan(&file("Pelicula.2160p.MP4", size), &cfg);
        assert_eq!(p.container, Container::Mp4Like);
        assert_eq!(p.file_index, 3);
        assert_eq!(
            p.ranges,
            vec![
                ByteRange {
                    start: 0,
                    end: 16 * MIB
                },
                ByteRange {
                    start: size - 40 * MIB,
                    end: size
                }
            ]
        );
    }

    #[test]
    fn stats_completan_rangos_sin_range_ready() {
        let a = ByteRange { start: 0, end: 10 };
        let b = ByteRange {
            start: 90,
            end: 100,
        };
        let progress = |range, pieces_done, pieces_total| RangeProgress {
            range,
            pieces_done,
            pieces_total,
            peers_with_missing: 0,
        };
        let mut pending = vec![a, b];
        drop_completed(&mut pending, &[progress(a, 3, 3), progress(b, 2, 3)]);
        assert_eq!(pending, vec![b]);
        // Sin piezas conocidas no se da por completo.
        drop_completed(&mut pending, &[progress(b, 0, 0)]);
        assert_eq!(pending, vec![b]);
    }

    #[test]
    fn estancada_si_no_avanza_en_stall() {
        let s = Duration::from_secs;
        let mut adv = (0.0, Duration::ZERO);
        assert!(!stalled(0.0, &mut adv, s(11)));
        assert!(stalled(0.0, &mut adv, s(12)), "sigue en 0 % a los 12 s");
        let mut adv = (0.0, Duration::ZERO);
        assert!(!stalled(0.1, &mut adv, s(10)));
        assert!(
            !stalled(0.1, &mut adv, s(21)),
            "avanzó a los 10 s: cuenta desde ahí"
        );
        assert!(!stalled(0.3, &mut adv, s(22)));
        assert!(stalled(0.3, &mut adv, s(34)), "trabada en 30 % 12 s");
    }

    /// Salidas fijadas de la tabla única (antes había dos listas: acá y en `engine/rqbit/http.rs`).
    #[test]
    fn contenedor_y_mime_por_extension() {
        assert_eq!(container_of("a/Peli.MP4"), Container::Mp4Like);
        assert_eq!(container_of("x.m4v"), Container::Mp4Like);
        assert_eq!(container_of("x.mov"), Container::Mp4Like);
        assert_eq!(container_of("x.mkv"), Container::Matroska);
        assert_eq!(container_of("x.webm"), Container::Matroska);
        assert_eq!(container_of("x.avi"), Container::Other);
        assert_eq!(container_of("mkv"), Container::Other, "sin extensión");
        assert_eq!(mime_of_extension("MP4"), "video/mp4");
        assert_eq!(mime_of_extension("m4v"), "video/mp4");
        assert_eq!(mime_of_extension("mov"), "video/quicktime");
        assert_eq!(mime_of_extension("mkv"), "video/x-matroska");
        assert_eq!(mime_of_extension("webm"), "video/webm");
        assert_eq!(mime_of_extension("avi"), "application/octet-stream");
    }

    #[test]
    fn mkv_solo_inicio() {
        let p = plan(
            &file("serie.s01e01.mkv", 4 * 1024 * MIB),
            &PreloadConfig::default(),
        );
        assert_eq!(p.container, Container::Matroska);
        assert_eq!(
            p.ranges,
            vec![ByteRange {
                start: 0,
                end: 16 * MIB
            }]
        );
    }

    #[test]
    fn archivo_chico_no_baja_mas_de_un_cuarto_por_rango() {
        let size = 40 * MIB;
        let p = plan(&file("corto.mp4", size), &PreloadConfig::default());
        assert_eq!(
            p.ranges,
            vec![
                ByteRange {
                    start: 0,
                    end: 10 * MIB
                },
                ByteRange {
                    start: 30 * MIB,
                    end: size
                }
            ]
        );
    }
}
