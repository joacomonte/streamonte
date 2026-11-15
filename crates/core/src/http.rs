//! Mecánica HTTP compartida (catálogo y proveedores de subtítulos): envío sin URL en los errores,
//! lectura con tope, errores tipados por estado, un reintento ante `429` + `Retry-After` (y,
//! si el llamador lo pide, ante red/5xx) y enmascarado de URLs para logs. Cada llamador arma su
//! cliente (User-Agent, timeouts) y elige sus límites con [`Limits`].

use std::time::Duration;

/// `Retry-After` más largo que esto no se espera: se informa como error.
const MAX_RETRY_AFTER: Duration = Duration::from_secs(5);
/// Espera antes del reintento ante red/5xx.
const TRANSIENT_WAIT: Duration = Duration::from_millis(300);

/// Por qué falló un pedido; cada llamador lo traduce a su lenguaje (estado de addon, mensaje del
/// proveedor…).
#[derive(Debug)]
pub(crate) enum HttpError {
    /// Respuesta fuera de 2xx, con su cuerpo (para detectar Cloudflare o leer el detalle).
    Status { status: u16, body: Vec<u8> },
    /// Error de red, ya SIN la URL (la de un addon o de Wyzie puede llevar claves).
    Network(reqwest::Error),
    TooLarge { max: usize },
}

/// Límites de un [`get_bytes`].
#[derive(Debug, Clone, Copy)]
pub(crate) struct Limits {
    /// Tope del cuerpo (también para las respuestas de error).
    pub max_body: usize,
    /// Además del `429`, reintentar una vez ante error de red o 5xx (NFR-19; nunca otros 4xx).
    pub retry_transient: bool,
}

fn network(e: reqwest::Error) -> HttpError {
    HttpError::Network(e.without_url())
}

/// Vencido el plazo del pedido (no el de conexión, que cuenta como red).
pub(crate) fn is_timeout(e: &reqwest::Error) -> bool {
    e.is_timeout() && !e.is_connect()
}

pub(crate) async fn send(req: reqwest::RequestBuilder) -> Result<reqwest::Response, HttpError> {
    req.send().await.map_err(network)
}

/// Lee el cuerpo de a trozos y corta si pasa de `max` bytes (no se carga todo en memoria).
pub(crate) async fn read_capped(
    mut resp: reqwest::Response,
    max: usize,
) -> Result<Vec<u8>, HttpError> {
    if resp.content_length().is_some_and(|l| l > max as u64) {
        return Err(HttpError::TooLarge { max });
    }
    let mut body = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(network)? {
        if body.len() + chunk.len() > max {
            return Err(HttpError::TooLarge { max });
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// Pide y devuelve el cuerpo de una respuesta 2xx, con un solo reintento: ante `429` si el
/// `Retry-After` es corto (sin cabecera, 1 s) y, con `retry_transient`, ante red/5xx.
pub(crate) async fn get_bytes(
    req: reqwest::RequestBuilder,
    limits: Limits,
) -> Result<Vec<u8>, HttpError> {
    let (client, request) = req.build_split();
    let mut request = request.map_err(network)?;
    let mut retried = false;
    loop {
        let next = request.try_clone();
        let url = redact(request.url().as_str());
        let (err, retry_after) = match once(&client, request, limits.max_body).await {
            Ok(body) => return Ok(body),
            Err(failed) => failed,
        };
        let wait = match (&err, retry_after) {
            (HttpError::Status { status: 429, .. }, Some(w)) if w <= MAX_RETRY_AFTER => w,
            (HttpError::Network(e), _) if limits.retry_transient && !is_timeout(e) => {
                TRANSIENT_WAIT
            }
            (HttpError::Status { status: 500..=599, .. }, _) if limits.retry_transient => {
                TRANSIENT_WAIT
            }
            _ => return Err(err),
        };
        let Some(next) = next.filter(|_| !retried) else {
            return Err(err);
        };
        tracing::debug!(url = %url, "reintento");
        retried = true;
        tokio::time::sleep(wait).await;
        request = next;
    }
}

/// Un intento. En un `429` devuelve también cuánto esperar (`Retry-After`, o 1 s si no viene).
async fn once(
    client: &reqwest::Client,
    request: reqwest::Request,
    max: usize,
) -> Result<Vec<u8>, (HttpError, Option<Duration>)> {
    let resp = client
        .execute(request)
        .await
        .map_err(|e| (network(e), None))?;
    let status = resp.status().as_u16();
    if (200..300).contains(&status) {
        return read_capped(resp, max).await.map_err(|e| (e, None));
    }
    let wait = (status == 429).then(|| {
        resp.headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .and_then(retry_after)
            .unwrap_or(Duration::from_secs(1))
    });
    // El cuerpo de un error solo sirve de detalle: si es enorme o se corta, va vacío.
    let body = read_capped(resp, max).await.unwrap_or_default();
    Err((HttpError::Status { status, body }, wait))
}

/// `Retry-After`: segundos o fecha HTTP (RFC 7231 §7.1.3); una fecha pasada = sin espera.
fn retry_after(v: &str) -> Option<Duration> {
    let v = v.trim();
    if let Ok(secs) = v.parse::<u64>() {
        return Some(Duration::from_secs(secs));
    }
    let at = chrono::DateTime::parse_from_rfc2822(v).ok()?;
    Some((at.to_utc() - chrono::Utc::now()).to_std().unwrap_or_default())
}

/// URL para logs y UI: si lleva configuración en el path o en el query (puede tener claves), se
/// enmascara (`https://host/****/manifest.json`, `…/manifest.json?****`). NFR-22.
pub fn redact(url: &str) -> String {
    let Ok(u) = reqwest::Url::parse(url) else {
        return "****".into();
    };
    let port = u.port().map(|p| format!(":{p}")).unwrap_or_default();
    let base = format!("{}://{}{port}", u.scheme(), u.host_str().unwrap_or(""));
    let query = if u.query().is_some_and(|q| !q.is_empty()) {
        "?****"
    } else {
        ""
    };
    let segs: Vec<&str> = u.path().split('/').filter(|s| !s.is_empty()).collect();
    let resource = segs
        .iter()
        .position(|s| matches!(*s, "manifest.json" | "stream" | "catalog" | "meta"));
    let path = match resource {
        Some(0) => format!("/{}", segs.join("/")),
        Some(i) => format!("/****/{}", segs[i..].join("/")),
        None if segs.is_empty() => String::new(),
        None => "/****".into(),
    };
    format!("{base}{path}{query}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enmascara_config_del_path() {
        assert_eq!(
            redact("https://torrentio.strem.fun/realdebrid=SECRETO|sort=x/manifest.json"),
            "https://torrentio.strem.fun/****/manifest.json"
        );
        assert_eq!(
            redact("https://addon.peerflix.mov/manifest.json"),
            "https://addon.peerflix.mov/manifest.json"
        );
        assert_eq!(
            redact("https://x.org/abc/stream/movie/tt1.json"),
            "https://x.org/****/stream/movie/tt1.json"
        );
        assert_eq!(
            redact("http://127.0.0.1:7000/manifest.json"),
            "http://127.0.0.1:7000/manifest.json"
        );
        assert_eq!(
            redact("https://x.org/manifest.json?key=SECRETO"),
            "https://x.org/manifest.json?****"
        );
    }

    #[test]
    fn retry_after_en_segundos_o_fecha() {
        assert_eq!(retry_after(" 3 "), Some(Duration::from_secs(3)));
        let at = (chrono::Utc::now() + chrono::Duration::seconds(30)).to_rfc2822();
        let at = at.replace("+0000", "GMT");
        let wait = retry_after(&at).unwrap();
        assert!(wait > Duration::from_secs(25) && wait <= Duration::from_secs(30));
        assert_eq!(
            retry_after("Sun, 06 Nov 1994 08:49:37 GMT"),
            Some(Duration::ZERO)
        );
        assert_eq!(retry_after("mañana"), None);
    }
}
