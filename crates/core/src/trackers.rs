//! `trackers` — scrape UDP en lote (FR-05, BEP 15). < 10 s para toda la lista.
//!
//! Por tracker: connect → scrape con hasta 74 hashes por paquete. Todos los trackers en
//! paralelo con un plazo común. Se toma el MÁXIMO de seeders/leechers entre trackers.
//! Ojo (ADR-09): los trackers pueden mentir; esto solo pre-filtra, el ranking usa la medición en vivo.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::net::UdpSocket;
use tokio::time::Instant;

use crate::magnet::InfoHash;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScrapeResult {
    pub seeders: u32,
    pub leechers: u32,
    pub completed: u32,
    /// Trackers que respondieron (de los consultados).
    pub trackers_ok: u32,
    pub scraped_at: DateTime<Utc>,
}

/// BEP 15: constante mágica del pedido `connect`.
const PROTOCOL_ID: u64 = 0x0417_2710_1980;
const ACTION_CONNECT: u32 = 0;
const ACTION_SCRAPE: u32 = 2;
const ACTION_ERROR: u32 = 3;
/// BEP 15: como máximo ~74 hashes por scrape (límite de tamaño de paquete).
const MAX_HASHES_PER_PACKET: usize = 74;
/// Reenvío si no hubo respuesta (UDP pierde paquetes). El plazo total lo pone el llamador.
const RETRANSMIT_EVERY: Duration = Duration::from_millis(2_000);

/// Contadores de un hash según UN tracker.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Counts {
    seeders: u32,
    completed: u32,
    leechers: u32,
}

/// Scrape en lote. Solo trackers `udp://`; los demás se ignoran.
/// Hashes sin respuesta de ningún tracker no aparecen en el resultado.
/// Nunca tarda más que `timeout` (los trackers lentos o caídos se descartan).
pub async fn scrape_batch(
    hashes: &[InfoHash],
    trackers: &[String],
    timeout: Duration,
) -> HashMap<InfoHash, ScrapeResult> {
    let mut out: HashMap<InfoHash, ScrapeResult> = HashMap::new();
    if hashes.is_empty() {
        return out;
    }
    let deadline = Instant::now() + timeout;
    let mut tasks = tokio::task::JoinSet::new();
    for url in trackers.iter().filter(|t| udp_host_port(t).is_some()) {
        let url = url.clone();
        let hashes = hashes.to_vec();
        tasks.spawn(async move {
            // `found` vive fuera del plazo: las tandas que ya respondieron no se pierden.
            let mut found = Vec::new();
            let result =
                tokio::time::timeout_at(deadline, scrape_tracker(&url, &hashes, &mut found)).await;
            match result {
                Ok(Ok(())) => {}
                Ok(Err(e)) => tracing::debug!(tracker = url, "scrape falló: {e}"),
                Err(_) => tracing::debug!(tracker = url, "scrape sin respuesta a tiempo"),
            }
            found
        });
    }

    let now = Utc::now();
    while let Some(joined) = tasks.join_next().await {
        let Ok(found) = joined else { continue };
        for (hash, c) in found {
            let r = out.entry(hash).or_insert(ScrapeResult {
                seeders: 0,
                leechers: 0,
                completed: 0,
                trackers_ok: 0,
                scraped_at: now,
            });
            r.seeders = r.seeders.max(c.seeders);
            r.leechers = r.leechers.max(c.leechers);
            r.completed = r.completed.max(c.completed);
            r.trackers_ok += 1;
        }
    }
    out
}

/// `udp://host:port/announce` → `host:port`.
fn udp_host_port(url: &str) -> Option<&str> {
    let rest = url
        .get(..6)?
        .eq_ignore_ascii_case("udp://")
        .then(|| &url[6..])?;
    let host_port = rest.split(['/', '?']).next()?;
    (!host_port.is_empty() && host_port.contains(':')).then_some(host_port)
}

/// Va sumando a `found` cada tanda que responde (si después falla o vence, lo anterior queda).
async fn scrape_tracker(
    url: &str,
    hashes: &[InfoHash],
    found: &mut Vec<(InfoHash, Counts)>,
) -> std::io::Result<()> {
    let host_port = udp_host_port(url).ok_or_else(|| invalid("URL de tracker inválida"))?;
    let addrs: Vec<SocketAddr> = tokio::net::lookup_host(host_port).await?.collect();
    // IPv4 primero: muchos trackers publican AAAA que no responden.
    let addr = addrs
        .iter()
        .find(|a| a.is_ipv4())
        .or_else(|| addrs.first())
        .copied()
        .ok_or_else(|| invalid("el tracker no resolvió a ninguna IP"))?;
    let bind: SocketAddr = if addr.is_ipv4() {
        "0.0.0.0:0".parse().expect("addr")
    } else {
        "[::]:0".parse().expect("addr")
    };
    let socket = UdpSocket::bind(bind).await?;
    socket.connect(addr).await?;

    // connect → connection_id
    let tid = transaction_id();
    let mut req = Vec::with_capacity(16);
    req.extend_from_slice(&PROTOCOL_ID.to_be_bytes());
    req.extend_from_slice(&ACTION_CONNECT.to_be_bytes());
    req.extend_from_slice(&tid.to_be_bytes());
    let resp = transact(&socket, &req, tid, ACTION_CONNECT, 16).await?;
    let connection_id: [u8; 8] = resp[8..16].try_into().expect("8 bytes");

    // scrape por tandas de 74
    for chunk in hashes.chunks(MAX_HASHES_PER_PACKET) {
        let tid = transaction_id();
        let mut req = Vec::with_capacity(16 + 20 * chunk.len());
        req.extend_from_slice(&connection_id);
        req.extend_from_slice(&ACTION_SCRAPE.to_be_bytes());
        req.extend_from_slice(&tid.to_be_bytes());
        for h in chunk {
            req.extend_from_slice(h.as_bytes());
        }
        let resp = transact(&socket, &req, tid, ACTION_SCRAPE, 8).await?;
        // Algunos trackers devuelven menos entradas que hashes pedidos: se toma lo que vino.
        for (hash, block) in chunk.iter().zip(resp[8..].chunks_exact(12)) {
            found.push((
                *hash,
                Counts {
                    seeders: be_u32(&block[0..4]),
                    completed: be_u32(&block[4..8]),
                    leechers: be_u32(&block[8..12]),
                },
            ));
        }
    }
    Ok(())
}

/// Envía `req` y espera la respuesta con el mismo `transaction_id`; reenvía cada 2 s.
async fn transact(
    socket: &UdpSocket,
    req: &[u8],
    tid: u32,
    action: u32,
    min_len: usize,
) -> std::io::Result<Vec<u8>> {
    let mut buf = vec![0u8; 2048];
    loop {
        socket.send(req).await?;
        let wait_until = Instant::now() + RETRANSMIT_EVERY;
        loop {
            let n = match tokio::time::timeout_at(wait_until, socket.recv(&mut buf)).await {
                Ok(r) => r?,
                Err(_) => break, // reenviar
            };
            if n < 8 || be_u32(&buf[4..8]) != tid {
                continue; // respuesta vieja o ajena
            }
            let got = be_u32(&buf[0..4]);
            if got == ACTION_ERROR {
                let message = String::from_utf8_lossy(&buf[8..n]).into_owned();
                return Err(std::io::Error::other(format!("tracker: {message}")));
            }
            if got == action && n >= min_len {
                return Ok(buf[..n].to_vec());
            }
        }
    }
}

fn transaction_id() -> u32 {
    // Sin dependencia de `rand`: contador + reloj alcanza para distinguir respuestas.
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.subsec_nanos());
    nanos ^ COUNTER.fetch_add(0x9E37_79B9, Ordering::Relaxed)
}

fn be_u32(b: &[u8]) -> u32 {
    u32::from_be_bytes(b[..4].try_into().expect("4 bytes"))
}

fn invalid(msg: &str) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidInput, msg.to_string())
}

#[cfg(test)]
pub(crate) mod fake {
    //! Tracker UDP falso (BEP 15) para pruebas sin red (06-C).
    use super::*;

    /// Responde connect/scrape. Para cada hash devuelve seeders = 1er byte × `factor`,
    /// leechers = 2º byte, completed = 3er byte. `drop_first` = ignora el primer paquete
    /// (prueba el reenvío).
    pub async fn spawn(factor: u32, drop_first: bool) -> String {
        let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let addr = socket.local_addr().unwrap();
        tokio::spawn(async move {
            let mut buf = [0u8; 2048];
            let mut dropped = !drop_first;
            loop {
                let Ok((n, from)) = socket.recv_from(&mut buf).await else {
                    return;
                };
                if !dropped {
                    dropped = true;
                    continue;
                }
                let action = be_u32(&buf[8..12]);
                let tid = &buf[12..16];
                let mut resp = Vec::new();
                if action == ACTION_CONNECT && n == 16 {
                    resp.extend_from_slice(&ACTION_CONNECT.to_be_bytes());
                    resp.extend_from_slice(tid);
                    resp.extend_from_slice(&0x1122_3344_5566_7788u64.to_be_bytes());
                } else if action == ACTION_SCRAPE {
                    assert_eq!(&buf[0..8], &0x1122_3344_5566_7788u64.to_be_bytes());
                    resp.extend_from_slice(&ACTION_SCRAPE.to_be_bytes());
                    resp.extend_from_slice(tid);
                    for hash in buf[16..n].chunks_exact(20) {
                        resp.extend_from_slice(&(u32::from(hash[0]) * factor).to_be_bytes());
                        resp.extend_from_slice(&u32::from(hash[2]).to_be_bytes());
                        resp.extend_from_slice(&u32::from(hash[1]).to_be_bytes());
                    }
                } else {
                    continue;
                }
                let _ = socket.send_to(&resp, from).await;
            }
        });
        format!("udp://{addr}/announce")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hash(seeders: u8, leechers: u8) -> InfoHash {
        let mut b = [7u8; 20];
        b[0] = seeders;
        b[1] = leechers;
        b[2] = 9;
        InfoHash::from_bytes(b)
    }

    #[test]
    fn solo_trackers_udp() {
        assert_eq!(
            udp_host_port("udp://tracker.opentrackr.org:1337/announce"),
            Some("tracker.opentrackr.org:1337")
        );
        assert_eq!(udp_host_port("UDP://1.2.3.4:80"), Some("1.2.3.4:80"));
        assert_eq!(udp_host_port("wss://tracker.webtorrent.dev"), None);
        assert_eq!(udp_host_port("udp://sinpuerto/announce"), None);
    }

    #[tokio::test]
    async fn lote_grande_varios_paquetes_y_maximo_entre_trackers() {
        let a = fake::spawn(1, false).await;
        let b = fake::spawn(2, true).await; // pierde el primer paquete → reenvío
        let mut hashes: Vec<InfoHash> = (0..100u8).map(|i| hash(i, i / 2)).collect();
        hashes[0] = hash(5, 3);
        let trackers = vec![a, b, "wss://ignorado".to_string()];
        let started = std::time::Instant::now();
        let r = scrape_batch(&hashes, &trackers, Duration::from_secs(8)).await;
        assert!(started.elapsed() < Duration::from_secs(8));
        assert_eq!(r.len(), 100, "100 hashes → 2 paquetes (74 + 26)");
        let first = &r[&hashes[0]];
        assert_eq!((first.seeders, first.leechers, first.completed), (10, 3, 9));
        assert_eq!(first.trackers_ok, 2);
        assert_eq!(r[&hashes[99]].seeders, 198);
    }

    #[tokio::test]
    async fn tandas_respondidas_quedan_aunque_la_siguiente_venza() {
        // Responde el connect y SOLO el primer scrape (74 hashes); el segundo nunca.
        let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let url = format!("udp://{}/announce", socket.local_addr().unwrap());
        tokio::spawn(async move {
            let mut buf = [0u8; 2048];
            let mut scrapes = 0;
            while let Ok((n, from)) = socket.recv_from(&mut buf).await {
                let action = be_u32(&buf[8..12]);
                let mut resp = action.to_be_bytes().to_vec();
                resp.extend_from_slice(&buf[12..16]);
                if action == ACTION_CONNECT {
                    resp.extend_from_slice(&1u64.to_be_bytes());
                } else if scrapes == 0 {
                    scrapes += 1;
                    for h in buf[16..n].chunks_exact(20) {
                        resp.extend_from_slice(&u32::from(h[0]).to_be_bytes());
                        resp.extend_from_slice(&[0; 8]);
                    }
                } else {
                    continue;
                }
                let _ = socket.send_to(&resp, from).await;
            }
        });
        let hashes: Vec<InfoHash> = (0..100u8).map(|i| hash(i, 0)).collect();
        let r = scrape_batch(&hashes, &[url], Duration::from_millis(1500)).await;
        assert_eq!(r.len(), MAX_HASHES_PER_PACKET);
        assert_eq!(r[&hashes[73]].seeders, 73);
    }

    #[tokio::test]
    async fn tracker_mudo_no_supera_el_plazo() {
        // Un socket que nunca responde.
        let mute = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let url = format!("udp://{}/announce", mute.local_addr().unwrap());
        let started = std::time::Instant::now();
        let r = scrape_batch(&[hash(1, 1)], &[url], Duration::from_millis(1500)).await;
        assert!(r.is_empty());
        assert!(started.elapsed() < Duration::from_millis(2500));
    }
}
