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

/// Valor de un header con una key o un código: marcado sensible (no sale en el `Debug` del pedido).
fn secret_header(value: &str) -> Result<reqwest::header::HeaderValue, FetchError> {
    let mut v = reqwest::header::HeaderValue::from_str(value)
        .map_err(|_| FetchError::Network("header de acceso inválido".into()))?;
    v.set_sensitive(true);
    Ok(v)
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
            .user_agent(concat!("Streamonte/", env!("CARGO_PKG_VERSION")))
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

    /// GET de JSON con `Authorization: Bearer` (TorBox, 2026-11-17).
    pub async fn get_json_bearer<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
        token: &str,
        timeout: Duration,
    ) -> Result<T, FetchError> {
        self.get_json_auth(url, ("Authorization", &format!("Bearer {token}")), timeout)
            .await
    }

    /// GET de JSON con un header de acceso (`Authorization: Bearer …` o, por el proxy de la web,
    /// `Cookie: code=…`; 2026-11-21). El valor nunca se loguea.
    pub async fn get_json_auth<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
        auth: (&str, &str),
        timeout: Duration,
    ) -> Result<T, FetchError> {
        let req = self
            .client
            .get(url)
            .header("Accept", "application/json")
            .header(auth.0, secret_header(auth.1)?);
        let bytes = tokio::time::timeout(timeout, crate::http::get_bytes(req, LIMITS))
            .await
            .map_err(|_| FetchError::Timeout)??;
        serde_json::from_slice(&bytes).map_err(|_| FetchError::NotJson)
    }

    /// POST `multipart/form-data` con un header de acceso (como [`Self::get_json_auth`]), respuesta JSON
    /// (TorBox `createtorrent`, que según su OpenAPI solo acepta multipart). Sin reintento: el cuerpo no se
    /// puede clonar.
    pub async fn post_multipart_auth<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
        auth: (&str, &str),
        fields: &[(&'static str, String)],
        timeout: Duration,
    ) -> Result<T, FetchError> {
        let form = fields
            .iter()
            .fold(reqwest::multipart::Form::new(), |f, (k, v)| {
                f.text(*k, v.clone())
            });
        let send = async {
            let resp = self
                .client
                .post(url)
                .header("Accept", "application/json")
                .header(auth.0, secret_header(auth.1)?)
                .multipart(form)
                .send()
                .await
                .map_err(|e| FetchError::Network(e.to_string()))?;
            let status = resp.status();
            let bytes = resp
                .bytes()
                .await
                .map_err(|e| FetchError::Network(e.to_string()))?;
            if bytes.len() > 1024 * 1024 {
                return Err(FetchError::TooLarge);
            }
            // Un error (también en JSON) no se lee como respuesta: antes quedaba como respuesta vacía y el error salía
            // sin detalle ("createtorrent sin id: ", 2026-11-23).
            if !status.is_success() {
                return Err(FetchError::Status(status.as_u16()));
            }
            serde_json::from_slice(&bytes).map_err(|_| FetchError::NotJson)
        };
        tokio::time::timeout(timeout, send)
            .await
            .map_err(|_| FetchError::Timeout)?
    }

    async fn get_bytes(&self, url: &str) -> Result<Vec<u8>, FetchError> {
        self.get_capped(url, LIMITS, "application/json").await
    }

    /// GET de texto (RSS/HTML de una fuente propia), UTF-8 con pérdida.
    pub async fn get_text(&self, url: &str, timeout: Duration) -> Result<String, FetchError> {
        let bytes = tokio::time::timeout(timeout, self.get_capped(url, LIMITS, "*/*"))
            .await
            .map_err(|_| FetchError::Timeout)??;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    /// Los primeros `max` bytes de un archivo (Range `0-max-1`; si el servidor lo ignora, se corta igual). Para leer
    /// el encabezado de un video sin bajarlo. La URL puede llevar claves: nunca va al error.
    pub async fn head_bytes(
        &self,
        url: &str,
        max: usize,
        timeout: Duration,
    ) -> Result<Vec<u8>, FetchError> {
        let read = async {
            let mut resp = self
                .client
                .get(url)
                .header(
                    reqwest::header::RANGE,
                    format!("bytes=0-{}", max.saturating_sub(1)),
                )
                .send()
                .await
                .map_err(|e| FetchError::from(HttpError::Network(e.without_url())))?;
            let status = resp.status().as_u16();
            if status != 200 && status != 206 {
                return Err(FetchError::Status(status));
            }
            let mut body = Vec::with_capacity(max);
            while body.len() < max {
                match resp
                    .chunk()
                    .await
                    .map_err(|e| FetchError::from(HttpError::Network(e.without_url())))?
                {
                    Some(chunk) => body.extend_from_slice(&chunk),
                    None => break,
                }
            }
            body.truncate(max);
            Ok(body)
        };
        tokio::time::timeout(timeout, read)
            .await
            .map_err(|_| FetchError::Timeout)?
    }

    /// GET binario más grande que [`MAX_BODY`] (los datasets de IMDb, ~8 MB comprimidos).
    pub async fn get_large(
        &self,
        url: &str,
        max_body: usize,
        timeout: Duration,
    ) -> Result<Vec<u8>, FetchError> {
        let limits = Limits {
            max_body,
            retry_transient: true,
        };
        tokio::time::timeout(timeout, self.get_capped(url, limits, "application/json"))
            .await
            .map_err(|_| FetchError::Timeout)?
    }

    async fn get_capped(
        &self,
        url: &str,
        limits: Limits,
        accept: &str,
    ) -> Result<Vec<u8>, FetchError> {
        let slot = self.host_slot(url);
        let _permit = slot
            .acquire_owned()
            .await
            .map_err(|_| FetchError::Timeout)?;
        let req = self.client.get(url).header("Accept", accept);
        Ok(crate::http::get_bytes(req, limits).await?)
    }
}
