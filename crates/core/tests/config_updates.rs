//! La config tiene una sola escritura (`AppCore::update_config`): cambios a la vez no se pisan,
//! ni con un "Agregar addon" esperando la red (servidor HTTP local, sin red real).

use std::sync::Arc;
use std::time::Duration;

use streamonte_core::app::{AppCore, StartOptions};
use streamonte_core::config::ConfigStore;
use streamonte_core::events::NullSink;
use streamonte_core::paths::AppPaths;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// Manifest que tarda 500 ms: el alta del addon queda "en vuelo" mientras se cambian ajustes.
async fn slow_manifest_server() -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        while let Ok((mut sock, _)) = listener.accept().await {
            tokio::spawn(async move {
                let mut buf = vec![0u8; 4096];
                let _ = sock.read(&mut buf).await;
                tokio::time::sleep(Duration::from_millis(500)).await;
                let body = r#"{"id":"lento","name":"Lento","version":"1","resources":["stream"],"types":["movie"],"idPrefixes":["tt"]}"#;
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = sock.write_all(resp.as_bytes()).await;
            });
        }
    });
    format!("http://{addr}/manifest.json")
}

// Un solo AppCore por proceso (el logger es global).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cambios_de_config_a_la_vez_no_se_pisan() {
    let root = std::env::temp_dir().join(format!("streamonte-acc-config-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let paths = AppPaths::under(&root);
    paths.ensure_dirs().unwrap();
    let core = AppCore::start_with(
        Arc::new(NullSink),
        StartOptions {
            capture_clipboard: false,
            paths: Some(paths.clone()),
        },
    )
    .await
    .unwrap();

    // 1. Muchos cambios de campos distintos a la vez: quedan todos, en memoria y en disco.
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
    let (a, b) = (core.clone(), core.clone());
    tasks.push(tokio::spawn(async move {
        a.set_network(false, true, true).await.unwrap()
    }));
    tasks.push(tokio::spawn(async move {
        b.catalog_set_exclude_japanese(false).await.unwrap()
    }));
    for t in tasks {
        t.await.unwrap();
    }
    let disk = ConfigStore::new(&paths).load().unwrap();
    assert_eq!(disk, saved_part(&core).await, "disco = memoria");
    for i in 0..20 {
        assert!(
            disk.trackers.contains(&format!("udp://t{i}:1/announce")),
            "tracker {i}"
        );
    }
    assert!(!disk.engine.incoming && disk.engine.upnp);
    assert!(!disk.catalog.exclude_japanese);

    // 2. "Agregar addon" esperando el manifest + "Sin anime" y Red cambiados mientras tanto:
    //    el alta no revierte esos ajustes (antes guardaba su copia vieja de la config).
    let url = slow_manifest_server().await;
    let adder = core.clone();
    let add = tokio::spawn(async move { adder.catalog_add_addon(&url).await });
    tokio::time::sleep(Duration::from_millis(100)).await;
    core.catalog_set_exclude_japanese(true).await.unwrap();
    core.set_network(true, false, true).await.unwrap();
    let view = add.await.unwrap().unwrap();
    let disk = ConfigStore::new(&paths).load().unwrap();
    assert!(disk.catalog.exclude_japanese, "el toggle no se revierte");
    assert!(disk.engine.incoming && !disk.engine.upnp);
    assert!(disk.catalog.addons.iter().any(|a| a.id == view.id));
    assert_eq!(disk.trackers.len(), core.config().await.trackers.len());

    // 3. Cambiar uno no toca otro: deshabilitar el addon deja Red y "Sin anime" como estaban.
    core.catalog_set_addon_enabled(&view.id, false)
        .await
        .unwrap();
    let after = ConfigStore::new(&paths).load().unwrap();
    assert_eq!(
        (after.engine.clone(), after.catalog.exclude_japanese),
        (disk.engine.clone(), true)
    );
    core.catalog_remove_addon(&view.id).await.unwrap();
    assert!(core
        .catalog_set_addon_enabled(&view.id, true)
        .await
        .is_err());
    assert_eq!(
        ConfigStore::new(&paths).load().unwrap(),
        saved_part(&core).await
    );

    drop(core);
    let _ = std::fs::remove_dir_all(root);
}

/// La config en memoria sin lo que nunca se guarda: `shared_trackers` se baja de fondo al abrir y
/// puede llegar en cualquier momento del test (en CI suele llegar).
async fn saved_part(core: &AppCore) -> streamonte_core::config::Config {
    let mut c = core.config().await;
    c.shared_trackers.clear();
    c
}
