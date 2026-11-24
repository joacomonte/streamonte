//! "Verificar puerto entrante" (Ajustes, 2026-11-15): ¿pueden los peers de afuera conectarse a
//! esta PC? Solo se puede saber desde afuera: abre el puerto un momento como una reproducción
//! (escucha + UPnP, 2026-11-16; si no lo tiene ya una reproducción), espera la respuesta del
//! router y le pide a un servicio público de chequeo de puertos que intente conectarse.
//! Lo eligió el usuario sabiendo que manda la IP pública y el puerto a esos dos servicios.

use std::time::{Duration, Instant};

use crate::config::EngineConfig;
use crate::paths::AppPaths;

use serde::Serialize;

/// IP pública vista desde afuera (texto plano).
const PUBLIC_IP_URL: &str = "https://api.ipify.org";
/// Intenta conectarse a `host:port` desde internet y dice si respondió.
const PORT_CHECK_URL: &str = "https://portchecker.io/api/v1/query";
const TIMEOUT: Duration = Duration::from_secs(15);
/// Cuánto esperar la respuesta del router a UPnP (descubrirlo + pedir el reenvío).
const UPNP_WAIT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Serialize)]
pub struct IncomingCheck {
    pub port: u16,
    /// `Some(true)` abierto desde internet, `Some(false)` cerrado, `None` no se pudo probar.
    pub reachable: Option<bool>,
    /// UPnP prendido en Ajustes.
    pub upnp_on: bool,
    /// Respuesta del router: `Some(true)` aceptó el reenvío, `Some(false)` lo rechazó, `None` no
    /// respondió (sin UPnP en el router) o UPnP apagado.
    pub upnp: Option<bool>,
    /// IP de esta PC en la red de la casa: a dónde tiene que apuntar el reenvío del router.
    pub local_ip: Option<String>,
    /// Por qué no se pudo probar (en español), si pasó.
    pub problem: Option<String>,
}

pub async fn check(config: &EngineConfig, paths: &AppPaths) -> IncomingCheck {
    let port = config.listen_ports[0];
    let start = Instant::now();
    // Ocupado = casi seguro el motor de una reproducción: ya escucha y pidió UPnP.
    let busy = std::net::TcpListener::bind(("0.0.0.0", port)).is_err();
    let hold = if busy {
        None
    } else {
        crate::engine::hold_port(config, paths, port).await
    };
    // Sin rqbit (o si no pudo): escuchar a secas, sin UPnP.
    let listener = if busy || hold.is_some() {
        None
    } else {
        tokio::net::TcpListener::bind(("0.0.0.0", port)).await.ok()
    };
    let accepting = listener.map(|l| {
        tokio::spawn(async move {
            while let Ok((socket, _)) = l.accept().await {
                drop(socket);
            }
        })
    });
    let upnp = if config.upnp && (busy || hold.is_some()) {
        let since = (!busy).then_some(start);
        loop {
            let got = crate::activity::upnp_since(since);
            if got.is_some() || start.elapsed() >= UPNP_WAIT {
                break got;
            }
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
    } else {
        None
    };
    let result = probe(port).await;
    if let Some(task) = accepting {
        task.abort();
    }
    drop(hold);
    let (reachable, problem) = match result {
        Ok(open) => (Some(open), None),
        Err(e) => (None, Some(e)),
    };
    IncomingCheck {
        port,
        reachable,
        upnp_on: config.upnp,
        upnp,
        local_ip: local_ip(),
        problem,
    }
}

async fn probe(port: u16) -> std::result::Result<bool, String> {
    let offline = |_| "No se pudo probar: sin conexión con el servicio de chequeo.".to_string();
    let client = crate::http::client(crate::http::Kind::Api)
        .timeout(TIMEOUT)
        .build()
        .map_err(offline)?;
    let ip = client
        .get(PUBLIC_IP_URL)
        .send()
        .await
        .map_err(offline)?
        .text()
        .await
        .map_err(offline)?;
    let body = serde_json::json!({ "host": ip.trim(), "ports": [port] }).to_string();
    let answer = client
        .post(PORT_CHECK_URL)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(offline)?
        .text()
        .await
        .map_err(offline)?;
    parse(&answer, port)
}

/// `{"error":false,"check":[{"port":41850,"status":true}],...}` → si respondió.
fn parse(answer: &str, port: u16) -> std::result::Result<bool, String> {
    let v: serde_json::Value = serde_json::from_str(answer)
        .map_err(|_| "No se pudo probar: respuesta inesperada del servicio.".to_string())?;
    v["check"]
        .as_array()
        .and_then(|checks| {
            checks
                .iter()
                .find(|c| c["port"].as_u64() == Some(u64::from(port)))
        })
        .and_then(|c| c["status"].as_bool())
        .ok_or_else(|| "No se pudo probar: respuesta inesperada del servicio.".to_string())
}

/// IP local de la interfaz que sale a internet. `connect` de UDP no manda nada: solo elige ruta.
fn local_ip() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("1.1.1.1:80").ok()?;
    Some(socket.local_addr().ok()?.ip().to_string())
}

#[cfg(test)]
mod tests {
    use super::parse;

    #[test]
    fn lee_la_respuesta_del_servicio() {
        let ok = r#"{"error":false,"msg":null,"check":[{"port":41850,"status":true}],"host":"x"}"#;
        let closed =
            r#"{"error":false,"msg":null,"check":[{"port":41850,"status":false}],"host":"x"}"#;
        assert_eq!(parse(ok, 41850), Ok(true));
        assert_eq!(parse(closed, 41850), Ok(false));
        assert!(parse("<html>", 41850).is_err());
        assert!(parse(ok, 1234).is_err());
    }
}
