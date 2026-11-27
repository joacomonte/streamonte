//! Smoke de TorBox con la key propia contra la API real (2026-11-23): recorre lo que hace el desktop al reproducir
//! (`checkcached` → `createtorrent` → `mylist` → `requestdl`) con un torrent legal en caché (Sintel) y verifica que el
//! link baja bytes. Red real y la key guardada (en debug: `dev-secrets.json`), por eso `#[ignore]`. Correrlo antes de
//! publicar el desktop: `cargo nextest run -p streamonte-core --run-ignored all torbox_smoke`.

use std::time::Duration;

use streamonte_core::catalog::http::Http;
use streamonte_core::catalog::torbox;
use streamonte_core::magnet::InfoHash;

const SINTEL: &str = "08ada5a7a6183aae1e09d831df6748d566095a10";
const T: Duration = Duration::from_secs(40);

#[tokio::test]
#[ignore = "network"]
async fn reproducir_por_torbox_con_key_propia() {
    assert!(
        torbox::has_key(),
        "falta la key de TorBox: guardala en Ajustes del desktop (debug) antes de correr el smoke"
    );
    let http = Http::new(Duration::from_secs(10));
    let hash = InfoHash::parse(SINTEL).unwrap();

    let cached = torbox::cached(&http, &[hash], T)
        .await
        .expect("checkcached")
        .expect("checkcached sin respuesta (¿key rechazada?)");
    assert!(
        cached.hashes.contains(&hash),
        "Sintel dejó de estar en la caché de TorBox: cambiar el hash del smoke"
    );

    let magnet = format!("magnet:?xt=urn:btih:{SINTEL}");
    let url = torbox::stream_url(&http, &magnet, torbox::Target::default(), T)
        .await
        .expect("createtorrent / mylist / requestdl");
    assert!(url.starts_with("https://"));
    let head = http
        .head_bytes(&url, 4096, T)
        .await
        .expect("el link de TorBox no baja");
    assert_eq!(head.len(), 4096);
}
