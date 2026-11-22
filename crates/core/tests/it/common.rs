//! Piezas compartidas por las pruebas de integración.

use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use streamonte_core::cleanup::{OwnerRecord, OWNER_FILE};
use streamonte_core::events::{CoreEvent, EventSink};
use streamonte_core::paths::AppPaths;
use tokio::sync::mpsc;

pub const SINTEL: &str = "magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel";
pub const BBB: &str =
    "magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny";
pub const TOS: &str =
    "magnet:?xt=urn:btih:209c8226b299b308beaf2b9cd3fb49212dbd13ec&dn=Tears+of+Steel";

/// Carpeta temporal única que se borra sola al soltarse (también si la prueba falla).
pub struct TempRoot(PathBuf);

impl TempRoot {
    pub fn new(name: &str) -> Self {
        static N: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "streamonte-it-{name}-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    /// Carpetas de la app bajo esta raíz, ya creadas.
    pub fn app_paths(&self) -> AppPaths {
        let paths = AppPaths::under(&self.0);
        paths.ensure_dirs().unwrap();
        paths
    }
}

impl Deref for TempRoot {
    type Target = Path;
    fn deref(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Registro de dueño en `dir` con ese pid (un pid inexistente = dueño muerto).
pub fn write_owner(dir: &Path, app_pid: u32) {
    let owner = OwnerRecord {
        app_pid,
        engine_pid: None,
        player_pid: None,
        started_at: chrono::Utc::now(),
    };
    std::fs::write(dir.join(OWNER_FILE), serde_json::to_vec(&owner).unwrap()).unwrap();
}

/// Sink de prueba: reenvía cada evento por un canal para esperarlos sin sondear.
pub struct ChannelSink(mpsc::UnboundedSender<CoreEvent>);

pub fn channel_sink() -> (ChannelSink, mpsc::UnboundedReceiver<CoreEvent>) {
    let (tx, rx) = mpsc::unbounded_channel();
    (ChannelSink(tx), rx)
}

impl EventSink for ChannelSink {
    fn emit(&self, event: CoreEvent) {
        let _ = self.0.send(event);
    }
}

/// Espera (hasta 10 s, solo anti-cuelgue) el primer evento que cumpla `pred`.
pub async fn wait_event(
    rx: &mut mpsc::UnboundedReceiver<CoreEvent>,
    pred: impl Fn(&CoreEvent) -> bool,
) -> CoreEvent {
    tokio::time::timeout(Duration::from_secs(10), async {
        while let Some(e) = rx.recv().await {
            if pred(&e) {
                return e;
            }
        }
        panic!("el canal de eventos se cerró");
    })
    .await
    .expect("el evento esperado no llegó")
}
