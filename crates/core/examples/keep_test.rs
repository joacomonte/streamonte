//! Prueba de punta a punta de FR-12 (cambiado) y FR-12b, con el núcleo real y mpv.
//! Contenido legal (Sintel, Big Buck Bunny). Abre y cierra mpv solo.
//!
//! 1. Reproduce A (Sintel) hasta la primera imagen y mira ~20 s.
//! 2. Play a B (Big Buck Bunny) → A tiene que quedar "pausada" con su carpeta y minuto (FR-12b).
//! 3. Cierra todo (como cerrar la app) → B también queda pausada.
//! 4. Arranca un núcleo nuevo (como reabrir la app) → A y B vuelven al panel (load_kept).
//! 5. Retoma A → tiene que abrir mpv y reproducir.
//! 6. "Borrar todo" → no queda ninguna carpeta.
//!
//! `cargo run -p tstream-core --example keep_test`

use std::sync::{Arc, Mutex};
use std::time::Duration;

use tstream_core::app::{AppCore, StartOptions};
use tstream_core::events::{CoreEvent, EventSink};
use tstream_core::magnet::Magnet;
use tstream_core::playback::{OnAppClose, PlaybackAction, PlaybackState, StartRequest};

const SINTEL: &str = "magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel";
const BBB: &str = "magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny";

#[derive(Default)]
struct Log(Mutex<Vec<String>>);
struct Sink(Arc<Log>);
impl EventSink for Sink {
    fn emit(&self, event: CoreEvent) {
        if let CoreEvent::PlaybackLog { id, line } = event {
            println!("  [{}] {line}", id.0);
            self.0 .0.lock().unwrap().push(line);
        }
    }
}

async fn start_core() -> Arc<AppCore> {
    AppCore::start_with(
        Arc::new(Sink(Arc::default())),
        StartOptions {
            capture_clipboard: false,
            ..Default::default()
        },
    )
    .await
    .expect("núcleo")
}

async fn wait_for(core: &AppCore, what: &str, secs: u64, pred: impl Fn(&AppCore) -> bool) {
    for _ in 0..secs * 2 {
        if pred(core) {
            println!("✔ {what}");
            return;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    panic!("✘ timeout esperando: {what}");
}

fn state_of(core: &AppCore, hash: &str) -> Option<PlaybackState> {
    core.playbacks()
        .into_iter()
        .find(|r| r.info_hash.to_hex() == hash)
        .map(|r| r.state)
}

#[tokio::main]
async fn main() {
    let a = Magnet::parse(SINTEL).unwrap();
    let b = Magnet::parse(BBB).unwrap();
    let (ha, hb) = (a.info_hash.to_hex(), b.info_hash.to_hex());
    let req = |m: &Magnet| StartRequest {
        key: tstream_core::video_key::VideoKey::whole(m.info_hash),
        magnet: Some(m.clone()),
        player: None,
        file_index: None,
        audio: None,
        background: false,
    };

    println!("== 1. reproducir A ==");
    let core = start_core().await;
    core.play(req(&a)).await.unwrap();
    wait_for(&core, "A reproduciendo con primera imagen", 120, |c| {
        c.playbacks()
            .iter()
            .any(|r| r.info_hash.to_hex() == ha && r.time_to_first_frame_secs.is_some())
    })
    .await;
    tokio::time::sleep(Duration::from_secs(20)).await;

    println!("== 2. play a B → A pausada (FR-12b) ==");
    core.play(req(&b)).await.unwrap();
    wait_for(&core, "A pausada y guardada", 30, |c| {
        matches!(state_of(c, &ha), Some(PlaybackState::Paused { .. }))
    })
    .await;
    if let Some(PlaybackState::Paused { position_secs }) = state_of(&core, &ha) {
        println!("  A pausada en {position_secs:?} s");
        assert!(
            position_secs.unwrap_or(0.0) > 10.0,
            "tenía que recordar el minuto"
        );
    }
    wait_for(&core, "B reproduciendo", 120, |c| {
        c.playbacks()
            .iter()
            .any(|r| r.info_hash.to_hex() == hb && r.time_to_first_frame_secs.is_some())
    })
    .await;
    tokio::time::sleep(Duration::from_secs(8)).await;

    println!("== 3. cerrar la app ==");
    core.on_close(OnAppClose::StopAll).await.unwrap();
    wait_for(&core, "B también pausada", 30, |c| {
        matches!(state_of(c, &hb), Some(PlaybackState::Paused { .. }))
    })
    .await;
    drop(core);
    tokio::time::sleep(Duration::from_secs(2)).await;

    println!("== 4. reabrir la app ==");
    let core = start_core().await;
    let rows = core.playbacks();
    for r in &rows {
        println!(
            "  fila: {} · {:?} · {:.0} % bajado",
            r.name,
            r.state,
            r.progress * 100.0
        );
    }
    assert!(
        matches!(state_of(&core, &ha), Some(PlaybackState::Paused { .. })),
        "A tenía que volver"
    );
    assert!(
        matches!(state_of(&core, &hb), Some(PlaybackState::Paused { .. })),
        "B tenía que volver"
    );
    println!("✔ A y B volvieron como pausadas");

    println!("== 5. retomar A ==");
    let id_a = rows.iter().find(|r| r.info_hash.to_hex() == ha).unwrap().id;
    core.playback_action(id_a, PlaybackAction::ResumeDownload)
        .await
        .unwrap();
    wait_for(&core, "A retomada con imagen", 120, |c| {
        c.playbacks()
            .iter()
            .any(|r| r.info_hash.to_hex() == ha && r.time_to_first_frame_secs.is_some())
    })
    .await;
    tokio::time::sleep(Duration::from_secs(6)).await;

    println!("== 6. borrar todo ==");
    let report = core.stop_all_and_clean().await.unwrap();
    println!("  limpieza: {report:?}");
    wait_for(&core, "panel vacío", 30, |c| c.playbacks().is_empty()).await;
    // Solo cuentan las carpetas de A y B (otra app o herramienta abierta puede tener las suyas).
    let left = std::fs::read_dir(core.paths.downloads_dir())
        .map(|d| {
            d.filter_map(|e| e.ok())
                .filter(|e| {
                    let n = e.file_name().to_string_lossy().into_owned();
                    (n.starts_with(&ha) || n.starts_with(&hb))
                        && e.path().join(".tstream-kept.json").exists()
                })
                .count()
        })
        .unwrap_or(0);
    println!("  pausadas de A/B que quedaron: {left}");
    assert_eq!(left, 0, "Borrar todo tenía que borrar las pausadas");
    println!("\nKEEP TEST OK");
}
