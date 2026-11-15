//! API keys de proveedores de subtítulos en el almacén seguro del sistema (NFR-16, R-15):
//! Administrador de credenciales en Windows, Llavero en macOS. Nunca en `config.json` ni en logs.

use crate::{CoreError, Result};

const SERVICE: &str = "tstream-v2";

/// Proveedores que usan API key. OpenSubtitles (Q-01) y Wyzie Subs (desde 2026 exige una key
/// gratuita, ver spec 08 Q-04).
pub const KEY_PROVIDERS: &[&str] = &["opensubtitles", "wyzie"];

fn entry(provider: &str) -> Result<keyring::Entry> {
    if !KEY_PROVIDERS.contains(&provider) {
        return Err(CoreError::NotFound(format!(
            "proveedor de subtítulos \"{provider}\" (válidos: {})",
            KEY_PROVIDERS.join(", ")
        )));
    }
    keyring::Entry::new(SERVICE, &format!("{provider}-api-key")).map_err(store_error)
}

fn store_error(e: keyring::Error) -> CoreError {
    CoreError::Subtitles {
        provider: "almacén seguro",
        message: e.to_string(),
    }
}

/// Guarda la key (o la borra si viene vacía). La key no se escribe en ningún log.
pub fn set_api_key(provider: &str, key: &str) -> Result<()> {
    let entry = entry(provider)?;
    let key = key.trim();
    if key.is_empty() {
        return match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(store_error(e)),
        };
    }
    entry.set_password(key).map_err(store_error)?;
    tracing::info!(
        provider,
        "API key de subtítulos guardada en el almacén seguro"
    );
    Ok(())
}

/// La key guardada, o `None` (sin key → ese proveedor se omite).
pub fn api_key(provider: &str) -> Option<String> {
    match entry(provider).ok()?.get_password() {
        Ok(k) if !k.trim().is_empty() => Some(k),
        Ok(_) | Err(keyring::Error::NoEntry) => None,
        Err(e) => {
            tracing::warn!(
                provider,
                "no se pudo leer la API key del almacén seguro: {e}"
            );
            None
        }
    }
}

/// Para la UI (Ajustes, F4): ¿hay key? Sin mostrarla nunca.
pub fn has_api_key(provider: &str) -> bool {
    api_key(provider).is_some()
}

/// Secreto genérico en el almacén seguro (URLs de addons con config, spec 09 NFR-22).
/// `account` es un nombre interno (`addon-url-<id>`); vacío = borrar. Nunca se loguea el valor.
pub(crate) fn set_secret(account: &str, value: &str) -> Result<()> {
    let entry = keyring::Entry::new(SERVICE, account).map_err(store_error)?;
    if value.trim().is_empty() {
        return match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(store_error(e)),
        };
    }
    entry.set_password(value.trim()).map_err(store_error)
}

pub(crate) fn secret(account: &str) -> Option<String> {
    match keyring::Entry::new(SERVICE, account).ok()?.get_password() {
        Ok(v) if !v.trim().is_empty() => Some(v),
        Ok(_) | Err(keyring::Error::NoEntry) => None,
        Err(e) => {
            tracing::warn!(account, "no se pudo leer del almacén seguro: {e}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proveedor_desconocido_es_error_claro() {
        assert!(set_api_key("addic7ed", "x").is_err());
        assert_eq!(api_key("addic7ed"), None);
    }
}
