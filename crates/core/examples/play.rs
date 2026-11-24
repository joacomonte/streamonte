//! Reproducir un magnet desde la línea de comandos (F1, sin UI). Base del benchmark (06-D).
//!
//! ```text
//! cargo run -p streamonte-core --example play -- "<magnet>" [--vlc] [--diag]
//! ```
//! Imprime el log en vivo y, al cerrar el reproductor, un resumen con las métricas:
//! metadatos (NFR-08), precarga (FR-11), primera imagen (O1/NFR-07) y cierre+borrado (FR-12/T-04).
//! Correr en la sesión real del usuario (lección 7). Solo contenido legal en pruebas.

use std::sync::{Arc, Mutex};
use std::time::Instant;

use streamonte_core::app::AppCore;
use streamonte_core::config::PlayerKind;
use streamonte_core::events::{CoreEvent, EventSink};
use streamonte_core::magnet::Magnet;
use streamonte_core::playback::{PlaybackRow, PlaybackState, StartRequest};

#[derive(Default)]
struct Summary {
    last_row: Option<PlaybackRow>,
    stop_line: Option<String>,
    done: bool,
}

struct ConsoleSink(Arc<Mutex<Summary>>);

impl EventSink for ConsoleSink {
    fn emit(&self, event: CoreEvent) {
        let mut s = self.0.lock().unwrap();
        match event {
            CoreEvent::PlaybackLog { line, .. } => {
                if line.contains("motor detenido") {
                    s.stop_line = Some(line.clone());
                }
                println!("{line}");
            }
            CoreEvent::PlaybackUpdated { row } => {
                if let PlaybackState::Failed { message } = &row.state {
                    println!("FALLÓ: {message}");
                    s.done = true;
                }
                s.last_row = Some(row);
            }
            CoreEvent::PlaybackRemoved { .. } => s.done = true,
            CoreEvent::Status { message, .. } => println!("estado: {message}"),
            _ => {}
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(uri) = args
        .iter()
        .find(|a| a.to_ascii_lowercase().starts_with("magnet:"))
    else {
        eprintln!("uso: play \"<magnet>\" [--vlc] [--diag]");
        std::process::exit(2);
    };
    let magnet = Magnet::parse(uri)?;
    let player = if args.iter().any(|a| a == "--vlc") {
        PlayerKind::Vlc
    } else {
        PlayerKind::Mpv
    };

    let summary = Arc::new(Mutex::new(Summary::default()));
    let core = AppCore::start(Arc::new(ConsoleSink(summary.clone()))).await?;

    let engine = core
        .update_config(|config| {
            config.logging.diagnostics = args.iter().any(|a| a == "--diag");
            Ok(config.engine.kind)
        })
        .await?;

    println!(
        "motor: {engine:?} · reproductor: {player:?} · {}",
        magnet.display_name.as_deref().unwrap_or("(sin nombre)")
    );
    let t0 = Instant::now();
    core.play(StartRequest {
        key: streamonte_core::video_key::VideoKey::whole(magnet.info_hash),
        magnet: Some(magnet),
        player: Some(player),
        file_index: None,
        audio: None,
        background: false,
    })
    .await?;

    // Ctrl+C = Detener y borrar.
    let ctrl_c_core = core.clone();
    tokio::spawn(async move {
        if tokio::signal::ctrl_c().await.is_ok() {
            println!("Ctrl+C: deteniendo…");
            let _ = ctrl_c_core.stop_all_and_clean().await;
        }
    });

    while !summary.lock().unwrap().done {
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }

    let s = summary.lock().unwrap();
    let fmt = |v: Option<f32>| v.map_or("—".to_string(), |x| format!("{x:.1} s"));
    println!("\n===== resumen ({engine:?}) =====");
    if let Some(row) = &s.last_row {
        println!("archivo           {}", row.name);
        println!("metadatos         {}", fmt(row.metadata_secs));
        println!("precarga lista    {}", fmt(row.preload_secs));
        println!("primera imagen    {}", fmt(row.time_to_first_frame_secs));
    }
    println!(
        "cierre            {}",
        s.stop_line.as_deref().unwrap_or("—")
    );
    println!("tiempo total      {:.1} s", t0.elapsed().as_secs_f32());
    Ok(())
}
