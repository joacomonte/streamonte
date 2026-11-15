//! Cliente HTTP del catálogo (NFR-19, 22, 23, 24): timeouts, máx. 2 pedidos por host,
//! un reintento solo ante error de red/5xx, `429` + `Retry-After`, tope de 5 MB, UTF-8.
//! La mecánica (reintento, tope, `Retry-After`) es la compartida de [`crate::http`].
//! shortcut: sin caché en disco ni circuit breaker todavía (FR-51/52, Entrega 2).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::Semaphore;

pub use crate::http::redact;
use crate::http::{HttpError, Limits};

/// Tamaño máximo de una respuesta (NFR-24).
pub const MAX_BODY: usize = 5 * 1024 * 1024;
const MAX_PER_HOST: usize = 2;
const LIMITS: Limits = Limits {
    max_body: MAX_BODY,
    retry_transient: true,
};

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

impl From<HttpError> for FetchError {
    fn from(e: HttpError) -> Self {
        match e {
            // Conectar que vence = red (NFR-19: 1 reintento). Ya sin URL (puede llevar claves).
            HttpError::Network(e) if crate::http::is_timeout(&e) => Self::Timeout,
            HttpError::Network(e) => Self::Network(e.to_string()),
            HttpError::Status { status, .. } => Self::Status(status),
            HttpError::TooLarge { .. } => Self::TooLarge,
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
        let req = self.client.get(url).header("Accept", "application/json");
        Ok(crate::http::get_bytes(req, LIMITS).await?)
    }
}
