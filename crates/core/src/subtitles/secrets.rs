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

/// Usuario y contraseña de OpenSubtitles.com (2026-11-18): con login se sabe la cuota desde el
/// arranque y se baja con la cuota de la cuenta. Vacíos = borrar. Nunca van a un log.
pub fn set_opensubtitles_login(username: &str, password: &str) -> Result<()> {
    let clear = username.trim().is_empty() || password.is_empty();
    crate::secrets::set_secret("opensubtitles-username", if clear { "" } else { username })?;
    crate::secrets::set_secret("opensubtitles-password", if clear { "" } else { password })?;
    super::providers::forget_opensubtitles_login();
    Ok(())
}

/// El login guardado de OpenSubtitles.com, si hay.
pub fn opensubtitles_login() -> Option<(String, String)> {
    Some((
        crate::secrets::secret("opensubtitles-username")?,
        crate::secrets::secret("opensubtitles-password")?,
    ))
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
