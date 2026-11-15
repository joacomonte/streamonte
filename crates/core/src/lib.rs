//! # tstream-core — núcleo de Torrent Stream v2
//!
//! Un módulo por responsabilidad (spec 04, NFR-01). Reglas de dependencia (sin ciclos):
//!
//! ```text
//! nivel 0 (base):     error · fsutil · paths · config · logger · events
//! nivel 1 (dominio):  magnet · ranking · storage            (puros / sin E/S de red)
//! nivel 2 (E/S):      clipboard · library · trackers · engine · player · cleanup
//! nivel 3 (procesos): preload(engine) · analyzer(engine, trackers, player, library, ranking)
//!                     playback(engine, preload, player, cleanup, library) · subtitles(player)
//!                     catalog(trackers, audio, subtitles: parser de releases)   [F4b, spec 09]
//! nivel 4:            app (AppCore: cablea todo; única puerta de entrada para la UI)
//! ```
//! Un módulo solo puede usar módulos de su nivel o inferiores. La UI (src-tauri + ui/)
//! solo habla con [`app::AppCore`] y recibe [`events::CoreEvent`]; nunca ve el motor (NFR-01/02).

pub mod error;
pub mod events;

pub mod activity;
pub mod config;
pub mod fsutil;
pub mod logger;
pub mod paths;

pub mod magnet;
pub mod ranking;
pub mod storage;

pub mod cleanup;
pub mod clipboard;
pub mod engine;
pub mod library;
mod mpv_ipc;
pub mod player;
pub mod trackers;

pub mod analyzer;
pub mod audio;
pub mod catalog;
pub mod playback;
pub mod preload;
pub mod subtitles;

pub mod app;

pub use error::{CoreError, Result};
