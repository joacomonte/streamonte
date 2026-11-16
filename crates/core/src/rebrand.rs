//! Del nombre viejo ("tstream", identificador `app.tstream.v2`) a Streamonte (`app.streamonte`),
//! 2026-11-15. Una sola vez, al abrir y antes de crear las carpetas nuevas: mueve los datos, la
//! caché (con las descargas guardadas), lo que guarda la vista web (preferencias, calibración) y
//! renombra los archivos de control y los logs. Si ya existe la carpeta nueva no toca nada.

use std::path::{Path, PathBuf};

const OLD_ID: &str = "app.tstream.v2";
const NEW_ID: &str = "app.streamonte";
/// Archivos de control dentro de cada descarga y prefijo de los logs: viejo → nuevo.
const RENAMES: [(&str, &str); 3] = [
    (".tstream-kept.json", ".streamonte-kept.json"),
    (".tstream-owner.json", ".streamonte-owner.json"),
    (".tstream-piezas.bitv", ".streamonte-piezas.bitv"),
];

pub(crate) fn migrate(new: &directories::ProjectDirs) {
    let Some(old) = directories::ProjectDirs::from("app", "tstream", "v2") else {
        return;
    };
    // En macOS data y data_local son la misma carpeta: la segunda ya no existe y se saltea.
    for (from, to) in [
        (old.data_dir(), new.data_dir()),
        (old.data_local_dir(), new.data_local_dir()),
        (old.cache_dir(), new.cache_dir()),
    ] {
        move_dir(from, to);
    }
    if let Some(base) = directories::BaseDirs::new() {
        // La vista web guarda sus datos (localStorage) por identificador.
        let web = if cfg!(target_os = "macos") {
            base.home_dir().join("Library/WebKit")
        } else {
            base.data_local_dir().to_path_buf()
        };
        move_dir(&web.join(OLD_ID), &web.join(NEW_ID));
    }
    rename_markers(&new.cache_dir().join("downloads"));
    rename_old_logs(&new.data_local_dir().join("logs"));
}

fn move_dir(from: &Path, to: &Path) {
    if !from.is_dir() || to.exists() {
        return;
    }
    if let Some(parent) = to.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::rename(from, to) {
        Ok(()) => tracing::info!(?from, ?to, "carpeta del nombre viejo migrada"),
        Err(e) => tracing::warn!(
            ?from,
            ?to,
            "no se pudo migrar la carpeta del nombre viejo: {e}"
        ),
    }
}

fn rename_markers(downloads: &Path) {
    for dir in std::fs::read_dir(downloads).into_iter().flatten().flatten() {
        for (old, new) in RENAMES {
            let from = dir.path().join(old);
            if from.is_file() {
                let _ = std::fs::rename(&from, dir.path().join(new));
            }
        }
    }
}

fn rename_old_logs(logs: &Path) {
    for entry in std::fs::read_dir(logs).into_iter().flatten().flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(rest) = name.strip_prefix("tstream.") {
            let to: PathBuf = logs.join(format!("streamonte.{rest}"));
            if !to.exists() {
                let _ = std::fs::rename(entry.path(), to);
            }
        }
    }
}
