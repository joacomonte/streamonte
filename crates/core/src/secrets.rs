//! Secretos en el almacén seguro del sistema (NFR-16, R-15): Administrador de credenciales en
//! Windows, Llavero en macOS. Nunca en `config.json` ni en logs. Lo usan las API keys de
//! subtítulos y las URLs de addons con configuración (spec 09 NFR-22).
//!
//! Desarrollo (2026-11-17): cada `cargo run` es un ejecutable con otra firma y macOS vuelve a pedir
//! la contraseña del llavero. En builds de debug los secretos van a un archivo local
//! (`dev-secrets.json`, permisos 600, en texto plano) y la primera lectura de cada uno copia lo
//! que haya en el llavero. La app instalada (release) usa solo el llavero.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use crate::{CoreError, Result};

/// Lo ya leído del llavero (también "no hay"), por cuenta. Sin esto macOS pide permiso en cada
/// lectura (pósters, listas, temporadas) hasta que el usuario elige "Permitir siempre".
fn cache() -> &'static Mutex<HashMap<String, Option<String>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    CACHE.get_or_init(Mutex::default)
}

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
    let value = value.trim();
    if cfg!(debug_assertions) {
        dev_store::set(account, value)?;
    } else {
        keychain_set(account, value)?;
    }
    let stored = (!value.is_empty()).then(|| value.to_string());
    cache()
        .lock()
        .expect("secrets")
        .insert(account.to_string(), stored);
    Ok(())
}

fn keychain_set(account: &str, value: &str) -> Result<()> {
    let entry = keyring::Entry::new(SERVICE, account).map_err(store_error)?;
    if value.is_empty() {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(store_error(e)),
        }
    } else {
        entry.set_password(value).map_err(store_error)?;
    }
    Ok(())
}

/// El secreto guardado, o `None` si no hay (o no se pudo leer: se avisa en el log).
/// Se lee del llavero una sola vez por cuenta y sesión (si se niega el permiso, tampoco se
/// vuelve a preguntar hasta reabrir la app).
pub(crate) fn secret(account: &str) -> Option<String> {
    if let Some(hit) = cache().lock().expect("secrets").get(account) {
        return hit.clone();
    }
    let value = if cfg!(debug_assertions) {
        dev_store::get(account).or_else(|| {
            let v = keychain_get(account)?;
            if let Err(e) = dev_store::set(account, &v) {
                tracing::warn!(account, "no se pudo copiar al archivo de desarrollo: {e}");
            }
            Some(v)
        })
    } else {
        keychain_get(account)
    };
    cache()
        .lock()
        .expect("secrets")
        .insert(account.to_string(), value.clone());
    value
}

fn keychain_get(account: &str) -> Option<String> {
    match keyring::Entry::new(SERVICE, account).ok()?.get_password() {
        Ok(v) if !v.trim().is_empty() => Some(v),
        Ok(_) | Err(keyring::Error::NoEntry) => migrate_old(account),
        Err(e) => {
            tracing::warn!(account, "no se pudo leer del almacén seguro: {e}");
            None
        }
    }
}

/// Archivo de secretos de los builds de debug (ver el encabezado del módulo).
mod dev_store {
    use std::collections::HashMap;
    use std::path::PathBuf;

    use crate::{CoreError, Result};

    fn path() -> Option<PathBuf> {
        let dirs = directories::ProjectDirs::from("app", "", "streamonte")?;
        Some(dirs.config_dir().join("dev-secrets.json"))
    }

    fn read() -> HashMap<String, String> {
        path()
            .and_then(|p| std::fs::read(p).ok())
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    pub(super) fn get(account: &str) -> Option<String> {
        read().remove(account)
    }

    pub(super) fn set(account: &str, value: &str) -> Result<()> {
        let path = path().ok_or(CoreError::Unsupported("carpeta de configuración"))?;
        let mut all = read();
        if value.is_empty() {
            all.remove(account);
        } else {
            all.insert(account.to_string(), value.to_string());
        }
        let io = |e: std::io::Error| CoreError::Subtitles {
            provider: "archivo de secretos de desarrollo",
            message: e.to_string(),
        };
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(io)?;
        }
        let json = serde_json::to_vec_pretty(&all).expect("map de strings");
        std::fs::write(&path, json).map_err(io)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).map_err(io)?;
        }
        Ok(())
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
