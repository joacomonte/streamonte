//! Smoke del TorBox de Streamonte contra la web de PRODUCCIÓN (2026-11-23): recorre lo que hace el desktop por el
//! proxy (`checkcached` → `createtorrent` → `mylist` → `streamonte/tracks`) con un torrent legal en caché (Sintel).
//! Ningún test pegaba al proxy como lo hace reqwest: la CSRF de la web rechazaba el POST y nadie se enteró.
//! Red real y el código de la web guardado (en debug: `dev-secrets.json`), por eso `#[ignore]`. Correrlo después de
//! cada deploy de la web y antes de publicar el desktop:
//! `cargo nextest run -p streamonte-core --run-ignored all torbox_proxy_smoke`.

use std::time::Duration;

use streamonte_core::catalog::http::Http;
use streamonte_core::catalog::torbox;
use streamonte_core::magnet::InfoHash;

const SINTEL: &str = "08ada5a7a6183aae1e09d831df6748d566095a10";
const T: Duration = Duration::from_secs(40);

#[tokio::test]
#[ignore = "network"]
async fn flujo_del_desktop_por_el_proxy_de_la_web() {
    torbox::set_shared(true);
    assert!(
        torbox::usable(),
        "falta el código de la web: guardalo en Ajustes del desktop (debug) antes de correr el smoke"
    );
    let http = Http::new(Duration::from_secs(10));
    let hash = InfoHash::parse(SINTEL).unwrap();

    let cached = torbox::cached(&http, &[hash], T)
        .await
        .expect("checkcached por el proxy")
        .expect("checkcached sin respuesta (¿proxy caído?)");
    assert!(
        cached.hashes.contains(&hash),
        "Sintel dejó de estar en la caché de TorBox: cambiar el hash del smoke"
    );

    // createtorrent (POST multipart: el que rompía la CSRF) → mylist → streamonte/tracks. Sintel es MP4: la ruta de
    // pistas contesta 422 y queda `None`; lo que importa es que toda la cadena responda.
    let magnet = format!("magnet:?xt=urn:btih:{SINTEL}");
    let (_tracks, link) = torbox::header_tracks(&http, &magnet, T)
        .await
        .expect("createtorrent / mylist / tracks por el proxy");
    assert!(
        link.is_none(),
        "por el proxy el link con la key nunca llega al desktop"
    );
}
