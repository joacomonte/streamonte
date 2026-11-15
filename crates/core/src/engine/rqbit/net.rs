//! Red del motor rqbit (ADR-30): puerto de escucha, UPnP, dueño único del DHT persistente,
//! opciones de la sesión y las líneas de estado de red/peers para el log de Detalle.

use std::net::Ipv6Addr;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use librqbit::dht::DhtPersistenceConfig;
use librqbit::{
    DhtSessionConfig, ListenerMode, ListenerOptions, ManagedTorrent, SessionOptions,
    SessionPersistenceConfig,
};
use tokio::sync::broadcast;

use crate::config::EngineConfig;
use crate::engine::{EngineEvent, TorrentHandle};

/// Un solo motor por proceso guarda la tabla del DHT: librqbit escribe a `dht.json.tmp.<pid>`,
/// así que dos motores del mismo proceso se pisarían el temporal (ADR-30).
static DHT_OWNER: AtomicBool = AtomicBool::new(false);

pub(super) struct DhtLease;

impl DhtLease {
    pub(super) fn take() -> Option<Self> {
        (!DHT_OWNER.swap(true, Ordering::AcqRel)).then_some(Self)
    }
}

impl Drop for DhtLease {
    fn drop(&mut self) {
        DHT_OWNER.store(false, Ordering::Release);
    }
}

/// Primer puerto libre de `[a, b]`; 0 = que elija el SO. Se prueba en IPv4 e IPv6 porque
/// librqbit escucha en `[::]` doble pila.
pub(super) fn free_port([a, b]: [u16; 2]) -> u16 {
    (a.min(b)..=a.max(b))
        .find(|&p| {
            std::net::TcpListener::bind(("0.0.0.0", p)).is_ok()
                && std::net::TcpListener::bind((Ipv6Addr::UNSPECIFIED, p)).is_ok()
        })
        .unwrap_or(0)
}

pub(super) fn session_opts(
    config: &EngineConfig,
    listen_port: Option<u16>,
    dht_file: Option<&Path>,
    state_dir: &Path,
) -> SessionOptions {
    SessionOptions {
        dht: Some(DhtSessionConfig {
            // Solo en nuestra carpeta de caché; nunca en la ruta por defecto de librqbit.
            persistence: dht_file.map(|f| DhtPersistenceConfig {
                config_filename: Some(f.to_path_buf()),
                ..Default::default()
            }),
            ..Default::default()
        }),
        // Sin escucha, librqbit anuncia a los trackers un puerto falso (4240).
        listen: listen_port.map(|port| ListenerOptions {
            mode: if config.utp {
                ListenerMode::TcpAndUtp
            } else {
                ListenerMode::TcpOnly
            },
            listen_addr: (Ipv6Addr::UNSPECIFIED, port).into(),
            enable_upnp_port_forwarding: config.upnp,
            ..Default::default()
        }),
        // Persistencia solo para fastresume, en una carpeta propia de la instancia (vacía al
        // arrancar: no restaura torrents de otras). El bitfield real vive en la carpeta de datos.
        persistence: Some(SessionPersistenceConfig::Json {
            folder: Some(state_dir.to_path_buf()),
        }),
        fastresume: true,
        peer_limit: Some(config.max_connections as usize),
        ..Default::default()
    }
}

/// Estado de red de una reproducción para el log de Detalle: escucha (puerto real o por qué no)
/// y si el DHT se guarda. `fallback` = error de la sesión con escucha/DHT, si se reintentó sin.
pub(super) fn net_line(
    config: &EngineConfig,
    announce_port: Option<u16>,
    listen_port: Option<u16>,
    fallback: Option<&str>,
    dht_persistent: bool,
) -> String {
    let incoming = match announce_port {
        Some(port) => format!(
            "entrantes: escucha TCP{} en el puerto {port}{} · {}",
            if config.utp { "+uTP" } else { "" },
            if listen_port == Some(0) {
                format!(
                    " (los puertos {}–{} estaban ocupados: uno al azar)",
                    config.listen_ports[0], config.listen_ports[1]
                )
            } else {
                String::new()
            },
            if config.upnp {
                "UPnP pedido (resultado en el log general: \"successfully port forwarded\" o \"failed to forward port\")"
            } else {
                "UPnP apagado"
            }
        ),
        None if !config.incoming => {
            "entrantes: apagadas (engine.incoming = false); solo salientes".into()
        }
        None => format!(
            "entrantes: no se pudo escuchar, solo salientes ({})",
            fallback.unwrap_or("sin detalle")
        ),
    };
    let dht = if dht_persistent {
        "DHT persistente"
    } else {
        "DHT sin guardar (ya lo guarda otra reproducción o falló)"
    };
    format!("{incoming} · {dht}")
}

/// Para comparar antes/después (ADR-30). Un peer cuenta como entrante si alguna vez se conectó
/// él: librqbit no expone el sentido de la conexión actual.
fn peer_line(t: &ManagedTorrent) -> Option<(String, usize)> {
    let peers = t.live()?.per_peer_stats_snapshot(Default::default()).peers;
    let incoming = peers
        .values()
        .filter(|p| p.counters.incoming_connections > 0)
        .count();
    let mib_s = t
        .stats()
        .live
        .map(|l| l.download_speed.as_bytes() as f64 / 1_048_576.0)
        .unwrap_or_default();
    let line = format!(
        "peers: {} conectados ({incoming} entrantes, {} salientes) · {mib_s:.1} MiB/s",
        peers.len(),
        peers.len() - incoming
    );
    Some((line, incoming))
}

/// Reproducción: estado de red y peers cada 10 s al log de Detalle (ADR-30). No termina sola:
/// la tarea que la corre se aborta al quitar el torrent.
pub(super) async fn log_peers(
    torrent: Arc<ManagedTorrent>,
    handle: TorrentHandle,
    net_line: String,
    listening: bool,
    events: broadcast::Sender<EngineEvent>,
) {
    let log = |line| {
        let _ = events.send(EngineEvent::Log {
            handle: Some(handle),
            line,
        });
    };
    log(net_line);
    let mut tick = 0u32;
    loop {
        tick = tick.saturating_add(1);
        tokio::time::sleep(Duration::from_secs(10)).await;
        let Some((line, incoming)) = peer_line(&torrent) else {
            continue;
        };
        log(line);
        // Desde adentro no se distingue firewall, UPnP ausente o doble NAT: se avisa una vez.
        if listening && tick == 12 && incoming == 0 {
            log("entrantes: 0 en 2 min — firewall que bloquea, router sin UPnP o doble NAT; sigue solo con salientes".into());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{free_port, DhtLease};

    #[test]
    fn puerto_ocupado_salta_al_siguiente_o_al_azar() {
        let busy = std::net::TcpListener::bind(("0.0.0.0", 0)).unwrap();
        let p = busy.local_addr().unwrap().port();
        assert_eq!(free_port([p, p]), 0);
        assert_ne!(free_port([p, p.saturating_add(20)]), p);
    }

    #[test]
    fn un_solo_dueno_del_dht() {
        let first = DhtLease::take().expect("libre");
        assert!(DhtLease::take().is_none());
        drop(first);
        assert!(DhtLease::take().is_some());
    }
}
