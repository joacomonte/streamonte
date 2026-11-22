//! T-31 (spec 09 §12.2): fan-out con un addon rápido, uno lento y uno caído, con un servidor
//! HTTP local (sin red real). Solo títulos legales: Sintel `tt1727587`.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use streamonte_core::catalog::addons::Addon;
use streamonte_core::catalog::aggregate::{run_offline, AddonState, RunCtx, StreamsUpdate};
use streamonte_core::catalog::http::Http;
use streamonte_core::catalog::{MediaKind, VideoId};
use streamonte_core::config::AddonEntry;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const MANIFEST: &str = r#"{"id":"mock","name":"Mock","version":"1","resources":["stream"],"types":["movie","series"],"idPrefixes":["tt"]}"#;
const SINTEL_HASH: &str = "08ada5a7a6183aae1e09d831df6748d566095a10";

async fn serve() -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let Ok((mut sock, _)) = listener.accept().await else {
                return;
            };
            tokio::spawn(async move {
                let mut buf = vec![0u8; 4096];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let path = req.split_whitespace().nth(1).unwrap_or("/").to_string();
                let (status, body) = if path.starts_with("/down/") {
                    ("503 Service Unavailable", String::new())
                } else if path.ends_with("/manifest.json") {
                    ("200 OK", MANIFEST.to_string())
                } else {
                    if path.starts_with("/slow/") {
                        std::future::pending::<()>().await; // nunca responde
                    }
                    let title = if path.starts_with("/fast/") {
                        "Sintel.2010.1080p.WEB\\n👤 40 💾 700 MB ⚙️ Mock"
                    } else {
                        "Sintel 720p"
                    };
                    (
                        "200 OK",
                        format!(
                            r#"{{"streams":[{{"name":"Mock","title":"{title}","infoHash":"{SINTEL_HASH}"}},{{"url":"https://x/y.mp4"}}]}}"#
                        ),
                    )
                };
                let resp = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = sock.write_all(resp.as_bytes()).await;
            });
        }
    });
    format!("http://{addr}")
}

fn addon(base: &str, name: &str, timeout_ms: u64) -> Arc<Addon> {
    let url = format!("{base}/{name}/manifest.json");
    Arc::new(Addon::new(
        AddonEntry {
            id: name.into(),
            name: name.into(),
            url: Some(url.clone()),
            display_url: url.clone(),
            secret: false,
            enabled: true,
            timeout_ms: Some(timeout_ms),
            kind: streamonte_core::config::SourceKind::Stremio,
        },
        url,
    ))
}

/// Contexto de la consulta: sin trackers (el scrape vuelve vacío al instante, sin red).
fn ctx(base: &str, names_and_timeouts: &[(&str, u64)]) -> RunCtx {
    RunCtx {
        http: Http::new(Duration::from_secs(2)),
        addons: names_and_timeouts
            .iter()
            .map(|(name, ms)| addon(base, name, *ms))
            .collect(),
        video: VideoId::parse("tt1727587").unwrap(),
        kind: MediaKind::Movie,
        audio_order: streamonte_core::config::CatalogConfig::default().audio_order,
        exclude_cam: true,
        default_timeout: Duration::from_secs(10),
        trackers: vec![],
        scrape_timeout: Duration::from_millis(200),
        latest: Arc::default(),
    }
}

/// Corre la consulta y devuelve todas las actualizaciones; el plazo de 5 s solo evita un cuelgue.
async fn collect(ctx: RunCtx) -> Vec<StreamsUpdate> {
    let updates: Arc<Mutex<Vec<StreamsUpdate>>> = Arc::default();
    let sink = updates.clone();
    tokio::time::timeout(
        Duration::from_secs(5),
        run_offline(ctx, move |u| sink.lock().unwrap().push(u)),
    )
    .await
    .expect("la consulta no terminó");
    let out = updates.lock().unwrap().clone();
    out
}

fn state<'a>(
    u: &'a StreamsUpdate,
    id: &str,
) -> &'a streamonte_core::catalog::aggregate::AddonStatus {
    u.addons.iter().find(|a| a.id == id).unwrap()
}

// Tiempo real: con `start_paused` el reloj salta mientras hay TCP en vuelo y falla ~1 de cada 8.
// El plazo del lento (500 ms) es mayor que el tick de 250 ms, para ver su estado "pendiente".
#[tokio::test]
async fn t31_rapido_lento_y_caido() {
    let base = serve().await;
    let updates = collect(ctx(
        &base,
        &[("fast", 2_000), ("slow", 500), ("down", 2_000)],
    ))
    .await;

    // Los primeros resultados (del rápido) salen con el lento todavía pendiente.
    let first = updates
        .iter()
        .find(|u| !u.candidates.is_empty())
        .expect("algún candidato");
    assert_eq!(state(first, "slow").state, AddonState::Pending);
    assert!(!first.done);

    let last = updates.last().unwrap();
    assert!(last.done);
    assert_eq!(state(last, "fast").state, AddonState::Ok);
    assert_eq!(state(last, "slow").state, AddonState::Error);
    assert_eq!(
        state(last, "slow").message.as_deref(),
        Some("sin respuesta (timeout)")
    );
    assert_eq!(state(last, "down").state, AddonState::Error);
    let down_msg = state(last, "down").message.clone().unwrap();
    assert!(down_msg.contains("error HTTP 503"), "{down_msg}");
    // FR-45: el stream `url` se descartó; el torrent llegó una vez.
    assert_eq!(last.candidates.len(), 1);
    assert_eq!(last.candidates[0].seeders_declared, Some(40));
    assert_eq!(last.candidates[0].info_hash.to_hex(), SINTEL_HASH);
}

/// Tracker UDP falso mínimo (BEP 15): responde connect y scrape con seeders = 7 para todo hash.
async fn udp_tracker() -> String {
    let socket = tokio::net::UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let addr = socket.local_addr().unwrap();
    tokio::spawn(async move {
        let mut buf = [0u8; 2048];
        while let Ok((n, from)) = socket.recv_from(&mut buf).await {
            let action = u32::from_be_bytes(buf[8..12].try_into().unwrap());
            let mut resp = Vec::new();
            resp.extend_from_slice(&action.to_be_bytes());
            resp.extend_from_slice(&buf[12..16]);
            match action {
                0 => resp.extend_from_slice(&42u64.to_be_bytes()),
                2 => {
                    for _ in buf[16..n].chunks_exact(20) {
                        for v in [7u32, 1, 0] {
                            resp.extend_from_slice(&v.to_be_bytes());
                        }
                    }
                }
                _ => continue,
            }
            let _ = socket.send_to(&resp, from).await;
        }
    });
    format!("udp://{addr}/announce")
}

/// El candidato que llega con el último addon también se scrapea, y la consulta termina apenas
/// no queda nada pendiente, sin esperar al próximo tick de 250 ms (tiempo real: es lo que se mide).
#[tokio::test]
async fn el_ultimo_candidato_se_scrapea_y_termina_sin_esperar_el_tick() {
    let base = serve().await;
    let mut c = ctx(&base, &[("fast", 2_000)]);
    c.trackers = vec![udp_tracker().await];
    c.scrape_timeout = Duration::from_secs(1);
    let t0 = std::time::Instant::now();
    let updates = collect(c).await;
    let elapsed = t0.elapsed();

    let last = updates.last().unwrap();
    assert!(last.done);
    assert_eq!(last.candidates.len(), 1);
    assert_eq!(last.candidates[0].seeders, Some(7), "se scrapeó el último");
    assert!(
        elapsed < Duration::from_millis(200),
        "esperó al tick: {elapsed:?}"
    );
}
