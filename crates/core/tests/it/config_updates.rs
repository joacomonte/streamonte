//! La config tiene una sola escritura (`AppCore::update_config`): cambios a la vez no se pisan,
//! ni con un "Agregar addon" esperando la red (servidor HTTP local, sin red real).

use std::sync::Arc;

use streamonte_core::app::{AppCore, StartOptions};
use streamonte_core::config::ConfigStore;
use streamonte_core::paths::AppPaths;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, Notify};

use crate::common::{channel_sink, TempRoot};

/// Servidor de manifest que retiene la respuesta hasta que la prueba la libera: el alta del addon
/// queda "en vuelo" mientras se cambian ajustes, sin dormir un tiempo fijo.
struct HeldManifest {
    url: String,
    /// Llega un `()` cuando el servidor recibió un pedido.
    arrived: mpsc::UnboundedReceiver<()>,
    /// `notify_one()` deja salir una respuesta (el permiso queda guardado si aún no llegó el pedido).
    release: Arc<Notify>,
}

async fn held_manifest_server() -> HeldManifest {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (arrived_tx, arrived) = mpsc::unbounded_channel();
    let release = Arc::new(Notify::new());
    let gate = release.clone();
    tokio::spawn(async move {
        while let Ok((mut sock, _)) = listener.accept().await {
            let (arrived_tx, gate) = (arrived_tx.clone(), gate.clone());
            tokio::spawn(async move {
                let mut buf = vec![0u8; 4096];
                let _ = sock.read(&mut buf).await;
                let _ = arrived_tx.send(());
                gate.notified().await;
                let body = r#"{"id":"lento","name":"Lento","version":"1","resources":["stream"],"types":["movie"],"idPrefixes":["tt"]}"#;
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = sock.write_all(resp.as_bytes()).await;
            });
        }
    });
    HeldManifest {
        url: format!("http://{addr}/manifest.json"),
        arrived,
        release,
    }
}

/// Núcleo con carpetas propias y sin descargas de fondo (IMDb, trackers compartidos).
async fn start_core(root: &TempRoot) -> (Arc<AppCore>, AppPaths) {
    let paths = root.app_paths();
    let (sink, _events) = channel_sink();
    let core = AppCore::start_with(
        Arc::new(sink),
        StartOptions {
            capture_clipboard: false,
            paths: Some(paths.clone()),
            background_fetch: false,
        },
    )
    .await
    .unwrap();
    (core, paths)
}

/// Muchos cambios de campos distintos a la vez: quedan todos, en memoria y en disco.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cambios_de_config_a_la_vez_no_se_pisan() {
    let root = TempRoot::new("config-a");
    let (core, paths) = start_core(&root).await;
    let mut tasks = Vec::new();
    for i in 0..20u64 {
        let core = core.clone();
        tasks.push(tokio::spawn(async move {
            core.update_config(|c| {
                c.trackers.push(format!("udp://t{i}:1/announce"));
                Ok(())
            })
            .await
            .unwrap();
        }));
    }
    let a = core.clone();
    tasks.push(tokio::spawn(async move {
        a.set_network(false, true, true).await.unwrap()
    }));
    for t in tasks {
        t.await.unwrap();
    }
    let disk = ConfigStore::new(&paths).load().unwrap();
    assert_eq!(disk, core.config().await, "disco = memoria");
    for i in 0..20 {
        assert!(
            disk.trackers.contains(&format!("udp://t{i}:1/announce")),
            "tracker {i}"
        );
    }
    assert!(!disk.engine.incoming && disk.engine.upnp);
}

/// "Agregar addon" esperando el manifest + Red cambiada mientras tanto: el alta
/// no revierte esos ajustes (antes guardaba su copia vieja de la config).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn agregar_addon_no_revierte_ajustes_cambiados_en_vuelo() {
    let root = TempRoot::new("config-b");
    let (core, paths) = start_core(&root).await;
    let mut server = held_manifest_server().await;
    let adder = core.clone();
    let url = server.url.clone();
    let add = tokio::spawn(async move { adder.catalog_add_addon(&url).await });
    server
        .arrived
        .recv()
        .await
        .expect("el alta pidió el manifest");

    core.set_network(true, false, true).await.unwrap();
    server.release.notify_one();
    let view = add.await.unwrap().unwrap();

    let disk = ConfigStore::new(&paths).load().unwrap();
    assert!(disk.engine.incoming && !disk.engine.upnp);
    assert!(disk.catalog.addons.iter().any(|a| a.id == view.id));
    assert_eq!(disk, core.config().await, "disco = memoria");
}

/// Cambiar uno no toca otro: deshabilitar el addon deja Red como estaba; al
/// quitarlo, ya no se puede cambiar.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn habilitar_o_quitar_un_addon_no_toca_otros_ajustes() {
    let root = TempRoot::new("config-c");
    let (core, paths) = start_core(&root).await;
    let server = held_manifest_server().await;
    server.release.notify_one(); // responde apenas llegue el pedido
    let view = core.catalog_add_addon(&server.url).await.unwrap();
    core.set_network(true, false, true).await.unwrap();
    let before = ConfigStore::new(&paths).load().unwrap();

    core.catalog_set_addon_enabled(&view.id, false)
        .await
        .unwrap();
    let after = ConfigStore::new(&paths).load().unwrap();
    assert_eq!(after.engine, before.engine);
    assert!(!after
        .catalog
        .addons
        .iter()
        .any(|a| a.id == view.id && a.enabled));

    core.catalog_remove_addon(&view.id).await.unwrap();
    assert!(core
        .catalog_set_addon_enabled(&view.id, true)
        .await
        .is_err());
    assert_eq!(
        ConfigStore::new(&paths).load().unwrap(),
        core.config().await
    );
}
