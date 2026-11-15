//! Cliente HTTP compartido del catálogo (NFR-19, 22, 23, 24): timeouts, máx. 2 pedidos por host,
//! un reintento solo ante error de red/5xx, `429` + `Retry-After`, tope de 5 MB, UTF-8.
//! shortcut: sin caché en disco ni circuit breaker todavía (FR-51/52, Entrega 2).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::Semaphore;

/// Tamaño máximo de una respuesta (NFR-24).
pub const MAX_BODY: usize = 5 * 1024 * 1024;
const MAX_PER_HOST: usize = 2;
/// `Retry-After` más largo que esto no se espera: se informa como error.
const MAX_RETRY_AFTER: Duration = Duration::from_secs(5);

/// Por qué falló un pedido (se traduce a estados del addon y a mensajes en español).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FetchError {
    /// Sin conexión / DNS / conexión rechazada.
    Network(String),
    Timeout,
    Status(u16),
    TooLarge,
    /// No es JSON (p. ej. una página HTML de Cloudflare).
    NotJson,
}

impl FetchError {
    pub fn user_text(&self) -> String {
        match self {
            Self::Network(_) => "sin conexión".into(),
            Self::Timeout => "sin respuesta (timeout)".into(),
            Self::Status(429) => "limitó los pedidos (429)".into(),
            Self::Status(403) => "bloqueado (403)".into(),
            Self::Status(c) => format!("error HTTP {c}"),
            Self::TooLarge => "respuesta demasiado grande".into(),
            Self::NotJson => "no devolvió JSON".into(),
        }
    }
}

#[derive(Clone)]
pub struct Http {
    client: reqwest::Client,
    hosts: Arc<Mutex<HashMap<String, Arc<Semaphore>>>>,
}

impl Http {
    pub fn new(connect_timeout: Duration) -> Self {
        let client = reqwest::Client::builder()
            // NFR-22: User-Agent genérico, sin datos del usuario.
            .user_agent(concat!("TorrentStream/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(connect_timeout)
            .build()
            .unwrap_or_default();
        Self {
            client,
            hosts: Arc::default(),
        }
    }

    fn host_slot(&self, url: &str) -> Arc<Semaphore> {
        let host = reqwest::Url::parse(url)
            .ok()
            .and_then(|u| u.host_str().map(String::from))
            .unwrap_or_default();
        self.hosts
            .lock()
            .expect("hosts")
            .entry(host)
            .or_insert_with(|| Arc::new(Semaphore::new(MAX_PER_HOST)))
            .clone()
    }

    /// GET que devuelve JSON parseado. `timeout` = plazo total del pedido (incluye el reintento).
    pub async fn get_json<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
        timeout: Duration,
    ) -> Result<T, FetchError> {
        let bytes = tokio::time::timeout(timeout, self.get_bytes(url))
            .await
            .map_err(|_| FetchError::Timeout)??;
        serde_json::from_slice(&bytes).map_err(|_| FetchError::NotJson)
    }

    async fn get_bytes(&self, url: &str) -> Result<Vec<u8>, FetchError> {
        let slot = self.host_slot(url);
        let _permit = slot
            .acquire_owned()
            .await
            .map_err(|_| FetchError::Timeout)?;
        let mut retried = false;
        loop {
            let err = match self.once(url).await {
                Ok(body) => return Ok(body),
                Err(e) => e,
            };
            // NFR-19: un solo reintento, y solo ante red/5xx o un 429 con espera corta; nunca 4xx.
            let wait = match &err {
                Attempt::RetryAfter(w) if *w <= MAX_RETRY_AFTER => *w,
                Attempt::Fetch(FetchError::Network(_) | FetchError::Status(500..=599)) => {
                    Duration::from_millis(300)
                }
                _ => return Err(err.into()),
            };
            if retried {
                return Err(err.into());
            }
            tracing::debug!(url = %redact(url), "reintento");
            retried = true;
            tokio::time::sleep(wait).await;
        }
    }

    async fn once(&self, url: &str) -> Result<Vec<u8>, Attempt> {
        let fetch = |e: reqwest::Error| {
            Attempt::Fetch(if e.is_timeout() {
                FetchError::Timeout
            } else {
                FetchError::Network(e.to_string())
            })
        };
        let mut resp = self
            .client
            .get(url)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(fetch)?;
        let status = resp.status().as_u16();
        if status == 429 {
            let wait = resp
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.trim().parse::<u64>().ok())
                .map_or(Duration::from_secs(1), Duration::from_secs);
            return Err(Attempt::RetryAfter(wait));
        }
        if !(200..300).contains(&status) {
            return Err(Attempt::Fetch(FetchError::Status(status)));
        }
        if resp.content_length().is_some_and(|l| l > MAX_BODY as u64) {
            return Err(Attempt::Fetch(FetchError::TooLarge));
        }
        let mut body = Vec::new();
        while let Some(chunk) = resp.chunk().await.map_err(fetch)? {
            if body.len() + chunk.len() > MAX_BODY {
                return Err(Attempt::Fetch(FetchError::TooLarge));
            }
            body.extend_from_slice(&chunk);
        }
        Ok(body)
    }
}

/// Resultado de un intento fallido: error final o "esperá y reintentá" (429).
enum Attempt {
    Fetch(FetchError),
    RetryAfter(Duration),
}

impl From<Attempt> for FetchError {
    fn from(a: Attempt) -> Self {
        match a {
            Attempt::Fetch(e) => e,
            Attempt::RetryAfter(_) => FetchError::Status(429),
        }
    }
}

/// URL para logs y UI: si lleva configuración en el path (puede tener claves), se enmascara
/// (`https://host/****/manifest.json`). NFR-22.
pub fn redact(url: &str) -> String {
    let Ok(u) = reqwest::Url::parse(url) else {
        return "****".into();
    };
    let base = format!("{}://{}", u.scheme(), u.host_str().unwrap_or(""));
    let segs: Vec<&str> = u.path().split('/').filter(|s| !s.is_empty()).collect();
    let resource = segs
        .iter()
        .position(|s| matches!(*s, "manifest.json" | "stream" | "catalog" | "meta"));
    match resource {
        Some(0) => format!("{base}/{}", segs.join("/")),
        Some(i) => format!("{base}/****/{}", segs[i..].join("/")),
        None if segs.is_empty() => base,
        None => format!("{base}/****"),
    }
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
    }
}
