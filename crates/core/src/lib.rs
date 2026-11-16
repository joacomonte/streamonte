//! # streamonte-core — núcleo de Streamonte
//!
//! Un módulo por responsabilidad (spec 04, NFR-01). Reglas de dependencia (sin ciclos):
//!
//! ```text
//! nivel 0 (base):     error · fsutil · paths · config · logger · events · activity
//! nivel 1 (dominio):  magnet · video_key · release · audio · ranking   (puros / sin E/S de red)
//! nivel 2 (E/S):      http · secrets · external · clipboard · library · trackers · engine
//!                     player · cleanup
//! nivel 3 (procesos): preload(engine) · analyzer(engine, trackers, player, library, ranking)
//!                     playback(engine, preload, player, cleanup, library) · subtitles(player, http)
//!                     catalog(http, trackers, audio, release)   [F4b, spec 09]
//! nivel 4:            app + intake (AppCore: cablea todo; única puerta de entrada para la UI)
//! ```
//! Excepciones conocidas: `release` usa `engine::is_video` y `subtitles::SUBTITLE_EXTENSIONS`
//! (listas de extensiones), y el servidor HTTP de rqbit lee el MIME de la tabla de contenedores
//! de `preload` (una sola tabla extensión → contenedor/MIME).
//! Un módulo solo puede usar módulos de su nivel o inferiores. La UI (src-tauri + ui/)
//! solo habla con [`app::AppCore`] y recibe [`events::CoreEvent`]; nunca ve el motor (NFR-01/02).

pub mod error;
pub mod events;

pub mod activity;
pub mod config;
pub mod datacache;
pub mod fsutil;
pub mod logger;
pub mod paths;
mod rebrand;

pub mod magnet;
pub mod ranking;
pub mod release;
pub mod speedtest;
pub mod video_key;

pub mod cleanup;
pub mod clipboard;
pub mod engine;
mod external;
mod http;
pub mod incoming;
pub mod library;
mod mpv_ipc;
pub mod player;
mod secrets;
pub mod trackers;

pub mod analyzer;
pub mod audio;
pub mod catalog;
pub mod playback;
pub mod preload;
pub mod subtitles;

pub mod app;
mod intake;

pub use error::{CoreError, Result};
