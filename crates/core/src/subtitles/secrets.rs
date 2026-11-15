//! API keys de proveedores de subtítulos (NFR-16, R-15): qué proveedores usan key y con qué
//! nombre se guardan en el almacén seguro ([`crate::secrets`]).

use crate::{CoreError, Result};

/// Proveedores que usan API key. OpenSubtitles (Q-01) y Wyzie Subs (desde 2026 exige una key
/// gratuita, ver spec 08 Q-04).
pub const KEY_PROVIDERS: &[&str] = &[super::providers::OPENSUBTITLES, super::providers::WYZIE];

/// Página donde se pide la key de cada proveedor. Solo estas URLs fijas: la UI no puede abrir
/// direcciones arbitrarias (NFR-16).
pub fn key_page(provider: &str) -> Option<&'static str> {
    match provider {
        super::providers::WYZIE => Some("https://sub.wyzie.io/redeem"),
        super::providers::OPENSUBTITLES => Some("https://www.opensubtitles.com/consumers"),
        _ => None,
    }
}

fn account(provider: &str) -> Result<String> {
    if !KEY_PROVIDERS.contains(&provider) {
        return Err(CoreError::NotFound(format!(
            "proveedor de subtítulos \"{provider}\" (válidos: {})",
            KEY_PROVIDERS.join(", ")
        )));
    }
    Ok(format!("{provider}-api-key"))
}

/// Guarda la key (o la borra si viene vacía). La key no se escribe en ningún log.
pub fn set_api_key(provider: &str, key: &str) -> Result<()> {
    let account = account(provider)?;
    crate::secrets::set_secret(&account, key)?;
    if !key.trim().is_empty() {
        tracing::info!(
            provider,
            "API key de subtítulos guardada en el almacén seguro"
        );
    }
    Ok(())
}

/// La key guardada, o `None` (sin key → ese proveedor se omite).
pub fn api_key(provider: &str) -> Option<String> {
    crate::secrets::secret(&account(provider).ok()?)
}

/// Para la UI (Ajustes, F4): ¿hay key? Sin mostrarla nunca.
pub fn has_api_key(provider: &str) -> bool {
    api_key(provider).is_some()
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
