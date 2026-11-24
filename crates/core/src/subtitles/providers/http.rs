//! Pedidos HTTP de los proveedores: sus clientes y límites sobre la mecánica compartida de
//! [`crate::http`] (errores tipados por estado: cada proveedor decide qué significa un 404 o un
//! 406 para él).

use std::sync::OnceLock;
use std::time::Duration;

use super::err;
use crate::http::Limits;
pub(super) use crate::http::{read_capped, send, HttpError};
use crate::Result;

const USER_AGENT: &str = concat!("Streamonte v", env!("CARGO_PKG_VERSION"));
const HTTP_TIMEOUT: Duration = Duration::from_secs(15);
/// Tope de una respuesta de proveedor: un subtítulo o su .zip/.rar pesa KB, no decenas de MB.
pub(super) const MAX_BODY_BYTES: usize = 20 * 1024 * 1024;
/// Solo el reintento ante `429` + `Retry-After`: un proveedor caído no se reintenta.
const LIMITS: Limits = Limits {
    max_body: MAX_BODY_BYTES,
    retry_transient: false,
};

pub(super) fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        crate::http::client(crate::http::Kind::Api)
            .user_agent(USER_AGENT)
            .timeout(HTTP_TIMEOUT)
            .build()
            .expect("cliente HTTP")
    })
}

/// Para el motor local (127.0.0.1): sin proxy y con más paciencia (puede faltar una pieza).
pub(super) fn local_http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        crate::http::client(crate::http::Kind::Download)
            .no_proxy()
            .timeout(Duration::from_secs(90))
            .build()
            .expect("cliente HTTP local")
    })
}

pub(super) async fn get_bytes(
    req: reqwest::RequestBuilder,
) -> std::result::Result<Vec<u8>, HttpError> {
    crate::http::get_bytes(req, LIMITS).await
}

/// Lee `[start, start+len)` del video por el servidor local del motor (para el hash).
pub(in crate::subtitles) async fn fetch_range(url: &str, start: u64, len: u64) -> Result<Vec<u8>> {
    if len == 0 {
        return Ok(Vec::new());
    }
    let req = local_http().get(url).header(
        reqwest::header::RANGE,
        format!("bytes={start}-{}", start + len - 1),
    );
    let resp = send(req).await.map_err(|e| super::http_err("motor", e))?;
    // Sin 206 el motor ignoró el Range: leer el cuerpo sería bajar el video entero a memoria.
    if resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(err(
            "motor",
            format!(
                "pedido parcial no respetado (HTTP {})",
                resp.status().as_u16()
            ),
        ));
    }
    read_capped(resp, len as usize)
        .await
        .map_err(|e| super::http_err("motor", e))
}

/// Percent-encoding para un segmento de URL.
pub(super) fn pct(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}
