//! El desktop habla con la web de Streamonte (2026-11-25): único dueño de esos pedidos.
//! Guarda en el almacén seguro el código de 3 dígitos de la web (el candado de `hooks.server.ts`) y la cookie firmada
//! `apodo` que da `POST /api/nick`; cada pedido lleva `Cookie: code=…; apodo=…` (y `Origin` en POST/DELETE: SvelteKit
//! rechaza con 403 un POST sin `Origin` del mismo sitio). Lo usan el apodo, la key de TorBox y lo que venga (Vistos).
//!
//! Estados: `401` sin JSON = el candado rechazó el código → se borra el guardado (no es la web; el desktop vuelve a pedirlo).
//! `401` con `{message}` = la sesión del apodo no vale → se borra la cookie y el apodo, el código queda.
//! `429` nunca borra nada: es la espera por intentos errados. Ni el código ni la cookie se loguean ni van a un error.

use std::sync::OnceLock;
use std::time::Duration;

use reqwest::header::{HeaderValue, COOKIE, ORIGIN, SET_COOKIE};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::http::{read_capped, send, HttpError};
use crate::{CoreError, Result};

const BASE: &str = "https://streamonte-web.vercel.app";
const CODE_ACCOUNT: &str = "streamonte-web-code";
const COOKIE_ACCOUNT: &str = "streamonte-web-apodo";
/// El apodo de la sesión (la cookie lo lleva codificado, pero su formato es del servidor).
const NICK_ACCOUNT: &str = "streamonte-web-nick";
const TIMEOUT: Duration = Duration::from_secs(15);
const MAX_BODY: usize = 64 * 1024;

/// Lo que dice `GET /api/nick?nick=`: si el apodo ya tiene código (`login`) o se crea (`nuevo`), el orden de las
/// cartas y los segundos de espera vigentes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NickAsk {
    pub nick: String,
    pub mode: String,
    pub order: Vec<String>,
    pub wait: u64,
}

/// Resultado de `POST /api/nick`. Los errores de red, el código de la web o el servidor sin configurar son `Err`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum NickEnter {
    /// Entró (o creó el código): la cookie y el apodo quedan guardados.
    Ok { nick: String, created: bool },
    /// 403 (no son esos), 429 (en espera) → `wait` en segundos; 409 (el apodo cambió de estado) → `changed`: hay
    /// que volver a preguntar.
    Rejected {
        message: String,
        wait: Option<u64>,
        changed: bool,
    },
}

/// Qué hay guardado de la web.
#[derive(Debug, Clone, Serialize)]
pub struct NickStatus {
    pub code_set: bool,
    /// El apodo de la sesión; `None` = sin sesión.
    pub nick: Option<String>,
}

// ----- Código, cookie y estado -----

/// Guarda el código de la web. Vacío = borrarlo.
pub fn set_code(code: &str) -> Result<()> {
    let code = code.trim();
    if !code.is_empty() && !(code.len() == 3 && code.bytes().all(|b| b.is_ascii_digit())) {
        return Err(user_error("El código son 3 dígitos."));
    }
    crate::secrets::set_secret(CODE_ACCOUNT, code)
}

pub fn clear_code() -> Result<()> {
    set_code("")
}

pub fn status() -> NickStatus {
    NickStatus {
        code_set: crate::secrets::secret(CODE_ACCOUNT).is_some(),
        nick: crate::secrets::secret(COOKIE_ACCOUNT)
            .and_then(|_| crate::secrets::secret(NICK_ACCOUNT)),
    }
}

fn clear_session() {
    for account in [COOKIE_ACCOUNT, NICK_ACCOUNT] {
        if let Err(e) = crate::secrets::set_secret(account, "") {
            tracing::warn!("web: no se pudo borrar la sesión del apodo: {e}");
        }
    }
}

// ----- Pedidos -----

fn user_error(user: &str) -> CoreError {
    CoreError::Catalog {
        user: user.into(),
        detail: user.into(),
    }
}

/// Respuesta ya leída (nunca se guarda ni se loguea entera: puede traer la cookie).
struct Reply {
    status: u16,
    body: Vec<u8>,
    /// Valor de `Set-Cookie: apodo=…`, si vino.
    apodo: Option<String>,
}

impl Reply {
    fn json(&self) -> Option<Value> {
        serde_json::from_slice(&self.body).ok()
    }

    /// El `message` del servidor; si no es JSON, su texto cuando es corto (el 429 del candado); si no, el estado.
    fn message(&self) -> String {
        if let Some(m) = self
            .json()
            .and_then(|v| v["message"].as_str().map(String::from))
        {
            return m;
        }
        match std::str::from_utf8(&self.body) {
            Ok(t) if !t.trim().is_empty() && t.len() < 200 && !t.contains('<') => t.trim().into(),
            _ => format!("la web respondió con error HTTP {}", self.status),
        }
    }

    fn failure(&self) -> CoreError {
        CoreError::Catalog {
            user: self.message(),
            detail: format!("web: HTTP {}", self.status),
        }
    }
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        crate::http::client(crate::http::Kind::Api)
            .build()
            .unwrap_or_default()
    })
}

fn network_error(e: HttpError) -> CoreError {
    CoreError::Catalog {
        user: "No pude conectar con la web de Streamonte.".into(),
        detail: match e {
            HttpError::Network(e) => format!("web: {e}"),
            HttpError::TooLarge { max } => format!("web: respuesta de más de {max} bytes"),
            HttpError::Status { status, .. } => format!("web: HTTP {status}"),
        },
    }
}

/// Un pedido a la web con el código y la cookie guardados. Aplica la regla de los 401 (ver el encabezado); los demás
/// estados vuelven en [`Reply`] para que cada operación los lea.
async fn call(
    method: Method,
    path: &str,
    query: &[(&str, &str)],
    body: Option<Value>,
) -> Result<Reply> {
    let Some(code) = crate::secrets::secret(CODE_ACCOUNT) else {
        return Err(user_error("Falta el código de la web."));
    };
    let mut cookie = format!("code={code}");
    if let Some(apodo) = crate::secrets::secret(COOKIE_ACCOUNT) {
        cookie.push_str(&format!("; apodo={apodo}"));
    }
    let mut cookie =
        HeaderValue::from_str(&cookie).map_err(|_| user_error("Código de la web inválido."))?;
    cookie.set_sensitive(true);
    let mut req = client()
        .request(method.clone(), format!("{BASE}{path}"))
        .query(query)
        .header("Accept", "application/json")
        .header(COOKIE, cookie);
    if method != Method::GET {
        req = req.header(ORIGIN, BASE);
    }
    if let Some(body) = body {
        req = req.json(&body);
    }
    let run = async {
        let resp = send(req).await?;
        let status = resp.status().as_u16();
        let apodo = resp
            .headers()
            .get_all(SET_COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok()?.strip_prefix("apodo="))
            .map(|v| v.split(';').next().unwrap_or_default().to_string())
            .find(|v| !v.is_empty());
        let body = read_capped(resp, MAX_BODY).await.unwrap_or_default();
        Ok::<_, HttpError>(Reply {
            status,
            body,
            apodo,
        })
    };
    let reply = tokio::time::timeout(TIMEOUT, run)
        .await
        .map_err(|_| user_error("La web tardó demasiado en responder."))?
        .map_err(network_error)?;
    if reply.status == 401 {
        if reply.json().is_some_and(|v| v["message"].is_string()) {
            clear_session();
            return Err(reply.failure());
        }
        if let Err(e) = clear_code() {
            tracing::warn!("web: no se pudo borrar el código rechazado: {e}");
        }
        return Err(user_error(
            "El código de la web no es correcto: cargalo de nuevo.",
        ));
    }
    Ok(reply)
}

// ----- Apodo -----

/// `GET /api/nick?nick=`: ¿el apodo ya tiene código?
pub async fn nick_ask(nick: &str) -> Result<NickAsk> {
    let reply = call(Method::GET, "/api/nick", &[("nick", nick)], None).await?;
    if reply.status != 200 {
        return Err(reply.failure());
    }
    serde_json::from_slice(&reply.body).map_err(|_| user_error("La web contestó algo inesperado."))
}

/// `POST /api/nick`: crea o prueba el código de 2 animales. Si entra, guarda la cookie y el apodo, y pide la key de
/// TorBox de la web si todavía no hay una (ver [`adopt_torbox_key`]).
pub async fn nick_enter(nick: &str, code: &[String], mode: &str) -> Result<NickEnter> {
    let body = serde_json::json!({ "nick": nick, "code": code, "mode": mode });
    let reply = call(Method::POST, "/api/nick", &[], Some(body)).await?;
    match reply.status {
        200 => {
            let ok = reply.json().unwrap_or_default();
            let (Some(cookie), Some(name)) = (&reply.apodo, ok["nick"].as_str()) else {
                return Err(user_error("La web no devolvió la sesión del apodo."));
            };
            crate::secrets::set_secret(COOKIE_ACCOUNT, cookie)?;
            crate::secrets::set_secret(NICK_ACCOUNT, name)?;
            adopt_torbox_key().await;
            Ok(NickEnter::Ok {
                nick: name.into(),
                created: ok["created"].as_bool().unwrap_or(false),
            })
        }
        403 | 409 | 429 => Ok(NickEnter::Rejected {
            message: reply.message(),
            wait: reply.json().and_then(|v| v["wait"].as_u64()),
            changed: reply.status == 409,
        }),
        _ => Err(reply.failure()),
    }
}

/// `DELETE /api/nick` (Cambiar de usuario): avisa a la web y borra la sesión local. Aunque la web no conteste, la
/// sesión local se borra: el código queda guardado.
pub async fn nick_logout() -> Result<()> {
    if let Err(e) = call(Method::DELETE, "/api/nick", &[], None).await {
        tracing::info!("web: cerrar sesión sin avisar a la web: {e}");
    }
    clear_session();
    Ok(())
}

/// Los 2 animales (ids, en orden) de la sesión; `None` = todavía no se guardaron (código anterior al cifrado).
pub async fn nick_animals() -> Result<Option<Vec<String>>> {
    let reply = call(Method::GET, "/api/nick/animales", &[], None).await?;
    if reply.status != 200 {
        return Err(reply.failure());
    }
    Ok(reply
        .json()
        .and_then(|v| serde_json::from_value(v["animals"].clone()).ok()))
}

// ----- TorBox -----

#[derive(Deserialize)]
struct KeyBody {
    key: String,
}

/// `GET /api/desktop/torbox-key`: la key de TorBox del servidor (exige código y sesión de apodo).
async fn torbox_key() -> Result<String> {
    let reply = call(Method::GET, "/api/desktop/torbox-key", &[], None).await?;
    if reply.status != 200 {
        return Err(reply.failure());
    }
    let body: KeyBody = serde_json::from_slice(&reply.body)
        .map_err(|_| user_error("La web contestó algo inesperado."))?;
    Ok(body.key)
}

/// Tras entrar con el apodo: si no hay key de TorBox propia, usa la de la web, guardada en la misma cuenta que la de
/// Ajustes (queda aplicada igual y Ajustes la puede reemplazar). Si falla no pasa nada: se avisa en el log, sin la key.
async fn adopt_torbox_key() {
    if crate::catalog::torbox::has_key() {
        return;
    }
    match torbox_key().await {
        Ok(key) => {
            if let Err(e) = crate::catalog::torbox::set_key(&key) {
                tracing::warn!("web: no se pudo guardar la key de TorBox: {e}");
            }
        }
        Err(e) => tracing::warn!("web: key de TorBox no disponible: {e}"),
    }
}
