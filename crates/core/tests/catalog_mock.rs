//! T-31 (spec 09 §12.2): fan-out con un addon rápido, uno lento y uno caído, con un servidor
//! HTTP local (sin red real). Solo títulos legales: Sintel `tt1727587`.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use streamonte_core::catalog::addons::Addon;
use streamonte_core::catalog::aggregate::{run, AddonState, RunCtx, StreamsUpdate};
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
                        tokio::time::sleep(Duration::from_secs(30)).await;
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
        },
        url,
    ))
}

#[tokio::test]
async fn t31_rapido_lento_y_caido() {
    let base = serve().await;
    let updates: Arc<Mutex<Vec<(Duration, StreamsUpdate)>>> = Arc::default();
    let t0 = Instant::now();
    let ctx = RunCtx {
        http: Http::new(Duration::from_secs(2)),
        addons: vec![
            addon(&base, "fast", 2_000),
            addon(&base, "slow", 1_500),
            addon(&base, "down", 2_000),
        ],
        video: VideoId::parse("tt1727587").unwrap(),
        kind: MediaKind::Movie,
        audio_order: streamonte_core::config::CatalogConfig::default().audio_order,
        exclude_cam: true,
        default_timeout: Duration::from_secs(10),
        trackers: vec![], // sin trackers: el scrape vuelve vacío al instante, sin red
        scrape_timeout: Duration::from_millis(200),
        latest: Arc::default(),
    };
    let sink = updates.clone();
    run(ctx, move |u| sink.lock().unwrap().push((t0.elapsed(), u))).await;
    let total = t0.elapsed();
    let updates = updates.lock().unwrap();

    // Primeros resultados (del rápido) en < 1 s, sin esperar al lento.
    let first = updates
        .iter()
        .find(|(_, u)| !u.candidates.is_empty())
        .expect("algún candidato");
    assert!(
        first.0 < Duration::from_secs(1),
        "primera fila a los {:?}",
        first.0
    );
    // Total ≤ timeout del más lento (+ margen), no los 30 s del mock.
    assert!(total < Duration::from_secs(4), "total {total:?}");

    let (_, last) = updates.last().unwrap();
    assert!(last.done);
    let state = |id: &str| last.addons.iter().find(|a| a.id == id).unwrap();
    assert_eq!(state("fast").state, AddonState::Ok);
    assert_eq!(state("slow").state, AddonState::Error);
    assert_eq!(
        state("slow").message.as_deref(),
        Some("sin respuesta (timeout)")
    );
    assert_eq!(state("down").state, AddonState::Error);
    // FR-45: el stream `url` se descartó; el torrent llegó una vez.
    assert_eq!(last.candidates.len(), 1);
    assert_eq!(last.candidates[0].seeders_declared, Some(40));
    assert_eq!(last.candidates[0].info_hash.to_hex(), SINTEL_HASH);
}
