//! Secretos en el almacén seguro del sistema (NFR-16, R-15): Administrador de credenciales en
//! Windows, Llavero en macOS. Nunca en `config.json` ni en logs. Lo usan las API keys de
//! subtítulos y las URLs de addons con configuración (spec 09 NFR-22).

use crate::{CoreError, Result};

const SERVICE: &str = "streamonte";
/// Nombre viejo (antes de 2026-11-15): lo guardado ahí se pasa a `SERVICE` la primera vez que se lee.
const OLD_SERVICE: &str = "tstream-v2";

fn store_error(e: keyring::Error) -> CoreError {
    CoreError::Subtitles {
        provider: "almacén seguro",
        message: e.to_string(),
    }
}

/// Guarda el secreto de `account` (nombre interno, p. ej. `addon-url-<id>`); vacío = borrar.
/// Nunca se loguea el valor.
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

/// El secreto guardado, o `None` si no hay (o no se pudo leer: se avisa en el log).
pub(crate) fn secret(account: &str) -> Option<String> {
    match keyring::Entry::new(SERVICE, account).ok()?.get_password() {
        Ok(v) if !v.trim().is_empty() => Some(v),
        Ok(_) | Err(keyring::Error::NoEntry) => migrate_old(account),
        Err(e) => {
            tracing::warn!(account, "no se pudo leer del almacén seguro: {e}");
            None
        }
    }
}

/// Lo guardado con el nombre viejo: lo pasa al nuevo y lo borra del viejo.
fn migrate_old(account: &str) -> Option<String> {
    let old = keyring::Entry::new(OLD_SERVICE, account).ok()?;
    let value = old.get_password().ok().filter(|v| !v.trim().is_empty())?;
    if set_secret(account, &value).is_ok() {
        let _ = old.delete_credential();
    }
    Some(value)
}
